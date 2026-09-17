$displayMap=@{infoScale='infoscale';playerScale='playerscale';listScale='listscale';waveGain='wavegain'}
function Read-Display($config) {
  $values=@{};foreach($key in $displayMap.Keys){$values[$key]=[double]$config.settings.$key};return $values
}
function Write-ConfigSnapshot($value) {
  $temporary=Join-Path $rootPath 'config.pending.json';Write-JsonFile $temporary $value
  [IO.File]::Replace($temporary,$configPath,(Join-Path $rootPath 'config.previous.json'))
  [IO.File]::WriteAllText((Join-Path $rootPath 'config-data.js'),('window.BlackVinylDiskConfig = '+($value | ConvertTo-Json -Depth 30 -Compress)+';'),$utf8)
}
function Update-Display($patch) {
  $value=[IO.File]::ReadAllText($configPath,$utf8) | ConvertFrom-Json
  $changed=$false
  foreach($key in $displayMap.Keys){
    if($null -eq $patch.PSObject.Properties[$key]){continue}
    $number=[double]$patch.$key;$max=1.5;if($key -eq 'waveGain'){$max=2}
    if([double]::IsNaN($number) -or [double]::IsInfinity($number) -or $number -lt .5 -or $number -gt $max){throw 'Invalid display setting'}
    $number=[Math]::Round($number,2)
    if([double]$value.settings.$key -ne $number){$value.settings.$key=$number;$changed=$true}
  }
  if($changed){Write-ConfigSnapshot $value}
  return (Read-Display $value)
}
function Invoke-WallpaperControl([string]$exe,[string]$arguments) {
  $info=New-Object Diagnostics.ProcessStartInfo
  $info.FileName=$exe;$info.Arguments=$arguments;$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardOutput=$true
  $process=[Diagnostics.Process]::Start($info)
  try {if(-not $process.WaitForExit(2500)){$process.Kill();throw 'Wallpaper Engine command timed out'};return $process.StandardOutput.ReadToEnd().Trim()}finally{$process.Dispose()}
}
function Send-DisplayToWallpaper($patch) {
  $running=Get-Process wallpaper64,wallpaper32 -ErrorAction SilentlyContinue | Where-Object {$_.Path} | Select-Object -First 1
  if(-not $running){return $false}
  $exe=$running.Path;$locations=@()
  if($WallpaperLocation){$locations=@($WallpaperLocation)}else{
    try {
      $state=[IO.File]::ReadAllText((Join-Path ([IO.Path]::GetDirectoryName($exe)) 'config.json')) | ConvertFrom-Json
      $selected=$state.($env:USERNAME).general.wallpaperconfig.selectedwallpapers
      foreach($entry in $selected.PSObject.Properties){
        if($entry.Value.file -and [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($entry.Value.file)) -ieq $rootPath){$locations+= $entry.Name}
      }
    }catch{return $false}
  }
  $properties=@{};foreach($key in $displayMap.Keys){if($null -ne $patch.PSObject.Properties[$key]){$properties[$displayMap[$key]]=[int][Math]::Round([double]$patch.$key*100)}}
  if(-not $properties.Count){return $true}
  $json=$properties | ConvertTo-Json -Compress;$sent=$false
  foreach($location in $locations){
    # Never broadcast: locations are restricted to this folder or an explicit test window.
    if($location -match '["\r\n]'){continue}
    $current=Invoke-WallpaperControl $exe ('-control getWallpaper -location "'+$location+'"')
    # Some host builds return no stdout. In that case use the selected-wallpaper match above.
    if($current){try {if([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($current)) -ine $rootPath){continue}}catch{continue}}
    Invoke-WallpaperControl $exe ('-control applyProperties -properties RAW~('+$json+')~END -location "'+$location+'"') | Out-Null
    $sent=$true
  }
  return $sent
}
