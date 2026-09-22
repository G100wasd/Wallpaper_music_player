$displayKeys=@('infoScale','playerScale','listScale','waveGain')
function Read-Display($config) {
  $values=@{};foreach($key in $displayKeys){$values[$key]=[double]$config.settings.$key};return $values
}
function Write-ConfigSnapshot($value) {
  $temporary=Join-Path $rootPath 'config.pending.json';Write-JsonFile $temporary $value
  [IO.File]::Replace($temporary,$configPath,(Join-Path $rootPath 'config.previous.json'))
  [IO.File]::WriteAllText((Join-Path $rootPath 'config-data.js'),('window.BlackVinylDiskConfig = '+($value | ConvertTo-Json -Depth 30 -Compress)+';'),$utf8)
}
function Update-Display($patch) {
  $value=[IO.File]::ReadAllText($configPath,$utf8) | ConvertFrom-Json
  $changed=$false
  foreach($key in $displayKeys){
    if($null -eq $patch.PSObject.Properties[$key]){continue}
    $number=[double]$patch.$key;$max=1.5;if($key -eq 'waveGain'){$max=3}
    if([double]::IsNaN($number) -or [double]::IsInfinity($number) -or $number -lt .5 -or $number -gt $max){throw 'Invalid display setting'}
    $number=[Math]::Round($number,2)
    if([double]$value.settings.$key -ne $number){$value.settings.$key=$number;$changed=$true}
  }
  if($changed){Write-ConfigSnapshot $value}
  return (Read-Display $value)
}
