param(
  [ValidateSet('Enable','Disable')][string]$Action = 'Enable',
  [string]$StartupDirectory = '',
  [switch]$SkipStart
)
$ErrorActionPreference = 'Stop'
try {
  # This installer only creates or removes a current-user shortcut.
  # The helper is started separately by the CMD launcher.
  if (-not $StartupDirectory) { $StartupDirectory = [Environment]::GetFolderPath('Startup') }
  $startupPath = [IO.Path]::GetFullPath($StartupDirectory)
  if (-not [IO.Directory]::Exists($startupPath)) { throw '找不到当前用户的启动文件夹。' }
  $rootPath = [IO.Path]::GetFullPath($PSScriptRoot)
  $shortcutPath = Join-Path $startupPath 'BlackVinyl-Config.lnk'
  $description = 'Black Vinyl configuration helper - current user login startup'
  $shell = New-Object -ComObject WScript.Shell
  if ([IO.File]::Exists($shortcutPath)) {
    $existing = $shell.CreateShortcut($shortcutPath)
    if ($existing.Description -ne $description) { throw '同名启动项不属于本壁纸，未修改它。' }
  }
  if ($Action -eq 'Disable') {
    if ([IO.File]::Exists($shortcutPath)) { Remove-Item -LiteralPath $shortcutPath -Force }
    Write-Host '已取消自动启动。若要立即停止助手，请运行 Stop-Config.cmd。'
    exit 0
  }
  $helperPath = Join-Path $rootPath 'Config-Helper.ps1'
  if (-not [IO.File]::Exists($helperPath) -or -not [IO.File]::Exists((Join-Path $rootPath 'config.html'))) {
    throw '壁纸文件不完整，请将整个压缩包解压后再运行。'
  }
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $helperPath + '" -QuietStartup'
  $shortcut.WorkingDirectory = $rootPath
  $shortcut.WindowStyle = 7
  $shortcut.Description = $description
  $shortcut.Save()
  Write-Host '已启用自动启动。以后登录 Windows 时助手会静默启动，不会打开浏览器。'
  Write-Host ('对应壁纸目录：' + $rootPath)
  Write-Host '首次设置一次即可；重复运行会更新目录，不会重复添加。'
} catch {
  Write-Host ('操作失败：' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
