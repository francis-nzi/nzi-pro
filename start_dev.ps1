# Starts backend (FastAPI) and frontend (Next.js) in separate PowerShell windows.

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Project root: $projectRoot" -ForegroundColor Cyan

$backendScript = Join-Path $projectRoot "start_backend.ps1"
$frontendScript = Join-Path $projectRoot "start_frontend.ps1"

# Start backend
Write-Host "Starting backend..." -ForegroundColor Green
Start-Process -FilePath "powershell.exe" -WorkingDirectory $projectRoot -ArgumentList @(
  "-NoExit",
  "-ExecutionPolicy", "Bypass",
  "-File", $backendScript
)

# Start frontend
Write-Host "Starting frontend..." -ForegroundColor Green
Start-Process -FilePath "powershell.exe" -WorkingDirectory $projectRoot -ArgumentList @(
  "-NoExit",
  "-ExecutionPolicy", "Bypass",
  "-File", $frontendScript
)

Write-Host "Done. Open http://localhost:3000" -ForegroundColor Yellow
