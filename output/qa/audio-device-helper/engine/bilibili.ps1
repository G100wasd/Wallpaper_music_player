function Get-BiliCover([string]$url) {
  $uri=$null
  if(-not [Uri]::TryCreate($url,[UriKind]::Absolute,[ref]$uri) -or $uri.Scheme -ne 'https' -or $uri.Host -notmatch '^i\d+\.hdslb\.com$' -or $uri.AbsolutePath -notlike '/bfs/archive/*'){throw '封面地址不正确。'}
  $response=Invoke-WebRequest -Uri ($uri.GetLeftPart([UriPartial]::Path)+'@196w_124h_1c.webp') -UseBasicParsing -Headers @{'User-Agent'='Mozilla/5.0';'Referer'='https://www.bilibili.com/'} -TimeoutSec 10
  $bytes=$response.RawContentStream.ToArray()
  if($bytes.Length -gt 2MB){throw '封面过大。'}
  return @{dataUrl=('data:image/webp;base64,'+[Convert]::ToBase64String($bytes))}
}
function Get-BiliApi([string]$path) {
  for($attempt=0;$attempt -lt 2;$attempt++){
    try {
      $result=Invoke-RestMethod -Uri ('https://api.bilibili.com/'+$path) -Headers @{'User-Agent'='Mozilla/5.0';'Referer'='https://www.bilibili.com/'} -TimeoutSec 15
      break
    } catch {
      $status=0;if($_.Exception.Response){$status=[int]$_.Exception.Response.StatusCode}
      if($attempt -eq 1 -or ($status -ne 0 -and $status -notin @(408,502,503,504))){throw}
      Start-Sleep -Milliseconds 300
    }
  }
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
function Get-BiliAudio([string]$bvid,[string]$cid,[double]$startTime=0) {
  if($bvid -notmatch '^BV[0-9a-zA-Z]{10}$' -or $cid -notmatch '^\d{1,20}$'){throw '视频编号不正确，请重新导入收藏夹。'}
  if(-not $streamRelay.TranscoderAvailable){throw '缺少在线转码工具，请完整解压更新包中的 tools 文件夹，然后重启本机助手。'}
  if([double]::IsNaN($startTime) -or [double]::IsInfinity($startTime) -or $startTime -lt 0 -or $startTime -gt 86400){throw '播放位置无效。'}
  $data=Get-BiliApi "x/player/playurl?bvid=$bvid&cid=$cid&fnval=16&qn=64&fourk=1"
  $audio=@($data.dash.audio | Where-Object {$_.codecs -like 'mp4a.*'} | Sort-Object bandwidth -Descending)
  if(-not $audio.Count){throw '此视频没有可访问的 AAC 音频，可能需要登录或已失效。'}
  $urls=New-Object 'Collections.Generic.List[string]'
  foreach($streamInfo in @($audio[0])){
    foreach($url in @($streamInfo.baseUrl)+@($streamInfo.backupUrl)){
      if(-not $url){continue};$uri=[Uri]$url
      if($uri.Scheme -eq 'https' -and $uri.Host -match '(^|\.)(bilivideo\.com|akamaized\.net)$'){$urls.Add([string]$url)}
    }
  }
  $duration=[double]$data.timelength/1000
  if($duration -gt 0){$startTime=[Math]::Min($startTime,[Math]::Max(0,$duration-0.1))}
  $src=$streamRelay.Register($urls.ToArray(),$startTime)
  return @{src=$src;cancelUrl=($src.Substring(0,$src.Length-9)+'cancel');codec='vorbis';mimeType='audio/ogg';online=$true;duration=$duration;startTime=$startTime}
}
