using System;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

// Read-only Windows Core Audio endpoint discovery. No recording or device changes.
public static class BlackVinylAudioDevice
{
    public sealed class Output
    {
        public bool available;
        public string id = "", name = "", detectedBy = "unavailable";
        public int formFactor = -1;
        public bool isHeadphones;
    }

    public static bool IsHeadphones(int formFactor, string name)
    {
        return formFactor == 3 || formFactor == 5 || Regex.IsMatch(name ?? "",
            @"耳机|耳機|耳麦|耳麥|\b(headphones?|headsets?|earphones?|earbuds?|airpods)\b", RegexOptions.IgnoreCase);
    }

    public static Output ReadDefault()
    {
        IMMDeviceEnumerator enumerator = null; IMMDevice device = null; IPropertyStore store = null;
        var result = new Output();
        try
        {
            enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            // eRender / eConsole follows the Windows default output selector.
            Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 0, out device));
            Marshal.ThrowExceptionForHR(device.GetId(out result.id));
            Marshal.ThrowExceptionForHR(device.OpenPropertyStore(0, out store));
            var name = ReadProperty(store, new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), 14);
            var factor = ReadProperty(store, new Guid("1da5d803-d492-4edd-8c23-e0c0ffee7f0e"), 0);
            result.name = name as string ?? "";
            result.formFactor = factor is uint ? (int)(uint)factor : -1;
            result.isHeadphones = IsHeadphones(result.formFactor, result.name);
            result.detectedBy = result.formFactor == 3 || result.formFactor == 5 ? "formFactor" : result.isHeadphones ? "name" : "formFactor";
            result.available = true;
        }
        catch (COMException) { /* Missing endpoint or unavailable audio service: use the single trace. */ }
        finally
        {
            if (store != null) Marshal.ReleaseComObject(store);
            if (device != null) Marshal.ReleaseComObject(device);
            if (enumerator != null) Marshal.ReleaseComObject(enumerator);
        }
        return result;
    }

    internal static IMMDevice OpenDefault()
    {
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
        try { IMMDevice device; Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 0, out device)); return device; }
        finally { Marshal.ReleaseComObject(enumerator); }
    }

    static object ReadProperty(IPropertyStore store, Guid guid, uint id)
    {
        var key = new PropertyKey { fmtid = guid, pid = id }; PropVariant value;
        int hr = store.GetValue(ref key, out value);
        try
        {
            if (hr < 0) return null;
            if (value.vt == 31) return Marshal.PtrToStringUni(value.pointer);
            if (value.vt == 19) return value.number;
            return null;
        }
        finally { PropVariantClear(ref value); }
    }

    [StructLayout(LayoutKind.Sequential)] internal struct PropertyKey { public Guid fmtid; public uint pid; }
    [StructLayout(LayoutKind.Explicit, Size = 24)] internal struct PropVariant
    {
        [FieldOffset(0)] public ushort vt;
        [FieldOffset(8)] public IntPtr pointer;
        [FieldOffset(8)] public uint number;
    }
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant value);
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }
    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int flow, uint state, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
    }
    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, uint context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
        [PreserveSig] int OpenPropertyStore(uint mode, out IPropertyStore properties);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out uint state);
    }
    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IPropertyStore
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
        [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
        [PreserveSig] int Commit();
    }
}
