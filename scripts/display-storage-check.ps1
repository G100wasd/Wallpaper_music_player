$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $PSScriptRoot
$rootPath = Join-Path ([IO.Path]::GetTempPath()) ('black-vinyl-display-storage-' + [guid]::NewGuid().ToString('N'))
$expectedRoot = [IO.Path]::GetFullPath($rootPath)
New-Item -ItemType Directory -Path $rootPath | Out-Null
try {
    $utf8 = New-Object Text.UTF8Encoding($false)
    $configPath = Join-Path $rootPath 'config.json'
    $parseErrors = $null
    $helperAst = [Management.Automation.Language.Parser]::ParseFile((Join-Path $sourceRoot 'Config-Helper.ps1'), [ref]$null, [ref]$parseErrors)
    if ($parseErrors) { throw 'Helper syntax errors' }
    $writer = $helperAst.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Write-JsonFile' }, $true)
    if (-not $writer) { throw 'Configuration writer missing' }
    . ([scriptblock]::Create($writer.Extent.Text))
    . (Join-Path $sourceRoot 'engine\display-sync.ps1')

    $initial = Get-Content -LiteralPath (Join-Path $sourceRoot 'config.default.json') -Raw | ConvertFrom-Json
    $initial.settings.playerScale = 0.85
    $initial.settings.volume = 0.35
    $initial.background.color = '#123456'
    Write-JsonFile $configPath $initial
    $saved = Update-Display ([pscustomobject]@{infoScale=1.25;playerScale=1.15;listScale=0.75;waveGain=2.3})
    $current = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $previous = Get-Content -LiteralPath (Join-Path $rootPath 'config.previous.json') -Raw | ConvertFrom-Json
    $snapshot = Get-Content -LiteralPath (Join-Path $rootPath 'config-data.js') -Raw
    $snapshot = $snapshot.Substring('window.BlackVinylDiskConfig = '.Length).TrimEnd(';') | ConvertFrom-Json
    foreach ($key in $displayKeys) {
        if ($current.settings.$key -ne $saved[$key] -or $snapshot.settings.$key -ne $saved[$key]) { throw ('Display value mismatch: ' + $key) }
    }
    if ($current.settings.playerScale -ne 1.15 -or $current.settings.waveGain -ne 2.3) { throw 'Display changes not written' }
    if ($current.settings.volume -ne 0.35 -or $current.background.color -ne '#123456') { throw 'Unrelated settings changed' }
    if ($previous.settings.playerScale -ne 0.85) { throw 'Previous configuration backup missing' }
    $before = [IO.File]::ReadAllText($configPath)
    $rejected = $false
    try { Update-Display ([pscustomobject]@{playerScale=9}) | Out-Null } catch { $rejected = $true }
    if (-not $rejected -or [IO.File]::ReadAllText($configPath) -ne $before) { throw 'Invalid display settings were not rejected atomically' }
    Write-Output 'PASS actual PowerShell display save, offline snapshot, previous backup, unrelated data preservation and range validation; no HTTP service'
} finally {
    $resolved = (Resolve-Path -LiteralPath $rootPath).Path
    if ($resolved -ne $expectedRoot -or [IO.Path]::GetDirectoryName($resolved) -ne [IO.Path]::GetTempPath().TrimEnd('\')) { throw 'Unexpected test cleanup target' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
