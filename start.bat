@echo off
REM GitNexus launcher (idempotent). Builds the derived images if needed, starts
REM the containers via Rancher Desktop's Docker engine, waits for the API to be
REM healthy, then opens the UI in the default browser.
REM
REM Stale-detection strategy : always run `docker compose build` for both
REM services (Docker layer cache makes it fast if nothing changed), then
REM compare image SHAs before and after. If either changed, containers are
REM recreated. If unchanged AND containers are up, just open the browser.
REM
REM To create a desktop shortcut: right-click this file, "Send to" -> "Desktop
REM (create shortcut)". Rename to "GitNexus" if you like.

setlocal enabledelayedexpansion
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

REM --- 3. Release stale container names from a previous compose project ---
docker rm -f gitnexus       >nul 2>&1
docker rm -f gitnexus-web   >nul 2>&1

REM --- 4. Capture image SHAs before build, refresh, then re-capture ---
echo Checking image freshness...
set "BEFORE_CLI="
set "BEFORE_WEB="
for /f "delims=" %%i in ('docker images -q gitnexus-derived:1.6.5-patched 2^>nul') do set "BEFORE_CLI=%%i"
for /f "delims=" %%i in ('docker images -q gitnexus-web-derived:1.6.5-patched 2^>nul') do set "BEFORE_WEB=%%i"

docker compose build >nul 2>&1
if errorlevel 1 (
    echo docker compose build failed. Try 'docker compose build' for details.
    pause
    exit /b 1
)

set "AFTER_CLI="
set "AFTER_WEB="
for /f "delims=" %%i in ('docker images -q gitnexus-derived:1.6.5-patched 2^>nul') do set "AFTER_CLI=%%i"
for /f "delims=" %%i in ('docker images -q gitnexus-web-derived:1.6.5-patched 2^>nul') do set "AFTER_WEB=%%i"

set "IMAGE_CHANGED=0"
if not "!BEFORE_CLI!"=="!AFTER_CLI!" set "IMAGE_CHANGED=1"
if not "!BEFORE_WEB!"=="!AFTER_WEB!" set "IMAGE_CHANGED=1"

if "!BEFORE_CLI!"=="!AFTER_CLI!" (
    echo   gitnexus     : unchanged !AFTER_CLI!
) else (
    echo   gitnexus     : !BEFORE_CLI! -^> !AFTER_CLI!
)
if "!BEFORE_WEB!"=="!AFTER_WEB!" (
    echo   gitnexus-web : unchanged !AFTER_WEB!
) else (
    echo   gitnexus-web : !BEFORE_WEB! -^> !AFTER_WEB!
)

REM --- 5. Already running with the current images? Just open the browser. ---
set "API_RUNNING=0"
set "WEB_RUNNING=0"
for /f %%i in ('docker ps -q --filter "name=^gitnexus$" --filter "status=running" 2^>nul') do set "API_RUNNING=1"
for /f %%i in ('docker ps -q --filter "name=^gitnexus-web$" --filter "status=running" 2^>nul') do set "WEB_RUNNING=1"

if "!API_RUNNING!"=="1" if "!WEB_RUNNING!"=="1" if "!IMAGE_CHANGED!"=="0" (
    echo GitNexus is already running on the current images. Opening UI...
    start "" "http://localhost:4173"
    exit /b 0
)

if "!IMAGE_CHANGED!"=="1" if "!API_RUNNING!"=="1" (
    echo Recreating containers on the new images...
    docker compose down >nul 2>&1
)

REM --- 6. Start services ---
echo Starting services...
docker compose up -d
if errorlevel 1 (
    echo.
    echo docker compose up failed. Try 'docker compose logs' in this folder.
    pause
    exit /b 1
)

REM --- 7. Wait for API health (60s max) ---
echo Waiting for API on :4747 ...
set /a count=0
:wait
curl -sf -o nul http://localhost:4747/api/health 2>nul
if not errorlevel 1 goto ready
set /a count+=1
if !count! geq 60 (
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
