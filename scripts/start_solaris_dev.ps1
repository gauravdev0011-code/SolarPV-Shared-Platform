[CmdletBinding()]
param(
    [string]$DataRoot,
    [ValidateRange(1, 65535)]
    [int]$ApiPort = 8000,
    [ValidateRange(1, 65535)]
    [int]$FrontendPort = 5173,
    [ValidateRange(0, 86400)]
    [int]$RunForSeconds = 0
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$srcRoot = Join-Path $repoRoot "src"
$frontendRoot = Join-Path $repoRoot "frontend"
$dbPath = Join-Path $repoRoot "data\solarpv.db"

if (-not $DataRoot) {
    $runId = "{0}_{1}" -f (Get-Date -Format "yyyyMMdd_HHmmss"), ([guid]::NewGuid().ToString("N").Substring(0, 8))
    $DataRoot = Join-Path ([System.IO.Path]::GetTempPath()) "SolarPV_LocalDev_$runId"
}
$DataRoot = [System.IO.Path]::GetFullPath($DataRoot)
$privateStorage = Join-Path $DataRoot "private-storage"
$isolatedDatabase = Join-Path $DataRoot "solaris-dev.sqlite3"

if ($isolatedDatabase -eq [System.IO.Path]::GetFullPath($dbPath)) {
    throw "The development database cannot be the project research database."
}
if ($isolatedDatabase.StartsWith($repoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Choose a development data directory outside the repository."
}
if (Test-Path $DataRoot) {
    throw "The selected development data directory already exists. Choose a fresh directory; existing data and logs will not be overwritten."
}

$python = (Get-Command python -ErrorAction Stop).Source
$node = (Get-Command node -ErrorAction Stop).Source
$viteEntry = Join-Path $frontendRoot "node_modules\vite\bin\vite.js"
if (-not (Test-Path $viteEntry)) {
    throw "Frontend dependencies are missing. Run the project's approved dependency setup before using this launcher."
}

function Test-PortAvailable([int]$Port) {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    try { $listener.Start(); return $true }
    catch { return $false }
    finally { $listener.Stop() }
}

function Test-PortResponsive([int]$Port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $connect = $client.ConnectAsync("127.0.0.1", $Port)
        return $connect.Wait(2000) -and $client.Connected
    } catch { return $false }
    finally { $client.Dispose() }
}

foreach ($port in @($ApiPort, $FrontendPort)) {
    if (-not (Test-PortAvailable $port)) {
        throw "Port $port is already in use. Stop or reconfigure the conflicting service before starting SOLARIS."
    }
}

New-Item -ItemType Directory -Path $DataRoot -Force | Out-Null
New-Item -ItemType Directory -Path $privateStorage -Force | Out-Null
$logRoot = Join-Path $DataRoot "logs"
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

$env:SOLARPV_DB_PATH = $isolatedDatabase
$env:SOLARPV_STORAGE_PATH = $privateStorage
$env:PYTHONPATH = if ($env:PYTHONPATH) { "$srcRoot;$env:PYTHONPATH" } else { $srcRoot }
$env:VITE_API_BASE_URL = "/api/v1"
$env:SOLARPV_API_PROXY_TARGET = "http://127.0.0.1:$ApiPort"

$configCheck = & $python -c "from solarpv_api.config import Settings; s=Settings.from_environment(); print('Database:', s.database_path); print('Private storage:', s.storage_path)"
if ($LASTEXITCODE -ne 0) { throw "SOLARIS configuration validation failed." }
Write-Host $configCheck

$started = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()
try {
    $apiOut = Join-Path $logRoot "api.stdout.log"
    $apiErr = Join-Path $logRoot "api.stderr.log"
    $apiArgs = "-m uvicorn solarpv_api.app:app --app-dir `"$srcRoot`" --host 127.0.0.1 --no-proxy-headers --port $ApiPort"
    $api = Start-Process -FilePath $python -ArgumentList $apiArgs -WorkingDirectory $repoRoot -RedirectStandardOutput $apiOut -RedirectStandardError $apiErr -PassThru -WindowStyle Hidden
    $started.Add($api)

    $apiReady = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if (-not (Get-Process -Id $api.Id -ErrorAction SilentlyContinue)) { throw "FastAPI stopped during startup. See $apiErr" }
        try {
            Invoke-RestMethod -Uri "http://127.0.0.1:$ApiPort/api/v1/workspaces?limit=1" -TimeoutSec 2 | Out-Null
            $apiReady = $true
            break
        } catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $apiReady) { throw "FastAPI did not become ready. See $apiOut and $apiErr" }

    $workerOut = Join-Path $logRoot "worker.stdout.log"
    $workerErr = Join-Path $logRoot "worker.stderr.log"
    $worker = Start-Process -FilePath $python -ArgumentList "-m solarpv_ingestion.worker" -WorkingDirectory $repoRoot -RedirectStandardOutput $workerOut -RedirectStandardError $workerErr -PassThru -WindowStyle Hidden
    $started.Add($worker)
    Start-Sleep -Seconds 2
    if (-not (Get-Process -Id $worker.Id -ErrorAction SilentlyContinue)) { throw "The ingestion worker stopped during startup. See $workerErr" }

    $viteOut = Join-Path $logRoot "vite.stdout.log"
    $viteErr = Join-Path $logRoot "vite.stderr.log"
    $viteArgs = "`"$viteEntry`" --host 127.0.0.1 --port $FrontendPort --strictPort"
    $vite = Start-Process -FilePath $node -ArgumentList $viteArgs -WorkingDirectory $frontendRoot -RedirectStandardOutput $viteOut -RedirectStandardError $viteErr -PassThru -WindowStyle Hidden
    $started.Add($vite)

    $viteReady = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if (-not (Get-Process -Id $vite.Id -ErrorAction SilentlyContinue)) { throw "Vite stopped during startup. See $viteErr" }
        if (Test-PortResponsive $FrontendPort) { $viteReady = $true; break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $viteReady) { throw "Vite did not become ready. See $viteOut and $viteErr" }

    Write-Host "SOLARIS development stack is ready."
    Write-Host "Frontend: http://127.0.0.1:$FrontendPort"
    Write-Host "API:      http://127.0.0.1:$ApiPort/api/v1"
    Write-Host "Database: $isolatedDatabase"
    Write-Host "Storage:  $privateStorage"
    Write-Host "Logs:     $logRoot"
    if ($RunForSeconds -gt 0) {
        Write-Host "This verification run will stop in $RunForSeconds seconds. Data and logs are retained."
        $stopAt = [DateTime]::UtcNow.AddSeconds($RunForSeconds)
    } else {
        Write-Host "Press Ctrl+C to stop only the processes started by this script. Data and logs are retained."
        $stopAt = [DateTime]::MaxValue
    }

    while ([DateTime]::UtcNow -lt $stopAt) {
        foreach ($process in $started) {
            if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) {
                throw "A SOLARIS service exited unexpectedly (PID $($process.Id)). Check logs in $logRoot."
            }
        }
        Start-Sleep -Seconds 2
    }
}
finally {
    foreach ($process in $started) {
        if (Get-Process -Id $process.Id -ErrorAction SilentlyContinue) {
            Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
        }
    }
}
