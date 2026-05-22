# Graceful stop. Containers are stopped but kept (faster restart via start.ps1).
# For full teardown (also remove containers), run: docker compose down

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot
docker compose stop
Write-Host "GitNexus stopped. Run .\start.ps1 to bring it back." -ForegroundColor Cyan
