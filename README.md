# CrossBridge

CrossBridge is a local-first Windows and Android bridge that already supports trusted-device pairing, auto-reconnect, encrypted text and link sharing, encrypted file transfer, Android share-sheet receive, Android notification mirror/reply/dismiss, and the native Windows tray runtime.

CrossBridge must let VPN users keep their current network settings. Local network mode is only an optimization. Relay mode over encrypted WebSocket is a first-class connection path.

VPN can stay on. CrossBridge sends encrypted app messages through relay mode.

## Current Feature Set

- Pair a Windows PC and Android phone with a QR code.
- Reconnect trusted devices automatically through the relay when both apps are opened.
- Share text and links in both directions.
- Transfer files in both directions over the trusted encrypted relay path.
- Accept Android share-sheet text and files into CrossBridge for forwarding.
- Mirror Android notification metadata to Windows and send dismiss or direct-reply actions back through Android when the source app allows them.
- Run a native Windows tray shell in Tauri builds.

## Still Missing For Release

- **Fully Signed Production Artifacts**: Unsigned builds will trigger OS-level security warnings (WDAC, AppLocker, SmartScreen) unless signed with trusted certificates.
- **Hosted Public Relay Network**: End-users require a permanent, high-availability public `wss://` relay URL so they do not need to run a local server in a terminal.
- **Store Distribution Channels**: Google Play Store and Windows Store publishing for automated updates.
- **Lifecycle Background hardening**: Fully completed background services for instant wakes on Android when the app is completely swiped away.

---

## Onboarding: Developer vs. No-Terminal Tester

CrossBridge supports two distinct user paths. Developers compile everything from source using terminal scripts, while **Beta Testers** can run the application with **zero terminal commands** using pre-compiled binaries and a public hosted relay.

### A. The End-User & Tester "No-Terminal" Onboarding Flow
To test CrossBridge without touching a terminal:

1. **Install Android App**: Download the pre-built `.apk` file directly on your phone and tap to install (enable sideloading if prompted).
2. **Install Windows App**: Double-click the pre-built `CrossBridge_0.1.0_x64-setup.exe` or `.msi` file and follow the standard visual setup wizard.
3. **Configure Hosted Relay**:
   - Open CrossBridge on your Windows PC.
   - In the settings panel, replace the local fallback address with your public secure relay URL: `wss://relay.yourdomain.com/connect`
4. **Scan and Pair**:
   - Go to the `Pair` tab on Windows and click **Create pairing code**.
   - Open the Android app, tap **Scan QR code**, and point your camera at the screen.
   - Confirm that the 6-digit verification code matches on both screens, then click **Confirm** on both.
5. **Start Sharing**:
   - You are now securely paired! You can immediately share text, links, files, and mirror notifications between devices. **No command lines are required.**

---

### B. The Developer "Source Build" Quickstart
If you are compiling and running CrossBridge from source code:

1. **Install workspace dependencies**:
   ```bash
   npm install
   ```

2. **Start the local relay server**:
   ```bash
   npm run relay:start
   ```

3. **Start the Windows client**:
   - For rapid browser-only UI testing:
     ```bash
     npm run windows:web
     ```
   - For native Tauri tray shell testing (requires local Rust toolchain):
     ```bash
     npm run windows:start
     ```

4. **Build and install the Android app** (requires JDK 17+ and Android SDK):
   ```bash
   npm run android:doctor
   npm run android:build
   npm run android:install
   ```

5. **Pair using local endpoints**:
   - On the Windows `Pair` page, keep the default URL: `ws://127.0.0.1:8787/connect`.
   - On Android, use:
     - Emulator fallback: `ws://10.0.2.2:8787/connect`
     - Physical phone (same Wi-Fi): `ws://<PC-LAN-IP>:8787/connect` (set `CROSSBRIDGE_RELAY_HOST=0.0.0.0` when running the relay).

---

## What A Tester Can Verify Today
Testers can verify the following core features right now without any developer tools:
- **Relay and LAN Transfer**: High-speed direct local file transfer with automated, seamless fallback to the encrypted public WSS relay when direct transport is blocked.
- **Secure Link and Text Sharing**: Shared clipboard content is fully encrypted end-to-end between your devices.
- **Notification Direct Control**: Mirror notifications from Android to Windows, dismissing them or replying directly in Windows.
- **Intelligent File Scans**: CrossBridge alerts users when trying to share potentially risky executable file extensions (.exe, .bat, etc.) to prevent malicious execution.

See [docs/release-readiness.md](docs/release-readiness.md) for the full release-readiness checklist, known blockers, and packaging notes.

## Common Scripts

```bash
npm run relay:start
npm run windows:web
npm run windows:start
npm run windows:build
npm run windows:package:check
npm run android:doctor
npm run android:build
npm run android:install
npm run verify:e2e
npm run verify:full
```

## Architecture

See [docs/architecture.md](docs/architecture.md).
See [docs/pairing.md](docs/pairing.md) for the current relay-based pairing flow.
See [docs/android-pairing.md](docs/android-pairing.md) for the Android native pairing client and QR JSON dev flow.

```text
Android app  <== app payload envelopes ==>  Relay server  <== app payload envelopes ==>  Windows app
Android app  <============== optional direct LAN fast path =============>  Windows app
```

The relay is intentionally dumb. It can see sender IDs, receiver IDs, message IDs, timestamps, nonces, and envelope bytes. It must not log shared text or links, and it does not permanently store them.

## VPN Compatibility

CrossBridge uses two MVP paths:

- **Direct LAN Fast Path**: An optimization that transfers file chunks directly over local TCP sockets (port 8789) when both devices are on the same local network and direct communication is unblocked.
- **Encrypted Relay Path**: The first-class connection path and default fallback. All control messages (pairing, text sharing, notifications, file offers/accepts/rejects/completes/cancels) and file chunks (when LAN is blocked) are sent through the encrypted WSS WebSocket relay.

If local direct TCP transport fails to connect or encounters an error at any point before or during a file transfer, CrossBridge **transparently and automatically falls back to the encrypted relay path** to complete the transfer without user intervention.

This architecture ensures that VPNs can stay active, and local firewall or network changes will never disrupt the reliability of the application. The UI frames relay mode as a supported first-class connection path, not a network failure.

VPN can stay on. CrossBridge sends encrypted app messages through relay mode.

## Repository Layout

```text
crossbridge/
  apps/
    android/
    windows/
  services/
    relay/
  packages/
    protocol/
    crypto/
    shared-types/
  docs/
  scripts/
```

## Prerequisites

Required for the TypeScript workspaces:

- Node.js 22 or newer
- npm 11 or newer

Required later for the Windows desktop shell:

- Rust
- Cargo
- Tauri system dependencies for Windows

Required later for Android:

- Android Studio
- JDK 17 or newer
- Android SDK API 36
- Committed Gradle wrapper in `apps/android`; installed Gradle is only needed to regenerate it

Run:

```bash
npm run check:prereqs
```

## Install

```bash
npm install
```

## Build and Test

```bash
npm run check
```

This currently builds and tests the TypeScript protocol, crypto helpers, relay service, shared types, and Windows React frontend.

Android is verified separately because it depends on local Java, Gradle, and Android SDK tooling:

```bash
npm run android:doctor
npm run android:test
npm run android:build
```

The root `npm run check` command intentionally stays TypeScript-only for now so protocol, relay, and Windows frontend work remains usable on machines without Android tooling.

For a one-command release-readiness verification pass on a machine with Android and Windows native tooling installed, run:

```bash
npm run verify:full
```

## Android build environment

Required Android tooling:

- JDK 17 or newer on `PATH`
- Android Studio or Android SDK command-line tools
- Android SDK platform API 36 (`platforms;android-36`)
- Android SDK build tools 35.0.0 (`build-tools;35.0.0`)
- The committed Gradle wrapper in `apps/android`

Set one Android SDK environment variable to the SDK directory:

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
```

Windows PowerShell:

```powershell
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
```

The Android Gradle plugin is configured in `apps/android/build.gradle.kts`; the committed wrapper uses Gradle 8.13 for this project.

If the wrapper ever needs to be regenerated, generate it from `apps/android` after installing Gradle:

```bash
cd apps/android
gradle wrapper --gradle-version 8.13
```

Windows PowerShell:

```powershell
cd apps/android
gradle wrapper --gradle-version 8.13
```

Do not create a placeholder `gradle-wrapper.jar`; the wrapper JAR must be generated by Gradle.

On Windows, the Android npm scripts also check Android Studio's bundled JBR and the default SDK location when `JAVA_HOME`, `ANDROID_HOME`, or `ANDROID_SDK_ROOT` are not visible in the current shell. Explicit environment variables still take precedence.

Run Android verification locally:

```bash
cd apps/android
./gradlew :app:testDebugUnitTest
./gradlew :app:assembleDebug
```

Windows PowerShell:

```powershell
cd apps/android
.\gradlew.bat :app:testDebugUnitTest
.\gradlew.bat :app:assembleDebug
```

The GitHub Actions Android workflow installs JDK 17, Android SDK platform 36, build tools 35.0.0, and Gradle cache support, then uses the committed real Gradle wrapper.

## Run Relay Server

```bash
npm run dev:relay
```

Default relay endpoint:

```text
ws://127.0.0.1:8787/connect
```

For a detailed step-by-step checklist of deployment commands, environment variables, DNS mappings, and TLS termination setups for production hosts (Render or VPS), see [docs/hosted-relay-deployment-checklist.md](docs/hosted-relay-deployment-checklist.md).

Useful environment variables:

```text
CROSSBRIDGE_RELAY_HOST=127.0.0.1
CROSSBRIDGE_RELAY_PORT=8787
CROSSBRIDGE_RELAY_MAX_PAYLOAD_BYTES=2000000
CROSSBRIDGE_RELAY_HEARTBEAT_MS=30000
CROSSBRIDGE_PAIRING_TTL_MS=120000
CROSSBRIDGE_PAIRING_CLEANUP_MS=30000
```

For emulator runtime pairing, keep the Windows relay connection pointed at:

```text
ws://127.0.0.1:8787/connect
```

Set the Android QR relay URL on the Windows Pair page to:

```text
ws://10.0.2.2:8787/connect
```

For a physical Android phone, use the PC LAN address in the Android QR relay URL:

```text
ws://<PC-LAN-IP>:8787/connect
```

Physical-phone testing may require the relay to listen on the LAN interface:

```powershell
$env:CROSSBRIDGE_RELAY_HOST="0.0.0.0"
npm run dev:relay
```

This is only for development runtime testing. Relay mode remains the intended VPN-safe architecture.

After the first successful pairing, both apps load trusted devices on startup. If the relay is running, Windows reconnects with `ws://127.0.0.1:8787/connect` by default, Android reconnects with the last successful Android relay URL, and each app announces itself only to locally trusted peers. For the Android emulator that URL is usually `ws://10.0.2.2:8787/connect`; for a physical phone it is usually `ws://<PC-LAN-IP>:8787/connect`.

## Run Windows App

Frontend only:

```bash
npm run dev:windows
```

Tauri shell, after Rust/Cargo are installed:

```bash
npm run tauri:dev
```

The MVP must call narrow Rust commands from the frontend:

- `get_or_create_windows_identity`
- `reset_windows_identity_for_dev_only`
- `load_trusted_devices`
- `save_trusted_device`
- `remove_trusted_device`
- `clear_trusted_devices`
- `pair_device`
- `send_file`
- `send_text`
- `get_devices`
- `get_connection_status`
- `update_settings`
- `dismiss_notification`
- `reply_notification`

## Trusted Device Features

Implemented in this slice:

- Windows can send plain text and `http://` / `https://` URLs to Android.
- Android can send plain text and `http://` / `https://` URLs to Windows.
- Windows and Android can both offer, accept, reject, cancel, and complete encrypted file transfers.
- Android can receive text, a single file, or multiple files from the Android share sheet and hand them into CrossBridge for forwarding.
- Windows can mirror Android notification metadata and send dismiss or direct-reply actions when Android exposes them.
- Sending to an offline trusted device fails with a clear offline message.

Still not implemented:

- Background clipboard sync.
- Screen mirroring.
- SMS/calls.
- Account login or cloud sync.

Development test flow:

```bash
npm run relay:start
npm run windows:web
npm run android:install
```

Use `ws://127.0.0.1:8787/connect` for the Windows relay URL and `ws://10.0.2.2:8787/connect` for the Android emulator QR relay URL. Pair once, let both apps auto-connect, then use the Windows `Share`, `Transfers`, and `Notifications` pages plus the Android `Share text or link`, `File transfers`, and notification-access screens.

Current payload protection:

- Pairing and trusted-device presence still use the relay connection established by the apps.
- Text/link payloads are now encrypted before they are placed in the relay envelope and are only accepted for mutually trusted online devices.
- Current app-layer crypto is development-grade real encryption: ECDH P-256 key agreement, HKDF-SHA256 key derivation, AES-GCM payload encryption, random 96-bit nonce per message, and authenticated envelope metadata.
- The relay routes encrypted payload envelopes only. It sees device IDs, message IDs, timestamps, nonces, algorithm/key IDs, and ciphertext, but it must not inspect, permanently store, or log shared text/link content.
- This is not yet production-grade E2EE. Native Windows mode protects the ECDH private key with DPAPI, Android wraps the private key with Android Keystore-backed AES-GCM where available, and browser/dev fallbacks still use local development storage.

## Windows storage modes

Windows storage now uses one frontend API with two current backends:

- Browser dev mode: `localStorage` fallback for the Windows development identity, real development ECDH private key, and trusted Android metadata.
- Native mode: Tauri command bridge with JSON identity/trusted-device metadata under the app data directory and DPAPI-protected private-key material.
- Future mode: stronger native identity generation, key rotation, and production-grade key lifecycle controls.

The browser fallback is development-only. Current public keys are real exported ECDH P-256 public keys, and private keys are real ECDH private keys stored locally in development storage when native protection is unavailable.

## Testing Windows Pairing UI With Mock Android Client

1. Start the relay server:

   ```bash
   npm run dev:relay
   ```

2. Start the Windows dev UI:

   ```bash
   npm run dev:windows
   ```

3. Open the Pair page, keep the default relay URL, and click `Create pairing code`.
4. Copy the QR payload JSON into a file, for example `tmp/qr-payload.json`.
5. Run the mock Android helper:

   ```bash
   npm run mock:android-pair -- --qr ./tmp/qr-payload.json
   ```

6. Confirm the same verification code appears in the Windows UI and the helper output.
7. Click `Confirm pairing` in the Windows UI.
8. Press Enter in the mock Android helper so Android confirms too.
9. The Windows UI shows pairing complete.
10. Open the Devices page and confirm the trusted Android device appears after refresh.
11. Refresh the page and confirm the trusted Android device still appears.
12. Remove the trusted device and confirm the Devices page updates.

For browser development, the Windows UI uses `localStorage` fallback storage. Native builds use the Tauri command bridge for identity, trusted-device persistence, and DPAPI-protected private-key persistence. Native Android QR scanning is implemented. VPN can stay on. Pairing uses relay mode.

## Run Android App

First check local Android prerequisites:

```bash
npm --prefix apps/android run doctor
```

Then run JVM unit tests and build from `apps/android` with Android Studio or:

```bash
npm run android:test
npm run android:build
```

The equivalent local Gradle commands are:

```bash
cd apps/android
./gradlew :app:testDebugUnitTest
./gradlew :app:assembleDebug
```

On Windows, use `.\gradlew.bat` instead.

The debug APK is produced at:

```text
apps/android/app/build/outputs/apk/debug/app-debug.apk
```

This repo includes the generated Gradle 8.13 wrapper in `apps/android`. Do not create or commit a placeholder `gradle-wrapper.jar`; regenerate the wrapper only with Gradle if it needs to be refreshed.

The Android app currently declares internet, network-state, and camera permissions, plus Android share-sheet intent filters and a notification-listener service. Camera permission is requested only when the QR scanner opens. Notification listener access still requires the user to turn it on manually in Android settings.

The Android app now includes the relay pairing client, QR payload parser, local Android identity store, trusted Windows device store, and Compose screens for QR JSON paste, verification, confirmation, and trusted devices. JVM unit tests cover QR parsing, pairing-code fixture parity, trusted-device storage, and Android identity storage. Native camera QR scanning is implemented with CameraX and ML Kit barcode detection. The QR JSON paste flow remains available as a development fallback.

### Manual Android Relay Pairing Flow

1. Start the relay:

   ```bash
   npm run dev:relay
   ```

2. Start the Windows UI:

   ```bash
   npm run dev:windows
   ```

3. Open the Windows Pair page.
4. Keep `Windows relay URL` as `ws://127.0.0.1:8787/connect`.
5. Set `Android QR relay URL`:
   - Emulator: `ws://10.0.2.2:8787/connect`
   - Physical phone: `ws://<PC-LAN-IP>:8787/connect`
6. Click `Create pairing code`.
7. Copy the QR payload JSON from Windows.
8. Install and open the Android debug APK.
9. Tap `Scan QR code` and scan the QR code displayed on the Windows Pair page. Or tap `Paste QR JSON for dev testing` to paste the payload manually.
10. If pasting, paste the QR payload JSON and tap `Join pairing session`.
11. Confirm Windows and Android show the same 6-digit verification code.
12. Click `Confirm pairing` on Windows.
13. Tap `Confirm pairing` on Android.
14. After `PAIRING_COMPLETE`, Windows lists the Android device and Android lists the trusted Windows device.
15. Refresh the Windows UI and restart the Android app to verify trusted devices persist.
16. With the relay still running, both apps reconnect automatically and show the trusted peer as online.

VPN can stay on. CrossBridge sends encrypted app messages through relay mode.

## Security Model

- Each device owns a development long-term ECDH P-256 identity key pair.
- Pairing currently works over relay mode with a short-lived QR payload and token.
- Pairing shows a 6-digit verification code on both devices.
- Trusted devices are saved only after user confirmation.
- Text/link payloads use real app-layer encryption through the existing relay envelope path.
- Current encryption is development-grade, not production-grade E2EE; private keys use protected storage where practical, with development fallbacks still present for browser mode and unavailable platform protection.
- The relay forwards app payload envelopes and should not inspect user content.
- Replay protection records recently accepted encrypted envelope IDs/nonces and drops duplicate decrypted payload envelopes.
- Received files must be verified by SHA-256 before being kept.
- Risky file extensions must never auto-open.

See [docs/security.md](docs/security.md).

## Known Limitations

- Pairing, trusted-device auto-connect, text/link sharing, file transfer, Android share-sheet receive, and notification mirror/reply/dismiss are implemented in the current development flow.
- Trusted-device auto-connect is for the opened Windows app and opened Android app; there is no finished Android foreground-service or always-on background release behavior yet.
- The Windows browser UI is still useful for development, but tray behavior and DPAPI-backed key storage require the native Tauri runtime.
- Unsigned Windows Tauri bundles may be blocked at runtime by WDAC/AppLocker on restricted machines even if they build successfully.
- Android debug builds are suitable for tester installs, but a signed Android release build and distribution workflow are still pending.
- There is no hosted relay environment bundled with this repo. Testers still need a locally started relay or a separately hosted compatible relay.
- Runtime Android pairing is verified with the debug APK on an emulator using `ws://10.0.2.2:8787/connect`.
- This is still a development and tester flow, not a fully signed end-user release.

## Development Roadmap

1. Repo scaffold
2. Relay server and shared protocol
3. Relay-based pairing protocol with mock clients
4. Windows pairing UI and Android placeholders
5. Connection manager
6. Text/link sharing
7. File transfer
8. Notification mirroring
9. Notification actions
10. Polish, installer notes, tray, startup option, logs export, privacy settings
