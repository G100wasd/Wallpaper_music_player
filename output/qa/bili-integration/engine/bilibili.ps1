function Get-BiliCover([string]$url) {
  $uri=$null
  if(-not [Uri]::TryCreate($url,[UriKind]::Absolute,[ref]$uri) -or $uri.Scheme -ne 'https' -or $uri.Host -notmatch '^i\d+\.hdslb\.com$' -or $uri.AbsolutePath -notlike '/bfs/archive/*'){throw '封面地址不正确。'}
  $response=Invoke-WebRequest -Uri ($uri.GetLeftPart([UriPartial]::Path)+'@196w_124h_1c.webp') -UseBasicParsing -Headers @{'User-Agent'='Mozilla/5.0';'Referer'='https://www.bilibili.com/'} -TimeoutSec 10
  $bytes=$response.RawContentStream.ToArray()
  if($bytes.Length -gt 2MB){throw '封面过大。'}
  return @{dataUrl=('data:image/webp;base64,'+[Convert]::ToBase64String($bytes))}
}
function Get-BiliApi([string]$path) {
  $result=Invoke-RestMethod -Uri ('https://api.bilibili.com/'+$path) -Headers @{'User-Agent'='Mozilla/5.0';'Referer'='https://www.bilibili.com/'} -TimeoutSec 20
  if($result.code -ne 0){throw ('B 站返回：'+$result.message+'（'+$result.code+'）。请确认收藏夹公开且视频可访问。')}
  return $result.data
}
function Get-BiliFavorites([string]$url) {
  $uri=$null
  if(-not [Uri]::TryCreate($url,[UriKind]::Absolute,[ref]$uri) -or $uri.Scheme -notin @('https','http') -or $uri.Host -notin @('space.bilibili.com','www.bilibili.com')){throw '请粘贴完整的 B 站收藏夹链接。'}
  if($uri.Query -notmatch '(?:^\?|&)fid=(\d+)(?:&|$)'){throw '链接中没有收藏夹编号 fid。'}
  $fid=$Matches[1];$items=New-Object Collections.Generic.List[object];$seen=New-Object 'Collections.Generic.HashSet[string]'
  $title='';$more=$false;$total=0
  for($page=1;$page -le 100;$page++){
    $data=Get-BiliApi "x/v3/fav/resource/list?media_id=$fid&pn=$page&ps=20&order=mtime&type=0&tid=0&platform=web"
    if($page -eq 1){$title=$data.info.title;$total=$data.info.media_count}
    foreach($video in $data.medias){
      if(-not $video.bvid -or -not $seen.Add([string]$video.bvid)){continue}
      $available=$video.type -eq 2 -and $video.ugc.first_cid -gt 0 -and ($video.attr -band 1) -eq 0
      $items.Add(@{bvid=$video.bvid;cid=[string]$video.ugc.first_cid;title=$video.title;description=$video.intro;cover=($video.cover -replace '^http:','https:');artist=$video.upper.name;duration=$video.duration;available=$available})
    }
    $more=[bool]$data.has_more;if(-not $more){break}
  }
  return @{title=$title;fid=$fid;total=$total;items=@($items.ToArray());truncated=$more}
}
function Get-BiliAudio([string]$bvid,[string]$cid) {
  if($bvid -notmatch '^BV[0-9a-zA-Z]{10}$' -or $cid -notmatch '^\d{1,20}$'){throw '视频编号不正确，请重新导入收藏夹。'}
  $cachePath=Join-Path $rootPath 'music\bilibili-cache';[IO.Directory]::CreateDirectory($cachePath) | Out-Null
  $name=$bvid+'-'+$cid+'.m4a';$target=Join-Path $cachePath $name
  if([IO.File]::Exists($target) -and (Get-Item -LiteralPath $target).Length -gt 1024){return @{src=('music/bilibili-cache/'+$name);cached=$true}}
  $data=Get-BiliApi "x/player/playurl?bvid=$bvid&cid=$cid&fnval=16&qn=64&fourk=1"
  $audio=@($data.dash.audio | Sort-Object bandwidth -Descending)
  if(-not $audio.Count){throw '此视频暂时没有可访问的独立音频，可能需要登录或已失效。'}
  $lastFailure=''
  foreach($streamInfo in $audio){
    foreach($url in @($streamInfo.baseUrl)+@($streamInfo.backupUrl)){
      if(-not $url){continue};$uri=[Uri]$url
      if($uri.Scheme -ne 'https' -or $uri.Host -notmatch '(^|\.)(bilivideo\.com|akamaized\.net)$'){continue}
      $part=$target+'.partial';$response=$null;$inputStream=$null;$outputStream=$null
      try{
        $req=[Net.HttpWebRequest]::Create($uri);$req.UserAgent='Mozilla/5.0';$req.Referer='https://www.bilibili.com/';$req.Timeout=25000;$req.ReadWriteTimeout=25000;$req.AllowAutoRedirect=$false
        $response=$req.GetResponse()
        if([int]$response.StatusCode -ne 200 -or $response.ContentLength -gt 128MB){throw '音频响应无效或超过 128 MB。'}
        $inputStream=$response.GetResponseStream();$outputStream=[IO.File]::Create($part);$buffer=New-Object byte[] 65536;$count=0
        while(($read=$inputStream.Read($buffer,0,$buffer.Length)) -gt 0){$count+=$read;if($count -gt 128MB){throw '音频超过 128 MB。'};$outputStream.Write($buffer,0,$read)}
        $outputStream.Dispose();$outputStream=$null
        if($count -le 1024){throw '音频内容不完整。'}
        [IO.File]::Move($part,$target)
        return @{src=('music/bilibili-cache/'+$name);cached=$false}
      }catch{$lastFailure=$_.Exception.Message}finally{
        if($outputStream){$outputStream.Dispose()};if($inputStream){$inputStream.Dispose()};if($response){$response.Dispose()}
        if([IO.File]::Exists($part)){[IO.File]::Delete($part)}
      }
    }
  }
  throw ('音频暂时无法读取，请稍后重试。'+$lastFailure)
}
