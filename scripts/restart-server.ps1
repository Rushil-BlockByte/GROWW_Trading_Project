param(
  [int]$Port = 3001
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

Set-Location $ProjectRoot

Write-Host "Restarting Groww Trading Project"
Write-Host "Project: $ProjectRoot"
Write-Host "Port: $Port"

$connections = @()
try {
  $connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
} catch {
  Write-Warning "Could not inspect port $Port. Continuing to start the server."
}

$owningProcesses = $connections | Select-Object -ExpandProperty OwningProcess -Unique

foreach ($owningProcess in $owningProcesses) {
  if (-not $owningProcess -or $owningProcess -eq $PID) {
    continue
  }

  try {
    $process = Get-Process -Id $owningProcess -ErrorAction Stop
  } catch {
    Write-Warning "Could not read process $owningProcess."
    continue
  }

  if ($process.ProcessName -notmatch "^(node|npm|next)$") {
    Write-Warning "Port $Port is used by $($process.ProcessName) (PID $owningProcess). Not stopping it automatically."
    continue
  }

  Write-Host "Stopping existing server process $($process.ProcessName) (PID $owningProcess)..."
  Stop-Process -Id $owningProcess -Force
  Start-Sleep -Milliseconds 750
}

if (-not (Test-Path ".env")) {
  Write-Warning ".env was not found. Kite token and database settings may be missing."
}

if (-not (Test-Path "node_modules")) {
  Write-Error "node_modules was not found. Run npm install once before restarting the server."
}

Write-Host "Starting server at http://localhost:$Port"
npm run dev -- --port $Port
