# GitNexus launcher (idempotent). Builds the derived images if needed, starts
# the containers via Rancher Desktop's Docker engine, waits for the API to be
# healthy, then opens the UI in the default browser.
#
# Stale-detection strategy : always run `docker compose build` for both
# services (Docker layer cache makes it fast if nothing changed), then
# compare image SHAs before and after. If either changed, containers are
# recreated. If unchanged AND containers are up, just open the browser.
#
# Both gitnexus (derived from upstream :1.6.5 + Dockerfile.cli patches) AND
# gitnexus-web (built from upstream/Dockerfile.web with React-side patches)
# are local builds, so the previous `compose pull gitnexus-web` step was a
# no-op and has been removed.

# NOTE : we do NOT set $ErrorActionPreference = "Stop" globally because under
# Windows PowerShell that turns every native-command stderr write into a
# NativeCommandError (e.g. `docker info` emits "WARNING: No swap limit
# support" on Linux daemons → script aborts). Each step below checks
# $LASTEXITCODE explicitly instead.
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
    docker info *>$null
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

# --- 3. Release container names from a previous compose project, if any ---
# Old setup may have left "gitnexus" / "gitnexus-web" containers labeled with
# a different compose-project (e.g. the experiment repo). Names are unique on
# the daemon, so we must release them before our compose can recreate them.
foreach ($name in @("gitnexus", "gitnexus-web")) {
    $exists = docker ps -aq --filter "name=^$name$" 2>$null
    if ($exists) {
        $project = docker inspect $name --format '{{ index .Config.Labels "com.docker.compose.project" }}' 2>$null
        if ($project -and $project -ne "gitnexus") {
            Write-Host "Releasing $name from previous compose project ($project)..." -ForegroundColor Yellow
            docker rm -f $name *>$null
        }
    }
}

# --- 4. Refresh images. Layer cache makes this fast when nothing changed. ---
function Get-ImageId([string]$tag) {
    return (docker images -q $tag 2>$null | Select-Object -First 1)
}

# Source-file -> rebuild reason mapping. Helps the user understand WHY a
# rebuild was triggered (vs an opaque "image rebuilt" message).
function Get-RebuildReason([string]$service) {
    $sourcePaths = @{
        "gitnexus" = @(
            "Dockerfile.cli",
            "scripts"
        )
        "gitnexus-web" = @(
            "upstream/Dockerfile.web",
            "upstream/gitnexus-web/src",
            "upstream/docker-server.mjs",
            "upstream/package.json"
        )
    }
    $imageTag = if ($service -eq "gitnexus") { "gitnexus-derived:1.6.5-patched" } else { "gitnexus-web-derived:1.6.5-patched" }
    $imgCreated = docker image inspect $imageTag --format '{{.Created}}' 2>$null
    if (-not $imgCreated) { return $null }
    $imgDate = Get-Date $imgCreated

    $newest = $null
    foreach ($path in $sourcePaths[$service]) {
        if (-not (Test-Path $path)) { continue }
        $item = Get-Item $path
        if ($item.PSIsContainer) {
            $files = Get-ChildItem -Path $path -Recurse -File -ErrorAction SilentlyContinue
        } else {
            $files = @($item)
        }
        foreach ($f in $files) {
            if ($null -eq $newest -or $f.LastWriteTime -gt $newest.LastWriteTime) {
                $newest = $f
            }
        }
    }
    if ($null -ne $newest -and $newest.LastWriteTime -gt $imgDate) {
        return (Resolve-Path -Path $newest.FullName -Relative)
    }
    return $null
}

Write-Host "Checking image freshness..." -ForegroundColor Cyan
$beforeIds = @{
    "gitnexus" = Get-ImageId "gitnexus-derived:1.6.5-patched"
    "gitnexus-web" = Get-ImageId "gitnexus-web-derived:1.6.5-patched"
}
$reasons = @{
    "gitnexus" = Get-RebuildReason "gitnexus"
    "gitnexus-web" = Get-RebuildReason "gitnexus-web"
}
foreach ($svc in @("gitnexus", "gitnexus-web")) {
    if ($reasons[$svc]) {
        Write-Host "  $svc : will rebuild ($($reasons[$svc]) newer than image)" -ForegroundColor Yellow
    }
}

docker compose build *>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  docker compose build failed. Run 'docker compose build' for details." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

$afterIds = @{
    "gitnexus" = Get-ImageId "gitnexus-derived:1.6.5-patched"
    "gitnexus-web" = Get-ImageId "gitnexus-web-derived:1.6.5-patched"
}

$anyImageChanged = $false
foreach ($svc in @("gitnexus", "gitnexus-web")) {
    if ($beforeIds[$svc] -ne $afterIds[$svc]) {
        $anyImageChanged = $true
        if (-not $beforeIds[$svc]) {
            Write-Host "  $svc : built $($afterIds[$svc]) for the first time." -ForegroundColor Yellow
        } else {
            Write-Host "  $svc : rebuilt $($beforeIds[$svc]) -> $($afterIds[$svc])." -ForegroundColor Yellow
        }
    } else {
        Write-Host "  $svc : unchanged ($($afterIds[$svc]))." -ForegroundColor DarkGray
    }
}

# --- 5. Already running with the current images? Just open the browser. ---
$runningCount = (docker ps -q --filter "name=^gitnexus$" --filter "status=running" 2>$null |
    Measure-Object).Count
$runningWebCount = (docker ps -q --filter "name=^gitnexus-web$" --filter "status=running" 2>$null |
    Measure-Object).Count
$bothRunning = ($runningCount -gt 0 -and $runningWebCount -gt 0)

if ($bothRunning -and -not $anyImageChanged) {
    Write-Host "GitNexus is already running on the current images. Opening UI..." -ForegroundColor Green
    Start-Process "http://localhost:4173"
    exit 0
}

if ($bothRunning -and $anyImageChanged) {
    Write-Host "Recreating containers on the new images..." -ForegroundColor Yellow
    docker compose down *>$null
}

# --- 6. Start services ---
Write-Host "Starting services..." -ForegroundColor Cyan
docker compose up -d *>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  docker compose up failed. Check 'docker compose logs' for details." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# --- 7. Wait for API health ---
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

# --- 8. Open the UI ---
Write-Host ""
Write-Host "  GitNexus is up." -ForegroundColor Green
Write-Host "  API:  http://localhost:4747" -ForegroundColor Green
Write-Host "  UI:   http://localhost:4173" -ForegroundColor Green
Write-Host ""
Start-Process "http://localhost:4173"
