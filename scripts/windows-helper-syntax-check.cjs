const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const files = [ ...fs.readdirSync('.').filter(f => f.endsWith('.ps1')), ...fs.readdirSync('engine').filter(f => f.endsWith('.ps1')).map(f => 'engine/' + f) ];
const literal = f => "'" + path.resolve(f).replace(/'/g, "''") + "'";
const script = `[Console]::OutputEncoding=[Text.Encoding]::UTF8;$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';
foreach($file in @(${files.map(literal).join(',')})){
 $errors=$null;[Management.Automation.Language.Parser]::ParseFile($file,[ref]$null,[ref]$errors)|Out-Null;
 if($errors){$errors|ForEach-Object{Write-Output ($file+': '+$_.Message)};exit 1}
}
Add-Type -Path @(${['engine/AudioDevice.cs','engine/LoopbackWave.cs'].map(literal).join(',')});
'PASS Windows PowerShell 5.1: all helper scripts parse, audio modules compile';`;
const result = spawnSync(path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, encoding: 'utf8' });
process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
if (result.error) console.error(result.error);
process.exitCode = result.status === 0 ? 0 : 1;
