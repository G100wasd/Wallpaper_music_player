$ErrorActionPreference='Stop'
Add-Type -Path @((Join-Path $PSScriptRoot '..\engine\AudioDevice.cs'),(Join-Path $PSScriptRoot '..\engine\LoopbackWave.cs'))
function Assert-Close($actual,$expected){if([Math]::Abs($actual-$expected) -gt 0.0001){throw "Sample decode mismatch: $actual"}}
Assert-Close ([BlackVinylLoopbackWave]::Decode([BitConverter]::GetBytes([single]0.25),0,$true,32)) 0.25
Assert-Close ([BlackVinylLoopbackWave]::Decode([BitConverter]::GetBytes([single]::NaN),0,$true,32)) 0
Assert-Close ([BlackVinylLoopbackWave]::Decode([BitConverter]::GetBytes([int16]-32768),0,$false,16)) -1
Assert-Close ([BlackVinylLoopbackWave]::Decode([byte[]]@(0,0,128),0,$false,24)) -1
Assert-Close ([BlackVinylLoopbackWave]::Decode([byte[]]@(255,255,127),0,$false,24)) 1
Assert-Close ([BlackVinylLoopbackWave]::Decode([BitConverter]::GetBytes([int32]::MinValue),0,$false,32)) -1
$capture=New-Object BlackVinylLoopbackWave
try {
  for($i=0;$i -lt 30;$i++){ $frame=$capture.Read();if($frame.available){break};Start-Sleep -Milliseconds 100 }
  if(-not $frame.available){throw $frame.error}
  if($frame.left.Length -ne 512 -or $frame.right.Length -ne 512 -or $frame.sampleRate -le 0){throw 'Invalid native snapshot'}
  $rate=$frame.sampleRate
  Start-Sleep -Milliseconds 4300
  if($capture.Read().available){throw 'Capture did not stop when no consumer was polling'}
  for($i=0;$i -lt 30;$i++){Start-Sleep -Milliseconds 100;$frame=$capture.Read();if($frame.available){break}}
  if(-not $frame.available){throw 'Capture did not resume'}
  Write-Output "PASS native loopback $rate Hz, signed PCM/float decode, 512 independent channels, idle release and resume"
} finally {$capture.Dispose()}
