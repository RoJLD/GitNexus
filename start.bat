@echo off
REM GitNexus launcher (idempotent). Builds the derived image if needed, starts
REM the containers via Rancher Desktop's Docker engine, waits for the API to be
REM healthy, then opens the UI in the default browser.
REM
REM To create a desktop shortcut: right-click this file, "Send to" -> "Desktop
REM (create shortcut)". Rename to "GitNexus" if you like.

setlocal
cd /d "%~dp0"

echo.
echo === GitNexus launcher ===
echo.

REM --- 1. .env present? ---
if not exist ".env" (
    echo .env is missing. Copy .env.example to .env and set PROJECTS_ROOT
    echo to your absolute host path before launching.
    echo.
    pause
    exit /b 1
)

REM --- 2. Docker daemon reachable? Try to auto-start Rancher / Docker Desktop. ---
docker info >nul 2>&1
if not errorlevel 1 goto docker_ok

set "DOCKER_APP="
if exist "%ProgramFiles%\Rancher Desktop\Rancher Desktop.exe" set "DOCKER_APP=%ProgramFiles%\Rancher Desktop\Rancher Desktop.exe"
if not defined DOCKER_APP if exist "%LOCALAPPDATA%\Programs\Rancher Desktop\Rancher Desktop.exe" set "DOCKER_APP=%LOCALAPPDATA%\Programs\Rancher Desktop\Rancher Desktop.exe"
if not defined DOCKER_APP if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" set "DOCKER_APP=%ProgramFiles%\Docker\Docker\Docker Desktop.exe"

if not defined DOCKER_APP (
    echo Docker is not reachable and no Rancher / Docker Desktop install was found.
    echo Start it manually then relaunch.
    echo.
    pause
    exit /b 1
)

echo Docker daemon not reachable. Starting "%DOCKER_APP%" ...
start "" "%DOCKER_APP%"

set /a dcount=0
:waitdocker
timeout /t 2 /nobreak >nul
docker info >nul 2>&1
if not errorlevel 1 goto dockerready
set /a dcount+=1
if %dcount% geq 90 (
    echo Docker did not become reachable within 180s. Open Rancher / Docker Desktop and retry.
    pause
    exit /b 1
)
goto waitdocker
:dockerready
echo Docker is up.
:docker_ok

REM --- 2. Already up? Just open the browser. ---
for /f %%i in ('docker ps -q --filter "name=^gitnexus$" --filter "status=running" 2^>nul') do (
    echo GitNexus is already running. Opening UI...
    start "" "http://localhost:4173"
    exit /b 0
)

REM --- 3. Release stale container names from a previous compose project ---
docker rm -f gitnexus       >nul 2>&1
docker rm -f gitnexus-web   >nul 2>&1

REM --- 4. Build (no-op if cached) and start ---
echo Starting (this may take ~30s on first run)...
docker compose up -d --build
if errorlevel 1 (
    echo.
    echo docker compose up failed. Try running 'docker compose logs' in this folder.
    pause
    exit /b 1
)

REM --- 5. Wait for API health (60s max) ---
echo Waiting for API on :4747 ...
set /a count=0
:wait
curl -sf -o nul http://localhost:4747/api/health 2>nul
if not errorlevel 1 goto ready
set /a count+=1
if %count% geq 60 (
    echo API did not respond within 60s. Check 'docker compose logs gitnexus'.
    pause
    exit /b 1
)
timeout /t 1 /nobreak >nul
goto wait
:ready

echo.
echo === GitNexus is up ===
echo   API:  http://localhost:4747
echo   UI:   http://localhost:4173
echo.

start "" "http://localhost:4173"
endlocal
