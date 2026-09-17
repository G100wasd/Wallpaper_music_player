using System;
using System.Runtime.InteropServices;
using System.Threading;

// WASAPI shared-mode loopback. Bounded in-memory samples, never an audio file.
public sealed class BlackVinylLoopbackWave : IDisposable
{
    const int Capacity = 8192, Points = 512;
    readonly object gate = new object();
    readonly float[] left = new float[Capacity], right = new float[Capacity];
    readonly Thread worker;
    volatile bool disposed;
    long demand, lastPacket;
    int count, cursor, sampleRate;
    bool available;
    string error = "正在连接音频设备…", deviceId = "";
    public sealed class Snapshot
    {
        public bool available;
        public string error, deviceId;
        public int sampleRate;
        public double[] left, right;
    }
    public BlackVinylLoopbackWave()
    {
        worker = new Thread(Run); worker.IsBackground = true; worker.Name = "BlackVinyl waveform";
        worker.SetApartmentState(ApartmentState.MTA); worker.Start();
    }
    static long Now { get { return DateTime.UtcNow.Ticks; } }
    bool Requested { get { return Now - Interlocked.Read(ref demand) < TimeSpan.FromSeconds(3).Ticks; } }
    public Snapshot Read()
    {
        Interlocked.Exchange(ref demand, Now);
        lock (gate)
        {
            var result = new Snapshot { available = available, error = error, sampleRate = sampleRate, deviceId = deviceId, left = new double[Points], right = new double[Points] };
            if (!available || count < Points || Now - lastPacket > TimeSpan.FromMilliseconds(160).Ticks) return result;
            // Trigger both channels at the same upward zero crossing to steady the trace.
            int start = (cursor - Points + Capacity) % Capacity;
            if (count >= Points + 128)
            {
                float le = 0, re = 0;
                for (int i = 0; i < 128; i++) { le += Math.Abs(left[(start + i) % Capacity]); re += Math.Abs(right[(start + i) % Capacity]); }
                var trigger = le >= re ? left : right;
                for (int i = 1; i <= 128; i++)
                {
                    int at = (start - i + Capacity) % Capacity, before = (at - 1 + Capacity) % Capacity;
                    if (trigger[before] < 0 && trigger[at] >= 0) { start = at; break; }
                }
            }
            for (int i = 0; i < Points; i++)
            {
                int at = (start + i) % Capacity;
                result.left[i] = Math.Round(left[at], 5); result.right[i] = Math.Round(right[at], 5);
            }
            return result;
        }
    }
    void State(bool ready, string message)
    {
        lock (gate) { available = ready; error = message; if (!ready) { count = cursor = 0; lastPacket = 0; } }
    }
    void Run()
    {
        int initialized = CoInitializeEx(IntPtr.Zero, 0);
        try
        {
            while (!disposed)
            {
                if (!Requested) { State(false, "波形采集待机"); Thread.Sleep(100); continue; }
                try { Capture(); }
                catch (Exception) { State(false, "无法采集当前输出设备，请检查设备连接或音频独占占用。"); }
                for (int i = 0; i < 10 && !disposed; i++) Thread.Sleep(100);
            }
        }
        finally { if (initialized >= 0) CoUninitialize(); }
    }
    void Capture()
    {
        BlackVinylAudioDevice.IMMDevice device = null;
        IAudioClient client = null; IAudioCaptureClient capture = null; IntPtr format = IntPtr.Zero;
        bool started = false;
        try
        {
            device = BlackVinylAudioDevice.OpenDefault(); string id; Check(device.GetId(out id));
            object instance; var clientId = typeof(IAudioClient).GUID;
            Check(device.Activate(ref clientId, 23, IntPtr.Zero, out instance)); client = (IAudioClient)instance;
            Check(client.GetMixFormat(out format));
            int tag = (ushort)Marshal.ReadInt16(format, 0), channels = (ushort)Marshal.ReadInt16(format, 2);
            int rate = Marshal.ReadInt32(format, 4), block = (ushort)Marshal.ReadInt16(format, 12), bits = (ushort)Marshal.ReadInt16(format, 14);
            if (tag == 65534)
            {
                if ((ushort)Marshal.ReadInt16(format, 16) < 22) throw new NotSupportedException();
                var sub = (Guid)Marshal.PtrToStructure(IntPtr.Add(format, 24), typeof(Guid));
                if (sub == new Guid("00000003-0000-0010-8000-00aa00389b71")) tag = 3;
                else if (sub == new Guid("00000001-0000-0010-8000-00aa00389b71")) tag = 1;
            }
            if (rate <= 0 || channels < 1 || block < channels * (bits / 8) ||
                !(tag == 3 && bits == 32 || tag == 1 && (bits == 16 || bits == 24 || bits == 32))) throw new NotSupportedException();
            // Shared mode + LOOPBACK, timer-driven capture, 100 ms engine buffer.
            Check(client.Initialize(0, 0x20000, 1000000, 0, format, IntPtr.Zero));
            var captureId = typeof(IAudioCaptureClient).GUID;
            Check(client.GetService(ref captureId, out instance)); capture = (IAudioCaptureClient)instance;
            lock (gate) { deviceId = id; sampleRate = rate; count = cursor = 0; }
            Check(client.Start()); started = true; State(true, "");
            long nextDeviceCheck = 0; byte[] buffer = new byte[0];
            while (!disposed && Requested)
            {
                if (Now >= nextDeviceCheck)
                {
                    var current = BlackVinylAudioDevice.ReadDefault();
                    if (!current.available || current.id != id) { State(false, "正在切换音频设备…"); return; }
                    nextDeviceCheck = Now + TimeSpan.FromSeconds(1).Ticks;
                }
                uint packet; Check(capture.GetNextPacketSize(out packet));
                while (packet > 0 && !disposed)
                {
                    IntPtr data; uint frames, flags; ulong position, timestamp;
                    Check(capture.GetBuffer(out data, out frames, out flags, out position, out timestamp));
                    try
                    {
                        int bytes = checked((int)frames * block);
                        bool silent = (flags & 2) != 0;
                        if (!silent) { if (buffer.Length < bytes) buffer = new byte[bytes]; Marshal.Copy(data, buffer, 0, bytes); }
                        lock (gate)
                        {
                            if ((flags & 1) != 0) { count = cursor = 0; }
                            for (int i = 0; i < (int)frames; i++)
                            {
                                int offset = i * block;
                                left[cursor] = silent ? 0 : Decode(buffer, offset, tag == 3, bits);
                                right[cursor] = channels == 1 ? left[cursor] : silent ? 0 : Decode(buffer, offset + bits / 8, tag == 3, bits);
                                cursor = (cursor + 1) % Capacity; count = Math.Min(count + 1, Capacity);
                            }
                            lastPacket = Now;
                        }
                    }
                    finally { Check(capture.ReleaseBuffer(frames)); }
                    Check(capture.GetNextPacketSize(out packet));
                }
                Thread.Sleep(8);
            }
            State(false, "波形采集待机");
        }
        finally
        {
            if (started) client.Stop();
            if (capture != null) Marshal.ReleaseComObject(capture);
            if (client != null) Marshal.ReleaseComObject(client);
            if (device != null) Marshal.ReleaseComObject(device);
            if (format != IntPtr.Zero) Marshal.FreeCoTaskMem(format);
        }
    }
    public static float Decode(byte[] data, int offset, bool floating, int bits)
    {
        float value;
        if (floating) value = BitConverter.ToSingle(data, offset);
        else if (bits == 16) value = BitConverter.ToInt16(data, offset) / 32768f;
        else if (bits == 24) { int v = data[offset] | data[offset + 1] << 8 | data[offset + 2] << 16; if ((v & 0x800000) != 0) v |= unchecked((int)0xff000000); value = v / 8388608f; }
        else value = BitConverter.ToInt32(data, offset) / 2147483648f;
        return float.IsNaN(value) || float.IsInfinity(value) ? 0 : Math.Max(-1, Math.Min(1, value));
    }
    static void Check(int hr) { Marshal.ThrowExceptionForHR(hr); }
    public void Dispose() { disposed = true; worker.Join(2000); }
    [DllImport("ole32.dll")] static extern int CoInitializeEx(IntPtr reserved, uint mode);
    [DllImport("ole32.dll")] static extern void CoUninitialize();
    [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioClient
    {
        [PreserveSig] int Initialize(int mode, uint flags, long duration, long period, IntPtr format, IntPtr session);
        [PreserveSig] int GetBufferSize(out uint frames);
        [PreserveSig] int GetStreamLatency(out long latency);
        [PreserveSig] int GetCurrentPadding(out uint frames);
        [PreserveSig] int IsFormatSupported(int mode, IntPtr format, out IntPtr closest);
        [PreserveSig] int GetMixFormat(out IntPtr format);
        [PreserveSig] int GetDevicePeriod(out long period, out long minimum);
        [PreserveSig] int Start();
        [PreserveSig] int Stop();
        [PreserveSig] int Reset();
        [PreserveSig] int SetEventHandle(IntPtr handle);
        [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }
    [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioCaptureClient
    {
        [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong position, out ulong timestamp);
        [PreserveSig] int ReleaseBuffer(uint frames);
        [PreserveSig] int GetNextPacketSize(out uint frames);
    }
}
