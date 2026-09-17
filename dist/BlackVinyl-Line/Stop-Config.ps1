$content = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'connection.js'))
if ($content -match 'window.BlackVinylConnection\s*=\s*(\{.*\})\s*;') {
  $connection = $Matches[1] | ConvertFrom-Json
  if ($connection.url -match '^http://localhost:187\d\d/$') {
    try { Invoke-RestMethod -Uri ($connection.url+'stop') -Method Post -Headers @{'X-BlackVinyl-Token'=$connection.token} | Out-Null } catch {}
  }
}
