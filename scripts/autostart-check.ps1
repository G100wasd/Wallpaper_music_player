$ErrorActionPreference = 'Stop'
$projectPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$fixture = Join-Path $projectPath 'output\qa\autostart-test'
$startupTestPath = Join-Path $fixture 'Startup'
$movedPath = Join-Path $fixture ('moved wallpaper ' + [char]0x4E2D + [char]0x6587)
[IO.Directory]::CreateDirectory($startupTestPath) | Out-Null
[IO.Directory]::CreateDirectory($movedPath) | Out-Null
$executable = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$script = Join-Path $projectPath 'Setup-Autostart.ps1'
$linkPath = Join-Path $startupTestPath 'BlackVinyl-Config.lnk'
$shell = New-Object -ComObject WScript.Shell
function Assert($condition,$description){if(-not $condition){throw $description};Write-Output ('PASS '+$description)}
foreach($name in @('Setup-Autostart.ps1','Config-Helper.ps1','config.html')){Copy-Item -LiteralPath (Join-Path $projectPath $name) -Destination (Join-Path $movedPath $name) -Force}
try {
  & $executable -NoProfile -ExecutionPolicy Bypass -File $script -Action Enable -StartupDirectory $startupTestPath -SkipStart | Out-Null
  Assert ($LASTEXITCODE -eq 0 -and [IO.File]::Exists($linkPath)) 'creates isolated login shortcut'
  $link=$shell.CreateShortcut($linkPath)
  Assert ($link.TargetPath -eq $executable -and $link.WorkingDirectory -eq $projectPath) 'shortcut uses Windows PowerShell and correct wallpaper directory'
  Assert ($link.Arguments.EndsWith('" -QuietStartup') -and $link.Arguments.Contains('-WindowStyle Hidden') -and $link.Arguments.Contains('-File "')) 'login command stays hidden and quotes the script path'
  & $executable -NoProfile -ExecutionPolicy Bypass -File $script -Action Enable -StartupDirectory $startupTestPath -SkipStart | Out-Null
  Assert (@(Get-ChildItem -LiteralPath $startupTestPath -Filter '*.lnk').Count -eq 1) 'repeated enable does not duplicate startup entries'
  & $executable -NoProfile -ExecutionPolicy Bypass -File (Join-Path $movedPath 'Setup-Autostart.ps1') -Action Enable -StartupDirectory $startupTestPath -SkipStart | Out-Null
  $link=$shell.CreateShortcut($linkPath)
  Assert ($LASTEXITCODE -eq 0 -and $link.WorkingDirectory -eq $movedPath -and $link.Arguments.Contains($movedPath)) 're-enable updates moved paths including spaces and Unicode'
  & $executable -NoProfile -ExecutionPolicy Bypass -File $script -Action Disable -StartupDirectory $startupTestPath | Out-Null
  Assert ($LASTEXITCODE -eq 0 -and -not [IO.File]::Exists($linkPath)) 'disable removes only this application shortcut'
  & $executable -NoProfile -ExecutionPolicy Bypass -File $script -Action Disable -StartupDirectory $startupTestPath | Out-Null
  Assert ($LASTEXITCODE -eq 0) 'repeated disable is safe'
  $foreign=$shell.CreateShortcut($linkPath);$foreign.TargetPath=$executable;$foreign.Description='Unrelated test shortcut';$foreign.Save()
  & $executable -NoProfile -ExecutionPolicy Bypass -File $script -Action Enable -StartupDirectory $startupTestPath -SkipStart | Out-Null
  Assert ($LASTEXITCODE -eq 1 -and $shell.CreateShortcut($linkPath).Description -eq 'Unrelated test shortcut') 'unrelated matching filename is preserved'
} finally {
  if([IO.File]::Exists($linkPath)){Remove-Item -LiteralPath $linkPath -Force}
}
Write-Output 'PASS all startup changes were confined to the test folder; actual Windows startup was not changed'
