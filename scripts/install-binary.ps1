#Requires -Version 5.1
param(
    [string]$Version = "latest",
    [string]$InstallDir = ""
)

$ErrorActionPreference = "Stop"
$Repo = "JonathanLee-LX/meddle"

if (-not $InstallDir) {
    $InstallDir = Join-Path $env:USERPROFILE ".meddle\bin"
}

$Arch = if ([Environment]::Is64BitOperatingSystem) {
    if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
} else {
    Write-Error "32-bit Windows is not supported"; exit 1
}

$Asset = "meddle-windows-$Arch.exe"

if ($Version -eq "latest") {
    Write-Host "Fetching latest release..."
    $response = Invoke-WebRequest -Uri "https://github.com/$Repo/releases/latest" -MaximumRedirection 0 -ErrorAction SilentlyContinue -UseBasicParsing
    $Version = $response.Headers.Location -replace '.*/tag/v', ''
}

$Tag = "v$Version"
$Url = "https://github.com/$Repo/releases/download/$Tag/$Asset"
$ShaUrl = "$Url.sha256"

Write-Host "Installing meddle $Tag (windows-$Arch)..."

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

$TmpFile = Join-Path $env:TEMP "meddle-download.exe"

Write-Host "Downloading $Url..."
$retries = 3
for ($i = 1; $i -le $retries; $i++) {
    try {
        Invoke-WebRequest -Uri $Url -OutFile $TmpFile -UseBasicParsing
        break
    } catch {
        if ($i -eq $retries) { throw }
        Write-Host "Retry $i/$retries..."
        Start-Sleep -Seconds 2
    }
}

Write-Host "Verifying checksum..."
try {
    $expectedSha = (Invoke-WebRequest -Uri $ShaUrl -UseBasicParsing).Content.Trim().Split(" ")[0]
    $actualSha = (Get-FileHash -Path $TmpFile -Algorithm SHA256).Hash.ToLower()
    if ($actualSha -ne $expectedSha) {
        Write-Error "Checksum mismatch! Expected: $expectedSha, Got: $actualSha"
        exit 1
    }
    Write-Host "Checksum OK"
} catch [System.Net.WebException] {
    Write-Host "Warning: checksum file not available, skipping verification"
}

$Dest = Join-Path $InstallDir "meddle.exe"
Move-Item -Path $TmpFile -Destination $Dest -Force

Write-Host ""
Write-Host "meddle $Tag installed to $Dest"

$currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($currentPath -notlike "*$InstallDir*") {
    Write-Host ""
    Write-Host "Add to your PATH:"
    Write-Host "  [Environment]::SetEnvironmentVariable('PATH', `"$InstallDir;`$env:PATH`", 'User')"
    Write-Host ""
    Write-Host "Or run (current session):"
    Write-Host "  `$env:PATH = `"$InstallDir;`$env:PATH`""
}

Write-Host ""
Write-Host "Verify: & '$Dest' version"
