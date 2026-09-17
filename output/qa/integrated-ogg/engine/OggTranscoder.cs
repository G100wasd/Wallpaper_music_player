using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Threading;

public sealed partial class BlackVinylStreamRelay {
    sealed class Job { public string Key; public Process Process; public HttpListenerResponse Response; }
    readonly ConcurrentDictionary<Job, byte> jobs = new ConcurrentDictionary<Job, byte>();
    readonly SemaphoreSlim transcodeSlots = new SemaphoreSlim(3);
    readonly string ffmpegPath;
    public int ActiveTranscodes { get { return jobs.Count; } }
    public bool TranscoderAvailable { get { return File.Exists(ffmpegPath); } }

    static void StopJob(Job job) {
        try { job.Response.Abort(); } catch {}
        try { if (!job.Process.HasExited) job.Process.Kill(); } catch {}
    }
    void Cancel(string key, Ticket ticket) {
        // Keep the tombstone until expiry so a delayed browser GET cannot restart it.
        ticket.Cancelled = true;
        foreach (var job in jobs.Keys) if (job.Key == key) StopJob(job);
    }
    void Transcode(HttpListenerContext context, string key, Ticket ticket) {
        var output = context.Response;
        if (!TranscoderAvailable) { output.StatusCode = 503; return; }
        output.ContentType = "audio/ogg";
        output.Headers["Accept-Ranges"] = "none";
        if (context.Request.HttpMethod == "HEAD") { output.StatusCode = 200; return; }
        if (!transcodeSlots.Wait(0)) { output.StatusCode = 503; return; }
        Process process = null; Job job = null;
        try {
            if (ticket.Cancelled || stopped) { output.StatusCode = 410; return; }
            // Only this relay's fixed, capability-scoped URL reaches the command line.
            string input = BaseUrl + "stream/" + key + "/audio.m4a";
            string seek = ticket.Start > 0 ? " -ss " + ticket.Start.ToString("0.###", CultureInfo.InvariantCulture) : "";
            var info = new ProcessStartInfo {
                FileName = ffmpegPath,
                Arguments = "-hide_banner -loglevel error -nostdin -rw_timeout 20000000 -readrate 1.2 -readrate_initial_burst 5" + seek +
                    " -i " + input + " -map 0:a:0 -vn -c:a libvorbis -q:a 5 -f ogg -page_duration 200000 -flush_packets 1 pipe:1",
                UseShellExecute = false, CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden, RedirectStandardOutput = true, RedirectStandardError = true
            };
            process = new Process { StartInfo = info };
            // Drain stderr to prevent pipe deadlock. Do not log signed upstream URLs.
            process.ErrorDataReceived += delegate {};
            process.Start(); process.BeginErrorReadLine();
            job = new Job { Key = key, Process = process, Response = output }; jobs[job] = 0;
            if (ticket.Cancelled || stopped) { StopJob(job); return; }
            output.SendChunked = true;
            using (var inputStream = process.StandardOutput.BaseStream) {
                var buffer = new byte[32768]; int count;
                bool sent = false;
                while (!stopped && !ticket.Cancelled && (count = inputStream.Read(buffer, 0, buffer.Length)) > 0) {
                    output.OutputStream.Write(buffer, 0, count);
                    Interlocked.Add(ref bytesForwarded, count); sent = true;
                }
                if (!sent && !ticket.Cancelled && !stopped) output.StatusCode = 502;
                // A truncated stream must be a network error, not a normal song ending.
                if (sent && process.WaitForExit(1000) && process.ExitCode != 0) output.Abort();
            }
        } finally {
            if (job != null) { byte ignored; jobs.TryRemove(job, out ignored); }
            if (process != null) { try { if (!process.HasExited) process.Kill(); process.WaitForExit(1500); } catch {} process.Dispose(); }
            transcodeSlots.Release();
        }
    }
}
