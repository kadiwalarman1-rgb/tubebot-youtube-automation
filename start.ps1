# TubeBot - Smart PowerShell Launcher
# Finds Node.js automatically and starts the server

Write-Host "=============================" -ForegroundColor Red
Write-Host "   TubeBot YouTube Automation" -ForegroundColor White
Write-Host "=============================" -ForegroundColor Red
Write-Host ""

# --- Find Node.js ---
$nodeCandidates = @(
    "node",
    "C:\Program Files\nodejs\node.exe",
    "C:\Program Files (x86)\nodejs\node.exe",
    "$env:APPDATA\nvm\current\node.exe",
    "$env:LOCALAPPDATA\ms-playwright-go\1.57.0\node.exe",
    "$env:LOCALAPPDATA\ms-playwright-go\1.50.1\node.exe"
)

$nodePath = $null
foreach ($candidate in $nodeCandidates) {
    try {
        $ver = & $candidate --version 2>$null
        if ($ver) { $nodePath = $candidate; break }
    } catch {}
}

if (-not $nodePath) {
    # Search common locations
    $found = Get-ChildItem "$env:LOCALAPPDATA" -Filter "node.exe" -Recurse -Depth 5 -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { $nodePath = $found.FullName }
}

if (-not $nodePath) {
    Write-Host "ERROR: Node.js not found! Please install from https://nodejs.org" -ForegroundColor Red
    exit 1
}

$nodeVersion = & $nodePath --version
Write-Host "Node.js: $nodeVersion  ($nodePath)" -ForegroundColor Green

# --- Find npm ---
$npmCli = "$env:APPDATA\npm\node_modules\npm\bin\npm-cli.js"
if (-not (Test-Path $npmCli)) {
    $npmCli = (Get-ChildItem "C:\" -Filter "npm-cli.js" -Recurse -Depth 8 -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
}

# --- Install dependencies if needed ---
if (-not (Test-Path "node_modules")) {
    Write-Host ""
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    if ($npmCli -and (Test-Path $npmCli)) {
        & $nodePath $npmCli install
    } else {
        Write-Host "WARNING: npm not found, skipping install" -ForegroundColor Yellow
    }
}

# --- Check .env ---
if (-not (Test-Path ".env")) {
    Write-Host "WARNING: .env file missing! Copy .env and fill in your API keys." -ForegroundColor Yellow
}

# --- Start server ---
Write-Host ""
Write-Host "Starting TubeBot server..." -ForegroundColor Cyan
Write-Host "Open http://localhost:3000 in your browser" -ForegroundColor White
Write-Host "Press Ctrl+C to stop" -ForegroundColor Gray
Write-Host ""

$env:NODE_PATH = Split-Path $nodePath
& $nodePath server.js
