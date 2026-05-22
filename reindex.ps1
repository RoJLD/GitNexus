# Force a re-index of an already-known repo. Triggers POST /api/analyze on
# the running daemon, which is safer than running a parallel CLI invocation
# (the daemon owns the LadybugDB lock).
#
# Usage:
#   .\reindex.ps1 /data/projects/Experiment.Crypto.2026S1.RobinDenis/Tools/sync_detection
#   .\reindex.ps1 https://github.com/owner/repo
#
# The path is what gitnexus sees inside the container — for local repos it
# starts with /data/projects/... (which maps to C:\Users\rdenis\VScode\... on
# the host, per docker-compose.yml).

param(
    [Parameter(Mandatory = $true)]
    [string]$Target
)

$ErrorActionPreference = "Stop"

# Choose body shape depending on URL vs path
if ($Target -match '^https?://') {
    $body = @{ url = $Target; force = $true; embeddings = $true } | ConvertTo-Json
} else {
    $body = @{ path = $Target; force = $true; embeddings = $true } | ConvertTo-Json
}

try {
    $response = Invoke-RestMethod -Uri "http://localhost:4747/api/analyze" -Method Post -ContentType "application/json" -Body $body -ErrorAction Stop
    Write-Host "Re-index started:" -ForegroundColor Green
    Write-Host "  jobId: $($response.jobId)"
    Write-Host "  status: $($response.status)"
    Write-Host ""
    Write-Host "Watch progress at http://localhost:4173 or:"
    Write-Host "  Invoke-RestMethod http://localhost:4747/api/analyze/$($response.jobId)"
} catch {
    Write-Host "  Failed to trigger re-index. Is GitNexus running?" -ForegroundColor Red
    Write-Host "    Try: .\start.ps1"
    Write-Host "    Error: $_"
    exit 1
}
