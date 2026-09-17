$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\engine\bilibili.ps1')
function Get-BiliApi([string]$path) {
  $script:query=$path
  return @{bvid='BV1E2ER6NEvN';title='Original title';desc='BGM: Midnight City';pic='http://i0.hdslb.com/bfs/archive/test.jpg';owner=@{name='Uploader'};state=0;duration=300;pages=@(@{cid=123;duration=100;part='Part 1'},@{cid=456;duration=200;part='Part 2'})}
}
$result=Get-BiliVideo 'https://www.bilibili.com/video/BV1E2ER6NEvN/?spm_id_from=test&vd_source=test'
if($result.items.Count -ne 1 -or $result.items[0].cid -ne '123' -or $result.items[0].duration -ne 100 -or $result.items[0].description -ne 'BGM: Midnight City' -or -not $result.items[0].available){throw 'Video metadata mismatch'}
if($query -ne 'x/web-interface/view?bvid=BV1E2ER6NEvN'){throw 'Wrong API query'}
if($result.items[0].cover -notlike 'https:*'){throw 'Cover normalization failed'}
$result=Get-BiliVideo 'https://www.bilibili.com/video/av123?p=2'
if($result.items[0].cid -ne '456' -or $result.items[0].duration -ne 200 -or $query -ne 'x/web-interface/view?aid=123'){throw 'Part/av handling failed'}
foreach($url in @('https://example.com/video/BV1E2ER6NEvN/','file:///video/BV1E2ER6NEvN/','https://www.bilibili.com/video/BV1E2ER6NEvN/?p=0','https://www.bilibili.com/video/BV1E2ER6NEvN/?p=3','https://www.bilibili.com/video/BV1E2ER6NEvN/?p=no','https://www.bilibili.com/video/BVbad/')){
  $rejected=$false;try{Get-BiliVideo $url | Out-Null}catch{$rejected=$true};if(-not $rejected){throw ('Invalid URL accepted: '+$url)}
}
Write-Output 'PASS video metadata, tracking parameters, BV/av identifiers, part selection, duration, invalid links/parts rejected'
