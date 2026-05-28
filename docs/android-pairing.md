# Android Pairing

The Android app has a native relay pairing client with camera QR scanning and a QR JSON paste fallback.

## Implemented Flow

1. Android scans a CrossBridge QR code with the camera, or accepts pasted QR payload JSON as a dev fallback.
2. `PairingQrParser` validates `crossbridge-v1`, the relay WebSocket URL, non-empty session and identity fields, token presence, and future expiry.
3. `AndroidIdentityStore` loads or creates a stable Android identity in SharedPreferences.
4. `RelayClient` opens the relay WebSocket and sends/receives JSON messages.
5. `PairingClient` sends `RELAY_HELLO`, waits for `RELAY_WELCOME`, then sends `PAIRING_JOIN`.
6. Android receives `PAIRING_JOINED`, verifies the deterministic 6-digit code locally, and displays it.
7. Android sends `PAIRING_CONFIRM` only after the user taps `Confirm pairing`.
8. Android receives `PAIRING_COMPLETE`.
9. `TrustedDeviceStore` saves the trusted Windows device in SharedPreferences JSON.
10. The Trusted devices screen lists saved Windows devices and supports removal.

VPN can stay on. CrossBridge sends encrypted app messages through relay mode.

## Text and Link Sharing

The Android app now includes an in-app `Share text or link` screen. It uses the trusted relay connection created by pairing and auto-connect.

What works now:

- Receive text from Windows and copy it manually.
- Receive URLs from Windows and open or copy them manually.
- Send text from Android to a trusted online Windows device.
- Send `http://` and `https://` URLs from Android to a trusted online Windows device.
- Share received text through Android's standard share chooser.

What does not work yet:

- Screen mirroring.
- Background clipboard sync.
- SMS/calls.
- Account login and cloud storage.

Development flow:

1. Start the relay with `npm run relay:start`.
2. Start Windows with `npm run windows:web` or `npm run windows:start`.
3. Install the Android debug APK.
4. Pair once or use the saved trusted devices.
5. Confirm Windows is online on Android.
6. Open `Share text or link`, `File transfers`, or `Notification mirroring` depending on the flow you want to verify.

Current payload protection:

- Android sends and receives trusted payloads through encrypted relay envelopes accepted only for mutually trusted online peers.
- The current app-layer crypto uses ECDH P-256, HKDF-SHA256, AES-GCM, a fresh random nonce per message, and authenticated relay metadata.
- This is development-grade real encryption, not production-grade E2EE. Android wraps the private key with Android Keystore-backed AES-GCM when available and falls back only when protected storage is unavailable.
- The relay must not inspect, permanently store, or log shared content.

## Manual Dev Flow

```text
1. Start relay:
   npm run dev:relay

2. Start Windows UI:
   npm run dev:windows

3. Open Windows Pair page.

4. Keep Windows relay URL:

   ws://127.0.0.1:8787/connect

5. Set Android QR relay URL:

   Emulator:
   ws://10.0.2.2:8787/connect

   Physical phone:
   ws://<PC-LAN-IP>:8787/connect

6. Click Create pairing code.

7. Copy QR payload JSON from Windows.

8. Install and open the Android debug APK.

9. Tap Scan QR code and scan the QR code on the Windows Pair page.
   Or tap Paste QR JSON for dev testing for the dev fallback.

10. Paste QR payload JSON.

11. Android joins relay pairing session.

12. Windows and Android both show the same verification code.

13. Click Confirm pairing on Windows.

14. Tap Confirm pairing on Android.

15. Both sides receive pairing complete.

16. Windows Devices page shows Android device.

17. Android Trusted Devices screen shows Windows device.

18. Restart Android and refresh Windows to confirm trusted devices persist.

19. With the relay still running, both apps reconnect automatically and show the trusted peer online.
```

The Android emulator reaches the host relay through `ws://10.0.2.2:8787/connect`, not `ws://127.0.0.1:8787/connect`. A physical phone uses the PC LAN IP, for example `ws://192.168.x.x:8787/connect`; the relay may need `CROSSBRIDGE_RELAY_HOST=0.0.0.0` for that development setup.

The debug APK allows local `ws://` relay URLs for emulator and LAN runtime testing. This is the development runtime pairing and auto-connect path, not the final installer or APK distribution workflow.

After pairing completes, Android saves the Android-facing relay URL from the QR payload for trusted-device auto-connect. Emulator testing normally keeps `ws://10.0.2.2:8787/connect`; physical-phone testing normally keeps `ws://<PC-LAN-IP>:8787/connect`. The Windows UI keeps its own relay URL and defaults to `ws://127.0.0.1:8787/connect`.

## Verification Code Fixture

Android ports the TypeScript helper in `packages/protocol/src/pairing.ts`. The canonical JSON string preserves TypeScript `JSON.stringify` insertion order:

```json
{"version":1,"pcPublicKey":"pc_test_public_key","androidPublicKey":"android_test_public_key","pairingSessionId":"pairing_test_session"}
```

```text
PC public key: pc_test_public_key
Android public key: android_test_public_key
Pairing session ID: pairing_test_session
Expected code: 926486
```

The algorithm is SHA-256 over the canonical JSON, then first UInt32BE modulo `1_000_000`, padded to 6 digits.

## Android build environment

Required local tooling:

- JDK 17 or newer
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

This repo includes the generated Gradle 8.13 wrapper. Installed Gradle is only needed if the wrapper needs to be regenerated:

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

Commands:

```bash
npm run android:doctor
npm run android:test
npm run android:build
```

Equivalent Gradle commands:

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

The debug APK is produced at:

```text
apps/android/app/build/outputs/apk/debug/app-debug.apk
```

On Windows, the Android npm scripts also check Android Studio's bundled JBR and the default SDK location when `JAVA_HOME`, `ANDROID_HOME`, or `ANDROID_SDK_ROOT` are not visible in the current shell. Explicit environment variables still take precedence.

The GitHub Actions Android workflow sets up JDK 17, Android SDK platform 36, build tools 35.0.0, and Gradle cache support, then uses the committed real Gradle wrapper.

Android verification is separate from root `npm run check` for now so TypeScript checks remain available on machines without Android tooling.

Android dependency versions are intentionally simple in this slice: plugin versions live in `apps/android/build.gradle.kts`, and app library versions live near their dependencies in `apps/android/app/build.gradle.kts`.

The Android JVM unit tests cover:

- QR parser acceptance and rejection paths
- QR parser dev paste fallbacks for URL-encoded and URL-safe Base64 payload text
- QR parser compact JSON acceptance for camera-scanned QR payloads
- QR parser rejection of non-JSON barcode contents
- Verification-code fixture parity with the TypeScript helper
- Verification-code parity for slash-bearing Base64-like public keys
- Trusted-device save, load, dedupe, update, remove, and malformed JSON handling
- Android identity create, stable load, reset, platform, and device ID prefix behavior
- Trusted-device online/offline status helper behavior
- Relay URL persistence for trusted-device auto-connect

## Storage

Android storage currently uses:

- Identity metadata: SharedPreferences with a stable `android_<uuid>`, device model/manufacturer name, and platform `android`.
- Trusted Windows devices: SharedPreferences JSON list deduplicated by `deviceId`, malformed entries ignored safely.
- Private-key storage: Android Keystore-backed AES-GCM wrapping when available, with a SharedPreferences fallback only when protected storage is unavailable.

Future work should move more identity lifecycle control into stronger native handling and prefer X25519 key agreement when available across targets. Private keys must not be sent to the relay.

## Dependencies

The Android app adds Ktor WebSocket client dependencies for relay mode:

- `io.ktor:ktor-client-core`
- `io.ktor:ktor-client-okhttp`
- `io.ktor:ktor-client-websockets`

It also uses `kotlinx-coroutines-android` for pairing state and relay work.
`kotlinx-serialization-json` and the Kotlin serialization plugin are present for protocol model work even though the current Android relay client still uses `org.json` for message handling.

For camera QR scanning:

- `androidx.camera:camera-camera2`
- `androidx.camera:camera-lifecycle`
- `androidx.camera:camera-view`
- `com.google.mlkit:barcode-scanning` (bundled model, works offline)

## Not Implemented

- Signed Android release packaging workflow.
- Hosted relay operations.
- Full always-on background behavior when the app is not open.
- Screen mirroring.
- Clipboard sync.
- LAN discovery.
- Account login.
- Cloud storage.
- Final consumer installer workflow.
