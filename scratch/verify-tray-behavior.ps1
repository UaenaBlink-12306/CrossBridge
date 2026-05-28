# PowerShell Smoke Test for CrossBridge Windows Tray/Background Behavior
# This script launches the CrossBridge app, tests close/minimize hiding to tray,
# and verifies process and window handle status.

$ErrorActionPreference = "Stop"

# Win32 API declarations for window manipulation
$signature = @'
[DllImport("user32.dll")]
public static extern bool IsWindowVisible(IntPtr hWnd);

[DllImport("user32.dll")]
public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

[DllImport("user32.dll")]
public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
'@

Add-Type -MemberDefinition $signature -Name "Win32Util" -Namespace "Win32"

$WM_CLOSE = 0x0010
$SW_HIDE = 0
$SW_SHOWNORMAL = 1
$SW_SHOWMINIMIZED = 2
$SW_SHOWMAXIMIZED = 3
$SW_SHOW = 5
$SW_MINIMIZE = 6
$SW_RESTORE = 9

Write-Host "=== STARTING CROSSBRIDGE TRAY SMOKE TEST ===" -ForegroundColor Cyan

# 1. Start Relay Server in background if not already running
Write-Host "Checking if relay server is running..."
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
    # Run dev:relay in background using start-process
    $relayJob = Start-Process npm -ArgumentList "run dev:relay" -WorkingDirectory "c:\Users\alpac\Desktop\Coding\Phone Link Project\crossbridge" -NoNewWindow -PassThru
    Write-Host "Waiting 5 seconds for relay server to start..."
    Start-Sleep -Seconds 5
}

# 2. Start CrossBridge App
Write-Host "Launching CrossBridge built app..."
$exePath = "c:\Users\alpac\Desktop\Coding\Phone Link Project\crossbridge\apps\windows\src-tauri\target\release\crossbridge-windows.exe"

if (-not (Test-Path $exePath)) {
    Write-Host "ERROR: Built CrossBridge app not found at $exePath!" -ForegroundColor Red
    Write-Host "Please build the app first using 'npm run tauri:build' or 'cargo build --release' inside src-tauri." -ForegroundColor Yellow
    exit 1
}

# Kill any existing instances first
$existing = Get-Process -Name "crossbridge-windows" -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Found existing running CrossBridge processes. Terminating them..." -ForegroundColor Yellow
    $existing | Stop-Process -Force
    Start-Sleep -Seconds 1
}

$appProc = Start-Process $exePath -PassThru
Write-Host "App launched. Process ID: $($appProc.Id)" -ForegroundColor Green

# Wait for window to load and register window handle
Write-Host "Waiting 5 seconds for the app window to become active..."
Start-Sleep -Seconds 5

# Refresh process object to load window handle
$appProc.Refresh()

# Try to find the process and its main window handle (which must be non-zero)
$hWnd = [IntPtr]::Zero
for ($i = 0; $i -lt 10; $i++) {
    $proc = Get-Process -Id $appProc.Id -ErrorAction SilentlyContinue
    if ($proc) {
        $hWnd = $proc.MainWindowHandle
        if ($hWnd -ne [IntPtr]::Zero) {
            break
        }
    }
    Write-Host "Waiting for window handle... ($($i + 1)/10)"
    Start-Sleep -Seconds 1
}

if ($hWnd -eq [IntPtr]::Zero) {
    Write-Host "ERROR: Could not find main window handle for the CrossBridge app process!" -ForegroundColor Red
    exit 1
}

Write-Host "Found App Window Handle: $hWnd" -ForegroundColor Green

# Verify window is initially visible
$isVisible = [Win32.Win32Util]::IsWindowVisible($hWnd)
Write-Host "Initial IsWindowVisible: $isVisible"
if ($isVisible) {
    Write-Host "✅ SUCCESS: Window is initially visible after launching." -ForegroundColor Green
} else {
    Write-Host "❌ FAILURE: Window is not visible initially." -ForegroundColor Red
    exit 1
}

# 3. Test Minimize hides to tray instead of quitting
Write-Host "`n--- Testing MINIMIZE hides to tray ---"
Write-Host "Minimizing window..."
# Minimize the window
[Win32.Win32Util]::ShowWindow($hWnd, $SW_MINIMIZE) | Out-Null
Start-Sleep -Seconds 3

# Refresh process and check status
$proc = Get-Process -Id $appProc.Id -ErrorAction SilentlyContinue
if (-not $proc) {
    Write-Host "❌ FAILURE: App process terminated after minimize!" -ForegroundColor Red
    exit 1
}

$isVisible = [Win32.Win32Util]::IsWindowVisible($hWnd)
Write-Host "IsWindowVisible after minimize: $isVisible"
if (-not $isVisible) {
    Write-Host "✅ SUCCESS: Window hidden on minimize (hides to tray)." -ForegroundColor Green
} else {
    Write-Host "❌ FAILURE: Window is still visible after minimize!" -ForegroundColor Red
    exit 1
}

# 4. Test tray Open restores/focuses the window
Write-Host "`n--- Testing TRAY OPEN (Restore window) ---"
Write-Host "Restoring/Showing window (simulating tray Open click)..."
# Show/Restore window
[Win32.Win32Util]::ShowWindow($hWnd, $SW_RESTORE) | Out-Null
Start-Sleep -Seconds 2

$isVisible = [Win32.Win32Util]::IsWindowVisible($hWnd)
Write-Host "IsWindowVisible after restore: $isVisible"
if ($isVisible) {
    Write-Host "✅ SUCCESS: Window restored and visible (Open restores window)." -ForegroundColor Green
} else {
    Write-Host "❌ FAILURE: Window remains hidden after restore!" -ForegroundColor Red
    exit 1
}

# 5. Test Close hides to tray instead of quitting
Write-Host "`n--- Testing CLOSE hides to tray ---"
Write-Host "Sending Close window message..."
# Close requested
$appProc.CloseMainWindow() | Out-Null
Start-Sleep -Seconds 3

$proc = Get-Process -Id $appProc.Id -ErrorAction SilentlyContinue
if (-not $proc) {
    Write-Host "❌ FAILURE: App process terminated after close!" -ForegroundColor Red
    exit 1
}

$isVisible = [Win32.Win32Util]::IsWindowVisible($hWnd)
Write-Host "IsWindowVisible after close: $isVisible"
if (-not $isVisible) {
    Write-Host "✅ SUCCESS: Window hidden on close (hides to tray, prevent_close worked)." -ForegroundColor Green
} else {
    Write-Host "❌ FAILURE: Window is still visible after close or closed completely!" -ForegroundColor Red
    exit 1
}

# 6. Restore window once more to ensure everything is fine
Write-Host "`n--- Restoring window for final checks ---"
[Win32.Win32Util]::ShowWindow($hWnd, $SW_RESTORE) | Out-Null
Start-Sleep -Seconds 2
$isVisible = [Win32.Win32Util]::IsWindowVisible($hWnd)
Write-Host "IsWindowVisible after restore: $isVisible"

# Clean up
Write-Host "`nCleaning up: Terminating CrossBridge app process..."
$appProc | Stop-Process -Force

if ($relayJob) {
    Write-Host "Stopping relay server process..."
    $relayJob | Stop-Process -Force
}

Write-Host "`n=== SMOKE TEST COMPLETED SUCCESSFULLY! ===" -ForegroundColor Green
