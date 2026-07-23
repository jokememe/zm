# Interactive push of local main → origin (fixes expired GitHub token).
# Usage (in an interactive PowerShell window):
#   cd G:\gamecard\宗门
#   powershell -ExecutionPolicy Bypass -File .\scripts\push-main.ps1
#
# You need a GitHub PAT with repo scope:
#   https://github.com/settings/tokens

$ErrorActionPreference = 'Stop'
# script lives in <repo>/scripts → repo root is parent of scripts
Set-Location (Join-Path $PSScriptRoot '..')

Write-Host "Repo: $(Get-Location)" -ForegroundColor Cyan
git status -sb
$ahead = git rev-list --count origin/main..HEAD 2>$null
if (-not $ahead -or [int]$ahead -eq 0) {
  Write-Host "Nothing to push (already up to date with origin/main)." -ForegroundColor Green
  exit 0
}
Write-Host "Commits ahead of origin/main: $ahead" -ForegroundColor Yellow
git log origin/main..HEAD --oneline

$user = Read-Host "GitHub username (e.g. jokememe)"
if (-not $user) { throw "Username required" }

$sec = Read-Host "GitHub PAT (input hidden)" -AsSecureString
if (-not $sec) { throw "PAT required" }
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
try {
  $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) | Out-Null
}
if (-not $token) { throw "PAT required" }

# Optional: refresh stored credential for later pushes
$store = Read-Host "Save credential for later git push? (y/N)"
if ($store -match '^[yY]') {
  $credLine = "https://${user}:${token}@github.com"
  $path = Join-Path $env:USERPROFILE '.git-credentials'
  $lines = @()
  if (Test-Path $path) {
    $lines = Get-Content $path | Where-Object { $_ -notmatch 'github\.com' }
  }
  $lines += $credLine
  Set-Content -Path $path -Value $lines -Encoding ascii
  git config --global credential.helper store
  Write-Host "Saved to ~/.git-credentials (credential.helper=store)" -ForegroundColor DarkGray
}

$pushUrl = "https://${user}:${token}@github.com/jokememe/zm.git"
$env:GIT_TERMINAL_PROMPT = '0'
Write-Host "Pushing main..." -ForegroundColor Cyan
git -c credential.helper= push $pushUrl main
if ($LASTEXITCODE -ne 0) {
  Write-Host "Push failed (exit $LASTEXITCODE). Check username/PAT and repo access." -ForegroundColor Red
  exit $LASTEXITCODE
}
Write-Host "Push OK." -ForegroundColor Green
git fetch origin 2>$null
git status -sb
