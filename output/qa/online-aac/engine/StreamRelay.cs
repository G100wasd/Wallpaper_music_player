using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net;
using System.Text.RegularExpressions;
using System.Threading;

// A separate listener keeps long audio requests off the configuration thread.
public sealed class BlackVinylStreamRelay : IDisposable {
    sealed class Ticket { public string[] Urls; public DateTime Expires; }
    readonly ConcurrentDictionary<string, Ticket> tickets = new ConcurrentDictionary<string, Ticket>();
    readonly ConcurrentDictionary<HttpWebRequest, byte> requests = new ConcurrentDictionary<HttpWebRequest, byte>();
    readonly SemaphoreSlim slots = new SemaphoreSlim(8);
    HttpListener listener;
    volatile bool stopped;
    long bytesForwarded;
    int active;
    public string BaseUrl { get; private set; }
    public long BytesForwarded { get { return Interlocked.Read(ref bytesForwarded); } }
    public int ActiveStreams { get { return active; } }

    public BlackVinylStreamRelay() {
        for (int port = 18785; port < 18805; port++) {
            var candidate = new HttpListener();
            string prefix = "http://localhost:" + port + "/";
            candidate.Prefixes.Add(prefix);
            try { candidate.Start(); listener = candidate; BaseUrl = prefix; break; }
            catch { candidate.Close(); if (port == 18804) throw; }
        }
        var thread = new Thread(Accept); thread.IsBackground = true; thread.Start();
    }
    public string Register(string[] urls) {
        foreach (string url in urls) {
            var uri = new Uri(url);
            if (uri.Scheme != "https" || !Regex.IsMatch(uri.Host, @"(^|\.)(bilivideo\.com|akamaized\.net)$"))
                throw new ArgumentException("Unsupported audio host");
        }
        if (urls.Length == 0) throw new ArgumentException("No audio source");
        foreach (var pair in tickets) {
            Ticket removed;
            if (pair.Value.Expires < DateTime.UtcNow) tickets.TryRemove(pair.Key, out removed);
        }
        if (tickets.Count >= 512) throw new InvalidOperationException("Too many active audio links; retry later");
        string key = Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");
        tickets[key] = new Ticket { Urls = urls, Expires = DateTime.UtcNow.AddHours(2) };
        return BaseUrl + "stream/" + key + "/audio.m4a";
    }
    void Accept() {
        while (!stopped) {
            try {
                var context = listener.GetContext();
                if (!slots.Wait(0)) { context.Response.StatusCode = 503; context.Response.Close(); continue; }
                ThreadPool.QueueUserWorkItem(delegate { try { Serve(context); } finally { slots.Release(); } });
            } catch { if (stopped) return; }
        }
    }
    void Serve(HttpListenerContext context) {
        var output = context.Response;
        Interlocked.Increment(ref active);
        try {
            string origin = context.Request.Headers["Origin"];
            if (!String.IsNullOrEmpty(origin) && origin != "null" && !Regex.IsMatch(origin, @"^http://(localhost|127\.0\.0\.1)(:\d+)?$")) {
                output.StatusCode = 403; return;
            }
            output.Headers["Access-Control-Allow-Origin"] = String.IsNullOrEmpty(origin) ? "null" : origin;
            output.Headers["Access-Control-Allow-Headers"] = "Range";
            output.Headers["Access-Control-Allow-Methods"] = "GET, HEAD, OPTIONS";
            output.Headers["Access-Control-Allow-Private-Network"] = "true";
            output.Headers["Access-Control-Expose-Headers"] = "Content-Range, Accept-Ranges, Content-Length";
            output.Headers["Cache-Control"] = "no-store";
            if (context.Request.HttpMethod == "OPTIONS") { output.StatusCode = 204; return; }
            if (context.Request.HttpMethod != "GET" && context.Request.HttpMethod != "HEAD") { output.StatusCode = 405; return; }
            var match = Regex.Match(context.Request.Url.AbsolutePath, @"^/stream/([a-f0-9]{64})/audio\.m4a$");
            Ticket ticket;
            if (!match.Success || !tickets.TryGetValue(match.Groups[1].Value, out ticket) || ticket.Expires < DateTime.UtcNow) {
                output.StatusCode = 404; return;
            }
            string range = context.Request.Headers["Range"];
            Match rangeMatch = null;
            if (!String.IsNullOrEmpty(range)) {
                rangeMatch = Regex.Match(range, @"^bytes=(\d*)-(\d*)$");
                if (!rangeMatch.Success || range == "bytes=-") { output.StatusCode = 416; return; }
            }
            foreach (string url in ticket.Urls) {
                var req = (HttpWebRequest)WebRequest.Create(url);
                req.UserAgent = "Mozilla/5.0"; req.Referer = "https://www.bilibili.com/";
                req.AllowAutoRedirect = false; req.Timeout = 20000; req.ReadWriteTimeout = 20000;
                req.Method = context.Request.HttpMethod;
                if (rangeMatch != null) {
                    string from = rangeMatch.Groups[1].Value, to = rangeMatch.Groups[2].Value;
                    long first, last;
                    if ((from != "" && !Int64.TryParse(from, out first)) || (to != "" && !Int64.TryParse(to, out last))) { output.StatusCode = 416; return; }
                    if ((from == "" && Int64.Parse(to) == 0) || (from != "" && to != "" && Int64.Parse(from) > Int64.Parse(to))) { output.StatusCode = 416; return; }
                    if (from == "") req.AddRange(-Int64.Parse(to));
                    else if (to == "") req.AddRange(Int64.Parse(from));
                    else req.AddRange(Int64.Parse(from), Int64.Parse(to));
                }
                requests[req] = 0;
                bool headersSent = false;
                try {
                    using (var upstream = (HttpWebResponse)req.GetResponse()) {
                        int status = (int)upstream.StatusCode;
                        if (status != 200 && status != 206) continue;
                        output.StatusCode = status; output.ContentType = "audio/mp4";
                        output.Headers["Accept-Ranges"] = "bytes";
                        if (upstream.Headers["Content-Range"] != null) output.Headers["Content-Range"] = upstream.Headers["Content-Range"];
                        if (upstream.ContentLength >= 0) output.ContentLength64 = upstream.ContentLength;
                        else output.SendChunked = true;
                        headersSent = true;
                        if (req.Method == "HEAD") return;
                        using (var input = upstream.GetResponseStream()) {
                            byte[] buffer = new byte[65536]; int count;
                            while (!stopped && (count = input.Read(buffer, 0, buffer.Length)) > 0) {
                                output.OutputStream.Write(buffer, 0, count);
                                Interlocked.Add(ref bytesForwarded, count);
                            }
                        }
                        return;
                    }
                } catch (WebException ex) {
                    using (var failed = ex.Response as HttpWebResponse) {
                        if (headersSent) return;
                        if (failed != null && (int)failed.StatusCode == 416) {
                            output.StatusCode = 416;
                            if (failed.Headers["Content-Range"] != null) output.Headers["Content-Range"] = failed.Headers["Content-Range"];
                            return;
                        }
                    }
                } catch { if (headersSent) return; }
                finally { byte ignored; requests.TryRemove(req, out ignored); req.Abort(); }
            }
            output.StatusCode = 502;
        } catch { try { output.StatusCode = 502; } catch {} }
        finally { try { output.Close(); } catch {} Interlocked.Decrement(ref active); }
    }
    public void Dispose() {
        stopped = true; listener.Close();
        foreach (var req in requests.Keys) req.Abort();
        tickets.Clear();
    }
}
