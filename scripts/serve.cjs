const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml' };
http.createServer((request, response) => {
  let file;
  try { const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); file = path.resolve(root, '.' + (relative === '/' ? '/index.html' : relative)); }
  catch (_) { response.writeHead(400); return response.end(); }
  if (file !== root && !file.startsWith(root + path.sep)) { response.writeHead(403); return response.end(); }
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) { response.writeHead(404); return response.end(); }
    const headers = { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
    let start = 0, end = stat.size - 1;
    if (range) {
      start = Number(range[1]); end = range[2] ? Math.min(Number(range[2]), end) : end;
      if (start > end) { response.writeHead(416, { 'Content-Range': 'bytes */' + stat.size }); return response.end(); }
      headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    }
    headers['Content-Length'] = end - start + 1;
    response.writeHead(range ? 206 : 200, headers);
    if (request.method === 'HEAD') return response.end();
    fs.createReadStream(file, {start, end}).pipe(response);
  });
}).listen(8765, '127.0.0.1', () => process.stdout.write('Black Vinyl preview: http://127.0.0.1:8765\n'));
