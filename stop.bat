@echo off
REM Graceful stop. Containers are stopped but kept (faster restart via start.bat).
REM For full teardown (also remove containers), run: docker compose down

setlocal
cd /d "%~dp0"
docker compose stop
echo.
echo GitNexus stopped. Run start.bat to bring it back.
endlocal
