#Requires -Version 5.1
<#
.SYNOPSIS
    Builds the Kylo / Klyo Desktop App and Installer on Windows.

.DESCRIPTION
    Automates the end-to-end build:
      1. Compiles the React Web UI (kylo/ui/web/frontend)
      2. Freezes the Python backend with PyInstaller (kylo.spec -> dist/Jarvis)
      3. Packages the Electron Desktop App with NSIS (desktop/ -> desktop/release/Kylo-Setup-*-x64.exe)

.PARAMETER SkipFrontend
    Skip building the React frontend if dist already exists.

.PARAMETER SkipPyInstaller
    Skip freezing the Python backend if dist/Jarvis already exists.

.EXAMPLE
    .\scripts\build-desktop.ps1
#>
[CmdletBinding()]
param(
    [switch]$SkipFrontend,
    [switch]$SkipPyInstaller
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "     Building Kylo / Klyo Desktop Application" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Frontend Build
$FrontendDist = Join-Path $RepoRoot "kylo\ui\web\dist"
if (-not $SkipFrontend -or -not (Test-Path $FrontendDist)) {
    Write-Host "[1/3] Building Web UI Frontend..." -ForegroundColor Yellow
    Push-Location (Join-Path $RepoRoot "kylo\ui\web\frontend")
    try {
        if (-not (Test-Path "node_modules")) {
            npm ci
        }
        npm run build
    } finally {
        Pop-Location
    }
} else {
    Write-Host "[1/3] Skipping frontend build (dist already exists)." -ForegroundColor Gray
}

# 2. PyInstaller Freeze
$BackendDist = Join-Path $RepoRoot "dist\Jarvis"
if (-not $SkipPyInstaller -or -not (Test-Path $BackendDist)) {
    Write-Host "[2/3] Freezing Python backend with PyInstaller..." -ForegroundColor Yellow
    # Prefer Python 3.11 if available
    $pythonCmd = "python"
    if (Get-Command py -ErrorAction SilentlyContinue) {
        $pythonCmd = "py -3.11"
    }
    python -m PyInstaller kylo.spec --noconfirm
    if (-not (Test-Path $BackendDist)) {
        Write-Error "PyInstaller failed to output $BackendDist"
        exit 1
    }
} else {
    Write-Host "[2/3] Skipping PyInstaller freeze (dist/Jarvis already exists)." -ForegroundColor Gray
}

# 3. Electron App Build
Write-Host "[3/3] Building Electron desktop installer..." -ForegroundColor Yellow
Push-Location (Join-Path $RepoRoot "desktop")
try {
    if (-not (Test-Path "node_modules")) {
        npm ci
    }
    npm run build
    npm run dist
} finally {
    Pop-Location
}

$Installers = Get-ChildItem -Path (Join-Path $RepoRoot "desktop\release") -Filter "*Setup*.exe" -ErrorAction SilentlyContinue
if ($Installers) {
    Write-Host "`nSUCCESS! Built desktop installer(s):" -ForegroundColor Green
    foreach ($inst in $Installers) {
        Write-Host "  $($inst.FullName) ($([Math]::Round($inst.Length / 1MB, 2)) MB)" -ForegroundColor Green
    }
} else {
    Write-Host "`nBuild complete. Check desktop/release/ for artifacts." -ForegroundColor Yellow
}

