# Tests the Windows installer on a real Windows (GitHub Actions windows-latest): install, start the
# tray program, the server answering, the server stopping when the tray program is ended (as Task
# Manager does), an update keeping the data, and removing.
#   pwsh packaging/windows/test-install.ps1 out\vidalune-<version>-setup.exe
param([Parameter(Mandatory = $true)][string]$Installer)
$ErrorActionPreference = 'Stop'
$setup = (Resolve-Path $Installer).Path
$dir = Join-Path $env:ProgramFiles 'Vidalune'
$data = Join-Path $env:ProgramData 'Vidalune'
$log = Join-Path $data 'logs\vidalune.log'

function Fail([string]$why) {
  Write-Host "FAILED: $why"
  $ErrorActionPreference = 'Continue'
  Write-Host "--- who ($([Security.Principal.WindowsIdentity]::GetCurrent().Name)) ---"
  whoami /groups | Select-String 'S-1-5-32-544|Mandatory Label'
  if (Test-Path $data) { Write-Host '--- data folder rights ---'; icacls $data /T /C }
  if (Test-Path $log) { Write-Host '--- vidalune.log ---'; Get-Content $log -Tail 80 }
  $tmp = Join-Path ([IO.Path]::GetTempPath()) 'vidalune-tray.log'
  if (Test-Path $tmp) { Write-Host '--- vidalune-tray.log ---'; Get-Content $tmp -Tail 40 }
  Get-Process VidaluneTray, node -ErrorAction SilentlyContinue | Format-Table Id, Name, Path, StartTime
  exit 1
}

function Answers {
  try { return (Invoke-WebRequest 'http://127.0.0.1:3000/health' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { return $false }
}

function Start-Tray {
  $p = Start-Process (Join-Path $dir 'VidaluneTray.exe') -PassThru
  for ($i = 0; $i -lt 60; $i++) { if (Answers) { return $p }; Start-Sleep 2 }
  if ($p.HasExited) { Write-Host "The tray program ended at $($p.ExitTime) (started $($p.StartTime)) with exit code $($p.ExitCode)" } else { Write-Host 'The tray program is still running' }
  Get-WinEvent -FilterHashtable @{ LogName = 'Application'; Level = 2; StartTime = (Get-Date).AddMinutes(-10) } -MaxEvents 5 -ErrorAction SilentlyContinue | Format-List TimeCreated, ProviderName, Message
  Fail 'the server did not start from the tray program'
}

function Server-Processes { @(Get-Process node, ffmpeg -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$dir\*" }) }

function Install {
  $p = Start-Process $setup -ArgumentList '/S' -Wait -PassThru
  if ($p.ExitCode -ne 0) { Fail "installer exited with $($p.ExitCode)" }
}

Write-Host 'Install'
Install
foreach ($f in 'VidaluneTray.exe', 'Uninstall.exe', 'node\node.exe', 'ffmpeg\ffmpeg.exe', 'ffmpeg\ffprobe.exe', 'app\backend\dist\index.js', 'app\frontend\dist\index.html') {
  if (-not (Test-Path (Join-Path $dir $f))) { Fail "missing $f" }
}
if (-not (Test-Path (Join-Path $data 'vidalune.env'))) { Fail 'no vidalune.env in the data folder' }
$run = (Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run').Vidalune
if ($run -notlike '*VidaluneTray.exe*') { Fail 'does not start at sign-in' }
$rule = Get-NetFirewallRule -DisplayName 'Vidalune' -ErrorAction SilentlyContinue
if (-not $rule) { Fail 'no firewall rule' }
$program = ($rule | Get-NetFirewallApplicationFilter).Program
if ($program -notlike '*\node\node.exe') { Fail "the firewall rule is for $program, not Vidalune's node.exe" }
if ([string]$rule.Profile -match 'Public|Any') { Fail "the firewall rule is open on public networks ($($rule.Profile))" }
# Other users of this PC cannot read the database or change vidalune.env.
$users = (Get-Acl $data).Access | Where-Object { $_.IdentityReference.Value -match '\\Users$|^Everyone$|Authenticated Users' }
if ($users) { Fail "the data folder is open to other users: $($users.IdentityReference -join ', ')" }
& (Join-Path $dir 'ffmpeg\ffprobe.exe') -hide_banner -version | Select-Object -First 1

Write-Host 'Start the tray program'
$tray = Start-Tray
$page = Invoke-WebRequest 'http://127.0.0.1:3000/' -UseBasicParsing -TimeoutSec 10
if ($page.Content -notmatch 'Vidalune') { Fail 'the website is not served' }
$info = Invoke-RestMethod 'http://127.0.0.1:3000/api/server/info' -TimeoutSec 10
Write-Host "Server $($info.version), setup required: $($info.setupRequired)"
Start-Sleep 7
if (-not (Test-Path (Join-Path $data 'status.json'))) { Fail 'the server writes no status for the tray program' }
if (-not (Test-Path (Join-Path $data 'velyx.db'))) { Fail 'no database in the data folder' }
if (@(Server-Processes).Count -eq 0) { Fail 'no server process found' }

Write-Host 'End the tray program as Task Manager does'
Stop-Process -Id $tray.Id -Force
Start-Sleep 3
if (@(Server-Processes).Count -gt 0) { Fail 'the server keeps running after the tray program was ended' }
if (Answers) { Fail 'the server still answers after the tray program was ended' }

Write-Host 'Update over a running Vidalune'
$tray = Start-Tray
Install
if (@(Server-Processes).Count -gt 0) { Fail 'the installer left the old server running' }
if (-not (Test-Path (Join-Path $data 'velyx.db'))) { Fail 'the update removed the data' }
$tray = Start-Tray
Stop-Process -Id $tray.Id -Force
Start-Sleep 3

Write-Host 'Remove'
Start-Process (Join-Path $dir 'Uninstall.exe') -ArgumentList '/S' -Wait
for ($i = 0; $i -lt 30 -and (Test-Path (Join-Path $dir 'VidaluneTray.exe')); $i++) { Start-Sleep 1 }
if (Test-Path (Join-Path $dir 'VidaluneTray.exe')) { Fail 'not removed' }
if ((Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run').Vidalune) { Fail 'still starts at sign-in' }
if (-not (Test-Path (Join-Path $data 'velyx.db'))) { Fail 'removing silently also removed the data' }
Write-Host 'All good'
