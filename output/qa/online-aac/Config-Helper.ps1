param([switch]$NoOpen, [switch]$QuietStartup)
$ErrorActionPreference = 'Stop'
$rootPath = [IO.Path]::GetFullPath($PSScriptRoot)
$utf8 = New-Object Text.UTF8Encoding($false)
. (Join-Path $rootPath 'engine\bilibili.ps1')
$hash = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($rootPath))).Replace('-','')
$mutex = New-Object Threading.Mutex($false, ('Local\BlackVinyl-' + $hash))
if (-not $mutex.WaitOne(0)) {
  # Manual launch opens the existing helper; login launch stays silent.
  if (-not $NoOpen -and -not $QuietStartup) {
    try {
      $savedConnection = [IO.File]::ReadAllText((Join-Path $rootPath 'connection.js'))
      if ($savedConnection -match 'window.BlackVinylConnection\s*=\s*(\{.*\})\s*;') {
        $running = $Matches[1] | ConvertFrom-Json
        if ($running.url -match '^http://localhost:187\d\d/$') {
          Invoke-RestMethod -Uri ($running.url+'open') -Method Post -Headers @{'X-BlackVinyl-Token'=$running.token} -TimeoutSec 5 | Out-Null
        }
      }
    } catch {}
  }
  $mutex.Dispose(); exit
}
function Write-JsonFile($path, $value) { [IO.File]::WriteAllText($path, ($value | ConvertTo-Json -Depth 30), $utf8) }
function Reply($context, $status, $value) {
  $bytes = $utf8.GetBytes(($value | ConvertTo-Json -Depth 30 -Compress))
  $context.Response.StatusCode = $status
  $context.Response.ContentType = 'application/json; charset=utf-8'
  $context.Response.ContentLength64 = $bytes.Length
  $context.Response.OutputStream.Write($bytes,0,$bytes.Length)
  $context.Response.Close()
}
try {
  for ($port = 18765; $port -lt 18785; $port++) {
    $listener = New-Object Net.HttpListener
    $listener.Prefixes.Add("http://localhost:$port/")
    try { $listener.Start(); break } catch { $listener.Close(); if($port -eq 18784){throw} }
  }
  Add-Type -Path (Join-Path $rootPath 'engine\StreamRelay.cs')
  $streamRelay = New-Object BlackVinylStreamRelay
  $token = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
  $connect = @{url="http://localhost:$port/";token=$token}
  [IO.File]::WriteAllText((Join-Path $rootPath 'connection.js'), ('window.BlackVinylConnection = ' + ($connect | ConvertTo-Json -Compress) + ';'), $utf8)
  $configPath = Join-Path $rootPath 'config.json'
  if(-not [IO.File]::Exists($configPath)){[IO.File]::Copy((Join-Path $rootPath 'config.default.json'),$configPath)}
  [IO.File]::WriteAllText((Join-Path $rootPath 'config-data.js'), ('window.BlackVinylDiskConfig = ' + [IO.File]::ReadAllText($configPath,$utf8) + ';'), $utf8)
  if(-not $NoOpen -and -not $QuietStartup){Start-Process -FilePath (Join-Path $rootPath 'config.html')}
  while($listener.IsListening){
    $context=$listener.GetContext(); $request=$context.Request
    try {
      $origin=$request.Headers['Origin']
      if($origin -and $origin -ne 'null' -and $origin -notmatch '^http://(localhost|127\.0\.0\.1)(:\d+)?$'){Reply $context 403 @{error='Origin rejected'};continue}
      $context.Response.Headers['Access-Control-Allow-Origin']= $(if($origin){$origin}else{'null'})
      $context.Response.Headers['Access-Control-Allow-Headers']='X-BlackVinyl-Token, X-Filename, Content-Type'
      $context.Response.Headers['Access-Control-Allow-Methods']='GET, POST, OPTIONS'
      $context.Response.Headers['Access-Control-Allow-Private-Network']='true'
      $context.Response.Headers['Cache-Control']='no-store'
      if($request.HttpMethod -eq 'OPTIONS'){Reply $context 200 @{ok=$true};continue}
      if($request.Headers['X-BlackVinyl-Token'] -cne $token){Reply $context 403 @{error='Token rejected'};continue}
      $route=$request.Url.AbsolutePath
      if($route -in @('/bilibili/favorites','/bilibili/audio','/bilibili/cover') -and $request.HttpMethod -eq 'POST'){
        if($request.ContentLength64 -lt 0 -or $request.ContentLength64 -gt 8192){throw 'Invalid request size'}
        $reader=New-Object IO.StreamReader($request.InputStream,$utf8);$payload=$reader.ReadToEnd() | ConvertFrom-Json
        if($route -eq '/bilibili/favorites'){Reply $context 200 (Get-BiliFavorites $payload.url)}
        elseif($route -eq '/bilibili/cover'){Reply $context 200 (Get-BiliCover $payload.url)}
        else{Reply $context 200 (Get-BiliAudio $payload.bvid $payload.cid)}
      } elseif($route -eq '/status' -and $request.HttpMethod -eq 'GET'){
        Reply $context 200 @{ok=$true;pid=$PID;quietStartup=[bool]$QuietStartup;onlineAudio=$true;activeStreams=$streamRelay.ActiveStreams;bytesForwarded=$streamRelay.BytesForwarded}
      } elseif($route -eq '/config' -and $request.HttpMethod -eq 'GET'){
        Reply $context 200 ([IO.File]::ReadAllText($configPath,$utf8) | ConvertFrom-Json)
      } elseif($route -eq '/config' -and $request.HttpMethod -eq 'POST'){
        if($request.ContentLength64 -lt 0 -or $request.ContentLength64 -gt 5MB){Reply $context 413 @{error='Config too large'};continue}
        $reader=New-Object IO.StreamReader($request.InputStream,$utf8);$value=$reader.ReadToEnd() | ConvertFrom-Json
        if($value.version -ne 1 -or -not $value.settings){throw 'Invalid configuration'}
        $value.settings.playerStyle='line'
        $temporary=Join-Path $rootPath 'config.pending.json';Write-JsonFile $temporary $value
        [IO.File]::Replace($temporary,$configPath,(Join-Path $rootPath 'config.previous.json'))
        [IO.File]::WriteAllText((Join-Path $rootPath 'config-data.js'), ('window.BlackVinylDiskConfig = ' + ($value | ConvertTo-Json -Depth 30 -Compress) + ';'), $utf8)
        Reply $context 200 @{ok=$true}
      } elseif($route -eq '/music' -and $request.HttpMethod -eq 'POST'){
        if($request.ContentLength64 -lt 0 -or $request.ContentLength64 -gt 256MB){Reply $context 413 @{error='Maximum music file size is 256 MB'};continue}
        $name=[Uri]::UnescapeDataString($request.Headers['X-Filename']);$extension=[IO.Path]::GetExtension($name).ToLowerInvariant()
        if($extension -notin @('.mp3','.wav','.ogg','.flac','.m4a','.aac','.opus','.aif','.aiff','.weba','.webm','.mp4')){throw 'Unsupported audio extension'}
        $musicPath=Join-Path $rootPath 'music';[IO.Directory]::CreateDirectory($musicPath) | Out-Null
        $filename=[Guid]::NewGuid().ToString('N')+$extension;$targetPath=Join-Path $musicPath $filename
        $stream=[IO.File]::Create($targetPath)
        try{$request.InputStream.CopyTo($stream)}finally{$stream.Dispose()}
        Reply $context 200 @{src=('music/'+$filename)}
      } elseif($route -eq '/open' -and $request.HttpMethod -eq 'POST'){
        if(-not $NoOpen){Start-Process -FilePath (Join-Path $rootPath 'config.html')}
        Reply $context 200 @{ok=$true}
      } elseif($route -eq '/stop' -and $request.HttpMethod -eq 'POST'){
        Reply $context 200 @{ok=$true};break
      } else {Reply $context 404 @{error='Not found'}}
    } catch {try{Reply $context 400 @{error=$_.Exception.Message}}catch{}}
  }
} catch {
  [IO.File]::WriteAllText((Join-Path $rootPath 'helper-error.txt'),($_.Exception.ToString()+[Environment]::NewLine+$_.ScriptStackTrace),$utf8)
} finally {
  if($streamRelay){$streamRelay.Dispose()}
  if($listener){$listener.Close()};$mutex.ReleaseMutex();$mutex.Dispose()
}
