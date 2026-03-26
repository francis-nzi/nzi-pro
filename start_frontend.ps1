$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendDir = Join-Path $projectRoot "frontend"

if (-not (Test-Path $frontendDir)) {
  throw "Frontend directory not found: $frontendDir"
}

function Stop-ProcessOnPort {
  param(
    [Parameter(Mandatory = $true)][int]$Port
  )

  $listenerPids = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)

  foreach ($listenerPid in $listenerPids) {
    try {
      $proc = Get-Process -Id $listenerPid -ErrorAction Stop
      Write-Host "Stopping process on port ${Port}: PID ${listenerPid} ($($proc.ProcessName))" -ForegroundColor Yellow
      Stop-Process -Id $listenerPid -Force -ErrorAction Stop
    }
    catch {
      Write-Warning "Could not stop PID ${listenerPid} on port ${Port}: $($_.Exception.Message)"
    }
  }
}

Write-Host "Frontend root: $frontendDir" -ForegroundColor Cyan

# Keep the frontend restart idempotent and avoid stale lock/cache issues.
Stop-ProcessOnPort -Port 3000
Stop-ProcessOnPort -Port 3001

$nextRuntime = Join-Path $frontendDir ".next_runtime"
if (Test-Path $nextRuntime) {
  try {
    Write-Host "Removing stale Next runtime folder: $nextRuntime" -ForegroundColor Yellow
    Remove-Item -LiteralPath $nextRuntime -Recurse -Force
  }
  catch {
    Write-Warning "Could not remove ${nextRuntime}: $($_.Exception.Message)"
  }
}

Set-Location $frontendDir
Write-Host "Starting frontend server..." -ForegroundColor Green
& npm.cmd run dev
