# GitNexus launcher (idempotent). Builds the derived image if needed, starts
# the containers via Rancher Desktop's Docker engine, waits for the API to be
# healthy, then opens the UI in the default browser.

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

# --- 1. .env present? ---
if (-not (Test-Path ".env")) {
    Write-Host ""
    Write-Host "  .env is missing. Copy .env.example to .env and set PROJECTS_ROOT" -ForegroundColor Red
    Write-Host "  to your absolute host path before launching." -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

# --- 2. Docker daemon reachable? Try to auto-start Rancher / Docker Desktop. ---
function Test-Docker {
    $null = docker info 2>&1
    return ($LASTEXITCODE -eq 0)
}

if (-not (Test-Docker)) {
    $candidates = @(
        "$env:ProgramFiles\Rancher Desktop\Rancher Desktop.exe",
        "$env:LOCALAPPDATA\Programs\Rancher Desktop\Rancher Desktop.exe",
        "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
    )
    $dockerApp = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1

    if (-not $dockerApp) {
        Write-Host ""
        Write-Host "  Docker is not reachable and no Rancher / Docker Desktop install was found." -ForegroundColor Red
        Write-Host "  Start it manually then relaunch." -ForegroundColor Red
        Write-Host ""
        Read-Host "Press Enter to exit"
        exit 1
    }

    Write-Host "Docker daemon not reachable. Starting `"$dockerApp`" ..." -ForegroundColor Yellow
    Start-Process -FilePath $dockerApp

    $timeoutSec = 180
    $start = Get-Date
    $ready = $false
    while (((Get-Date) - $start).TotalSeconds -lt $timeoutSec) {
        Start-Sleep -Seconds 2
        if (Test-Docker) { $ready = $true; break }
    }

    if (-not $ready) {
        Write-Host "  Docker did not become reachable within ${timeoutSec}s. Open Rancher / Docker Desktop and retry." -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Host "Docker is up." -ForegroundColor Green
}

# --- 2. Release container names from a previous compose project, if any ---
# Old setup may have left "gitnexus" / "gitnexus-web" containers labeled with
# a different compose-project (e.g. the experiment repo). Names are unique on
# the daemon, so we must release them before our compose can recreate them.
foreach ($name in @("gitnexus", "gitnexus-web")) {
    $exists = docker ps -aq --filter "name=^$name$" 2>$null
    if ($exists) {
        $project = docker inspect $name --format '{{ index .Config.Labels "com.docker.compose.project" }}' 2>$null
        if ($project -and $project -ne "gitnexus") {
            Write-Host "Releasing $name from previous compose project ($project)..." -ForegroundColor Yellow
            docker rm -f $name 2>&1 | Out-Null
        }
    }
}

# --- 3. Ensure images are current ---
Write-Host "Building derived image (no-op if unchanged)..." -ForegroundColor Cyan
docker compose build gitnexus 2>&1 | Out-Null

Write-Host "Pulling upstream gitnexus-web..." -ForegroundColor Cyan
docker compose pull gitnexus-web 2>&1 | Out-Null

# --- 4. Start services ---
Write-Host "Starting services..." -ForegroundColor Cyan
docker compose up -d 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  docker compose up failed. Check 'docker compose logs' for details." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# --- 5. Wait for API health ---
Write-Host "Waiting for GitNexus API on http://localhost:4747 ..." -ForegroundColor Cyan
$timeoutSec = 60
$start = Get-Date
$ready = $false
while (((Get-Date) - $start).TotalSeconds -lt $timeoutSec) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:4747/api/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch {
        Start-Sleep -Milliseconds 500
    }
}

if (-not $ready) {
    Write-Host "  API did not respond within ${timeoutSec}s. Check 'docker compose logs gitnexus'." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# --- 6. Open the UI ---
Write-Host ""
Write-Host "  GitNexus is up." -ForegroundColor Green
Write-Host "  API:  http://localhost:4747" -ForegroundColor Green
Write-Host "  UI:   http://localhost:4173" -ForegroundColor Green
Write-Host ""
Start-Process "http://localhost:4173"
