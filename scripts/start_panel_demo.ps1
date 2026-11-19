[CmdletBinding()]
param(
    [ValidateRange(1, 65535)] [int]$ApiPort = 8049,
    [ValidateRange(1, 65535)] [int]$FrontendPort = 5249
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$env:SOLARPV_PANEL_WORKBOOK = "synthetic-demo"
$env:SOLARPV_PANEL_DEMO_DIR = Join-Path $root ".panel-demo/shared-review"
$env:PYTHONPATH = Join-Path $root "src"
Remove-Item Env:SOLARPV_PANEL_LIVE_SITE -ErrorAction SilentlyContinue
$venv = Join-Path $root ".venv/Scripts"
if (-not (Test-Path (Join-Path $venv "python.exe"))) { throw "Create the local .venv and install the Python dependencies first." }
$env:Path = "$venv;$env:Path"
& python -m solarpv_db.panel_demo
if ($LASTEXITCODE -ne 0) { throw "Panel demo seeding failed." }
& "$PSScriptRoot/start_solaris_dev.ps1" -ApiPort $ApiPort -FrontendPort $FrontendPort
