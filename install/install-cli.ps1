# Kylo Instant CLI Installer for Windows
# Downloads the standalone pre-compiled binary CLI directly from GitHub Releases.
# Zero dependency compilation, zero pip overhead, ready in seconds.
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$e = [char]27
$Gold = "${e}[38;2;255;214;10m"
$Green = "${e}[38;2;122;200;140m"
$Dim = "${e}[38;2;143;143;143m"
$Bold = "${e}[1m"
$Rst = "${e}[0m"
$Chk = [char]0x2713
$Dia = [char]0x25C6
$Gut = "$Dim$([char]0x2502)$Rst"

Write-Host ""
Write-Host "$Gold$Dia$Rst  $Bold$Gold Kylo Fast CLI Installer$Rst"
Write-Host "$Gut"

$Tag = if ($env:KYLO_VERSION) { $env:KYLO_VERSION } else { 'v4.1.4' }
$Repo = if ($env:KYLO_REPO) { $env:KYLO_REPO } else { 'charanbalaji2005/Kylo' }
$BinDir = Join-Path $HOME '.kylo\bin'
$ZipPath = Join-Path $env:TEMP "kylo-cli-$Tag.zip"
$DownloadUrl = "https://github.com/$Repo/releases/download/$Tag/kylo-cli-windows-x64.zip"

Write-Host "$Gut  $Green$Chk$Rst Target directory: $Dim$BinDir$Rst"
Write-Host "$Gut  $Green$Chk$Rst Release asset:    $Dim$DownloadUrl$Rst"
Write-Host "$Gut"
Write-Host "$Gut  Fetching standalone CLI binary package..."

if (-not (Test-Path $BinDir)) {
    New-Item -ItemType Directory -Force $BinDir | Out-Null
}

try {
    if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
        & curl.exe -s -L -o $ZipPath $DownloadUrl
    } else {
        Invoke-WebRequest -Uri $DownloadUrl -OutFile $ZipPath -UseBasicParsing
    }
    Write-Host "$Gut  $Green$Chk$Rst Downloaded CLI package"

    Write-Host "$Gut  Extracting binaries..."
    Expand-Archive -Path $ZipPath -DestinationPath $BinDir -Force
    Remove-Item -Force $ZipPath -ErrorAction SilentlyContinue
    Write-Host "$Gut  $Green$Chk$Rst Binaries installed to $Dim$BinDir$Rst"

    $UserPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
    if ($UserPath -notlike "*$BinDir*") {
        $NewPath = if ($UserPath) { "$BinDir;$UserPath" } else { $BinDir }
        [Environment]::SetEnvironmentVariable('PATH', $NewPath, 'User')
        Write-Host "$Gut  $Green$Chk$Rst Added $BinDir to User PATH"
    } else {
        Write-Host "$Gut  $Green$Chk$Rst $BinDir already in User PATH"
    }
    $env:PATH = "$BinDir;$env:PATH"

    Write-Host "$Gut"
    Write-Host "$Gold$Dia$Rst  $Bold$Green Kylo CLI Ready!$Rst"
    Write-Host "$Gut"
    Write-Host "$Gut  Run: $Bold$Gold kylo --help $Rst or $Bold$Gold klyo --help $Rst"
    Write-Host "$Gut"
} catch {
    Write-Host "$Gut  Error: $($_.Exception.Message)"
    exit 1
}
