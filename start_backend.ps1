# PowerShell script to start backend with UTF-8-safe process settings.

$ErrorActionPreference = "Stop"

# Force UTF-8 I/O for Python process to avoid Windows cp1252 encode issues.
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

# Ensure the backend starts from this script's directory so `api.main` resolves.
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir
Write-Host "Backend root: $scriptDir" -ForegroundColor Cyan

$pythonExe = Join-Path $scriptDir ".venv\Scripts\python.exe"
if (-not (Test-Path $pythonExe)) {
    $pythonExe = Join-Path $scriptDir "venv\Scripts\python.exe"
}
if (-not (Test-Path $pythonExe)) {
    $pythonExe = "python"
}

# Prevent duplicate backend instances serving stale code on the same port.
$port = 8000
$listenerPids = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)

if ($listenerPids.Count -gt 0) {
    Write-Host "Stopping existing process(es) on port ${port}: $($listenerPids -join ', ')" -ForegroundColor Yellow
    foreach ($listenerPid in $listenerPids) {
        try {
            $proc = Get-Process -Id $listenerPid -ErrorAction Stop
            Stop-Process -Id $listenerPid -Force -ErrorAction Stop
            Write-Host "Stopped PID $listenerPid ($($proc.ProcessName))" -ForegroundColor DarkYellow
        }
        catch {
            Write-Warning "Could not stop PID ${listenerPid}: $($_.Exception.Message)"
        }
    }
    Start-Sleep -Seconds 1
}

Write-Host "Starting backend server with $pythonExe ..." -ForegroundColor Green
& $pythonExe -m uvicorn api.main:app --reload --host 0.0.0.0 --port 8000 --app-dir "$scriptDir"
