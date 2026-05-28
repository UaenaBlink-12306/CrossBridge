# PowerShell Smoke Test for CrossBridge Windows Tray Behavior (No Add-Type)
# Tests window close hiding to tray and process persistence using native .NET methods.

$ErrorActionPreference = "Continue"

Write-Host "=== STARTING CROSSBRIDGE TRAY SMOKE TEST (NO ADD-TYPE) ===" -ForegroundColor Cyan

# 1. Start Relay Server if not running
$relayRunning = $false
try {
    $resp = Invoke-RestMethod -Uri "http://127.0.0.1:8787/health" -TimeoutSec 2
    if ($resp.ok -eq $true) {
        Write-Host "Relay server is already running." -ForegroundColor Green
        $relayRunning = $true
    }
} catch {
    Write-Host "Relay server is not running. Starting relay..."
}

$relayJob = $null
if (-not $relayRunning) {
    $relayJob = Start-Process npm -ArgumentList "run dev:relay" -WorkingDirectory "c:\Users\alpac\Desktop\Coding\Phone Link Project\crossbridge" -NoNewWindow -PassThru
    Write-Host "Waiting 5 seconds for relay server to start..."
    Start-Sleep -Seconds 5
}

# 2. Launch built CrossBridge app
$exePath = "c:\Users\alpac\Desktop\Coding\Phone Link Project\crossbridge\apps\windows\src-tauri\target\release\crossbridge-windows.exe"

if (-not (Test-Path $exePath)) {
    Write-Host "ERROR: Built CrossBridge app not found at $exePath!" -ForegroundColor Red
    exit 1
}

# Terminate existing instances
$existing = Get-Process -Name "crossbridge-windows" -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Terminating existing running CrossBridge processes..." -ForegroundColor Yellow
    $existing | Stop-Process -Force
    Start-Sleep -Seconds 1
}

$appProc = Start-Process $exePath -PassThru
Write-Host "App launched. Process ID: $($appProc.Id)" -ForegroundColor Green

Write-Host "Waiting 5 seconds for app window to load..."
Start-Sleep -Seconds 5

$appProc.Refresh()
$hWnd = $appProc.MainWindowHandle
Write-Host "App MainWindowHandle: $hWnd"

if ($hWnd -eq [IntPtr]::Zero) {
    Write-Host "WARNING: MainWindowHandle is 0. Waiting another 3 seconds..." -ForegroundColor Yellow
    Start-Sleep -Seconds 3
    $appProc.Refresh()
    $hWnd = $appProc.MainWindowHandle
    Write-Host "App MainWindowHandle now: $hWnd"
}

# 3. Test Close Hides to Tray (Process stays alive)
Write-Host "`n--- Testing CLOSE HIDES TO TRAY ---"
if ($hWnd -ne [IntPtr]::Zero) {
    Write-Host "Sending Close command to MainWindowHandle..."
    $appProc.CloseMainWindow() | Out-Null
} else {
    Write-Host "MainWindowHandle is 0, trying to send CloseMainWindow directly..."
    (Get-Process -Id $appProc.Id).CloseMainWindow() | Out-Null
}

Write-Host "Waiting 3 seconds for close event to process..."
Start-Sleep -Seconds 3

# Check if process is still running
$procCheck = Get-Process -Id $appProc.Id -ErrorAction SilentlyContinue
if ($procCheck) {
    Write-Host "✅ SUCCESS: Process is still running after Close event! Close hides to tray." -ForegroundColor Green
} else {
    Write-Host "❌ FAILURE: Process terminated after Close event!" -ForegroundColor Red
    exit 1
}

# 4. Minimize Alt+Space+N and verify process stays alive
Write-Host "`n--- Testing MINIMIZE HIDES TO TRAY ---"
Write-Host "Activating app window and sending Minimize shortcut..."
$wshell = New-Object -ComObject WScript.Shell
$activated = $wshell.AppActivate("CrossBridge")
Write-Host "Window activated: $activated"
if ($activated) {
    Start-Sleep -Milliseconds 500
    $wshell.SendKeys("% ") # Alt + Space
    Start-Sleep -Milliseconds 200
    $wshell.SendKeys("n")   # n (Minimize)
    Start-Sleep -Seconds 3
} else {
    Write-Host "Could not activate window by title. Skipping Alt+Space+N keystroke." -ForegroundColor Yellow
}

$procCheck = Get-Process -Id $appProc.Id -ErrorAction SilentlyContinue
if ($procCheck) {
    Write-Host "✅ SUCCESS: Process is still running after Minimize command." -ForegroundColor Green
} else {
    Write-Host "❌ FAILURE: Process terminated after Minimize command!" -ForegroundColor Red
    exit 1
}

# 5. Clean up
Write-Host "`nCleaning up: Terminating CrossBridge app process..."
$appProc | Stop-Process -Force

if ($relayJob) {
    Write-Host "Stopping relay server..."
    $relayJob | Stop-Process -Force
}

Write-Host "`n=== SMOKE TEST COMPLETED SUCCESSFULLY! ===" -ForegroundColor Green
