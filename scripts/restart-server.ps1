param(
  [int]$Port = 3001
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

Set-Location $ProjectRoot

Write-Host "Restarting Groww Trading Project"
Write-Host "Project: $ProjectRoot"
Write-Host "Port: $Port"

function Get-PortOwningProcessIds {
  param([int]$TargetPort)

  $processIds = @()

  try {
    $connections = @(Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue)
    $processIds += $connections | Select-Object -ExpandProperty OwningProcess
  } catch {
    Write-Warning "Could not inspect port $TargetPort with Get-NetTCPConnection."
  }

  if (-not $processIds) {
    $pattern = "[:.]$TargetPort\s+.*LISTENING\s+(\d+)$"
    $processIds += netstat -ano |
      Select-String -Pattern $pattern |
      ForEach-Object { [int]$_.Matches[0].Groups[1].Value }
  }

  $processIds | Where-Object { $_ } | Select-Object -Unique
}

$owningProcesses = @(Get-PortOwningProcessIds -TargetPort $Port)

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
