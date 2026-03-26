$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$startScript = Join-Path $projectRoot "start_dev.ps1"

if (-not (Test-Path $startScript)) {
  throw "Could not find start_dev.ps1 at $startScript"
}

Write-Host "Restarting frontend and backend..." -ForegroundColor Cyan
& powershell.exe -ExecutionPolicy Bypass -File $startScript
