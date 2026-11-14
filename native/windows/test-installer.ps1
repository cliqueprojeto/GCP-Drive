# Installs, starts, upgrades and uninstalls GCP-Drive silently and checks what each step leaves behind.
# No account is connected: account folders and the Explorer are not involved.
$ErrorActionPreference = 'Stop'
$installer = (Get-ChildItem "$PSScriptRoot\build\GCP-Drive-*-instalador.exe" | Select-Object -First 1).FullName
$dir = "$env:LOCALAPPDATA\Programs\GCP-Drive"
$exe = "$dir\gcp-drive.exe"
$run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$uninstall = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\GCP-Drive'
$shortcut = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\GCP-Drive.lnk"
function Check($ok, $what) { if (-not $ok) { throw "FAILED: $what" } else { Write-Host "ok: $what" } }
function Answers { for ($i = 0; $i -lt 40; $i++) { if ((Start-Process $exe -ArgumentList 'status' -Wait -PassThru).ExitCode -eq 0) { return $true }; Start-Sleep -Milliseconds 500 }; return $false }

Set-Content "$PSScriptRoot\build\google-oauth.json" '{"installed":{"client_id":"teste","client_secret":"teste"}}'
Start-Process $installer -ArgumentList '/S' -Wait
Check (Test-Path $exe) 'program installed for the user'
Check (Test-Path "$dir\Desinstalar.exe") 'uninstaller present'
Check (Test-Path "$dir\google-oauth.json") 'registration file next to the installer was copied'
Check ((Get-ItemProperty $run).'GCP-Drive' -like '*gcp-drive.exe" daemon') 'starts with Windows'
Check (Test-Path $uninstall) 'listed among installed programs'
Check (Test-Path $shortcut) 'Start menu shortcut'

$service = Start-Process $exe -ArgumentList 'daemon' -PassThru
Check (Answers) 'service answers on its control socket'

Start-Process $installer -ArgumentList '/S' -Wait
Check ($service.WaitForExit(15000)) 'installing over a running service stopped it'
Check (Test-Path $exe) 'program replaced'

$service = Start-Process $exe -ArgumentList 'daemon' -PassThru
Check (Answers) 'service answers after the upgrade'
Start-Process "$dir\Desinstalar.exe" -ArgumentList '/S', "_?=$dir" -Wait
Check ($service.WaitForExit(15000)) 'uninstalling stopped the service'
Check (-not (Test-Path $exe)) 'program removed'
Check (-not (Test-Path "$dir\google-oauth.json")) 'registration file removed'
Check ($null -eq (Get-ItemProperty $run).'GCP-Drive') 'no longer starts with Windows'
Check (-not (Test-Path $uninstall)) 'no longer listed among installed programs'
Check (-not (Test-Path $shortcut)) 'shortcut removed'
Check (-not (Test-Path "$env:LOCALAPPDATA\GCP-Drive\cache")) 'cache removed'
