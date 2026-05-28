# Architecture

```text
                 ┌──────────────────────┐
                 │      Relay Server     │
                 │  WSS 443, dumb relay  │
                 │  no content storage   │
                 └──────────┬───────────┘
                            │
              encrypted WSS │ encrypted WSS
                            │
┌──────────────────────┐    │    ┌──────────────────────┐
│     Android App       │────┼────│      Windows App      │
│ Kotlin / Compose      │         │ Tauri / React / Rust  │
│ Share/files/notifs    │         │ Share/tray/notifs     │
│ Pairing + relay mode  │         │ Pairing + relay mode  │
└──────────────────────┘         └──────────────────────┘

Optional fast path:

┌──────────────────────┐         ┌──────────────────────┐
│     Android App       │◄───────►│      Windows App      │
│                       │  LAN    │                      │
└──────────────────────┘         └──────────────────────┘
```

## Connection Paths

CrossBridge pairs over relay first. This keeps the first connection path compatible with VPNs, hotel networks, guest Wi-Fi, and other networks that block local discovery.

Current relay pairing flow:

1. Windows connects to `/connect` and creates a pairing session.
2. The relay stores the short-lived session ID, token, PC public identity, expiry, and state.
3. Windows receives a QR payload containing the relay URL, PC public identity, token, and expiry.
4. Android connects to the same relay URL from the QR payload and joins with its public identity.
5. The relay sends both devices the PC identity, Android identity, and deterministic 6-digit verification code.
6. Both devices confirm the code.
7. The relay sends `PAIRING_COMPLETE` with trusted-device metadata.

Current trusted-device auto-connect flow:

1. Windows and Android load their local identity and trusted-device stores on app startup.
2. If trusted peers exist, each app opens a relay WebSocket.
3. Each app sends `RELAY_HELLO`, then `TRUSTED_DEVICE_HELLO` with its public device identity and the IDs it already trusts.
4. The relay keeps only temporary online socket state and the announced trusted peer IDs for that connection.
5. When both sides are online and each side has already trusted the other locally, the relay forwards `TRUSTED_DEVICE_ONLINE`.
6. When a socket closes, the relay forwards `TRUSTED_DEVICE_OFFLINE` to connected peers that had announced trust for that device.
7. Windows and Android display online/offline state only for devices already saved in local trusted-device storage.

Future connection flow can add LAN probing after this foundation:

1. Start local listener on Windows.
2. Connect to relay.
3. Put relay URL, local candidates, public key, and short-lived pairing token in the QR payload.
4. Android scans the QR code.
5. Android connects through relay and probes local candidates.
6. Use direct LAN when available.
7. Use encrypted relay when local networking is blocked.
8. Continue probing LAN occasionally and switch when available.

Relay mode is a supported state, not a failure state.

VPN can stay on. CrossBridge sends encrypted app messages through relay mode.

## Text and Link Sharing Flow

Text/link sharing uses the same trusted relay connection established after pairing:

1. Each app loads trusted devices and announces `TRUSTED_DEVICE_HELLO`.
2. The relay marks peers online only when both sides announced local trust.
3. A sender creates a `TEXT_SHARE` app payload for a selected trusted online device.
4. The payload is encrypted into the existing relay envelope shape and sent over the active WebSocket.
5. The relay verifies sender ID, target online state, and mutual trusted-peer announcements, then forwards the envelope.
6. The receiving app rejects untrusted senders, decrypts and validates the payload, shows it in the in-memory received list, and sends an encrypted `TEXT_SHARE_ACK`.
7. The sender marks the item sent after relay delivery and received after the app-level acknowledgement.

Current protection is intentionally documented narrowly: trusted payloads use real app-layer encryption, but this is development-grade rather than production-grade E2EE. The current implementation uses ECDH P-256, HKDF-SHA256, AES-GCM, fresh per-message nonces, and authenticated envelope metadata. Private keys still use development-oriented storage flows (`localStorage` on Windows browser/dev mode, DPAPI in native Windows mode, and Android Keystore-backed wrapping with a fallback when protected storage is unavailable), so stronger release lifecycle controls and the preferred X25519 key agreement remain pending. The relay routes encrypted envelopes only and must not inspect, log, or permanently store shared content.

## Relay Boundaries

During pairing, the relay may store temporarily:

- Pairing session ID
- Pairing token
- Device IDs
- Device names
- Public identity keys
- Expiry timestamp
- Pairing status

For normal app traffic, the relay may validate and route:

- Protocol version
- Sender device ID
- Receiver device ID
- Message ID
- Timestamp
- Nonce presence
- Ciphertext presence

For trusted-device presence while apps are open, the relay may temporarily know:

- Device ID
- Online socket
- Public device identity
- Announced trusted peer IDs for that socket
- Last seen timestamp

The relay does not permanently store trusted-device relationships.

The relay must not inspect, log, or permanently store app content:

- Shared text or URLs
- File contents
- File names when privacy settings require redaction
- Commands such as notification reply text

## Package Boundaries

- `packages/protocol`: shared message types, relay envelope schema, text/link payload validators, error codes, pairing schemas, and verification-code derivation.
- `packages/crypto`: cross-platform development-grade app-message encryption helpers for ECDH P-256, HKDF-SHA256, and AES-GCM.
- `packages/shared-types`: UI-safe shared TypeScript types.
- `services/relay`: WebSocket relay, online device tracking, ACKs, rate limits, trusted envelope routing, and short-lived pairing sessions.
- `apps/windows`: Tauri v2, React, TypeScript, Rust commands, browser-safe relay pairing UI, and identity/trusted-device storage abstraction.
- `apps/android`: Kotlin, Jetpack Compose, native relay pairing client, QR JSON paste flow, SharedPreferences identity/trusted-device stores, and Android services as later features are added.

## Windows Pairing UI Development Flow

The Windows React frontend can create a relay pairing session directly from the dev server. It loads the Windows identity through the storage bridge, connects to the relay WebSocket, sends the existing relay hello and pairing session messages, renders the QR payload JSON, displays the verification code after Android joins, sends Windows confirmation, and saves trusted Android metadata after `PAIRING_COMPLETE`.

For browser development, the Windows identity, development ECDH private key, trusted device list, and dev relay URL use `localStorage` fallback so the frontend flow can be tested without Tauri. Native mode now has a Tauri command bridge scaffold that stores JSON in the app data directory. Full secure OS-backed key storage belongs in a later native security milestone. Native Android QR scanning is implemented. VPN can stay on. Relay mode is the pairing and auto-connect path.

## Android Pairing UI Development Flow

The Android Compose app now mirrors the mock Android helper in native code. It parses pasted CrossBridge QR payload JSON, validates protocol fields and expiry, connects to the relay WebSocket, sends `RELAY_HELLO`, sends `PAIRING_JOIN`, displays `PAIRING_JOINED.verificationCode`, sends Android-side `PAIRING_CONFIRM`, and saves the trusted Windows device after `PAIRING_COMPLETE`.

After pairing, Android stores the successful Android-facing relay URL separately from trusted-device metadata. Emulator development usually uses `ws://10.0.2.2:8787/connect`; physical-phone development usually uses `ws://<PC-LAN-IP>:8787/connect`. When the app opens and trusted Windows devices exist, Android reconnects through that saved URL and announces trusted-device presence.

Android storage in this slice is deliberately simple:

- Android identity: SharedPreferences, stable `android_<uuid>` device ID, Android model/manufacturer name, platform `android`, and a development ECDH P-256 key pair.
- Trusted Windows devices: SharedPreferences JSON list deduplicated by `deviceId`.
- Android relay URL setting: SharedPreferences value updated from the successful pairing QR payload.
- Future identity storage: Android Keystore-backed key generation, private-key protection, and X25519 key agreement if supported across targets.

Native camera QR scanning is implemented with CameraX and ML Kit. The QR JSON paste path remains available for development fallback testing.

Android local verification now uses JVM unit tests for the QR parser, TypeScript-compatible pairing-code fixture, trusted-device storage, and identity storage. Full Android build verification requires JDK 17+, Android SDK API 36, and a Gradle wrapper or installed Gradle.

## Android build environment

Android verification is intentionally separate from root `npm run check` for now. The root check covers the TypeScript protocol, crypto helpers, relay service, shared types, and Windows React frontend without requiring Java, Gradle, or Android SDK installation.

Run the Android checks explicitly:

```bash
npm run android:doctor
npm run android:test
npm run android:build
```

Required tooling:

- JDK 17 or newer
- Android Studio or Android SDK command-line tools
- Android SDK platform API 36 (`platforms;android-36`)
- Android SDK build tools 35.0.0 (`build-tools;35.0.0`)
- The committed Gradle wrapper in `apps/android`

Set `ANDROID_HOME` or `ANDROID_SDK_ROOT` to the SDK directory before running Gradle. On Windows, the Android npm scripts also check Android Studio's bundled JBR and the default SDK location when those environment variables are not visible in the current shell.

This repo includes the generated Gradle 8.13 wrapper. Installed Gradle is only needed if the wrapper needs to be regenerated:

```bash
cd apps/android
gradle wrapper --gradle-version 8.13
```

Do not create a placeholder `gradle-wrapper.jar`; the wrapper JAR must be generated by Gradle.

Local Gradle commands:

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

The GitHub Actions Android workflow installs JDK 17, Android SDK platform 36, build tools 35.0.0, and Gradle cache support, then uses the committed real Gradle wrapper.

Current Android runtime limits remain: full production background service behavior is pending, signed release packaging is pending, and hosted relay operations are still outside this repo. VPN can stay on. CrossBridge sends encrypted app messages through relay mode.

## Windows storage modes

- Browser dev mode: `localStorage` fallback for the public Windows dev identity and trusted Android metadata.
- Native mode: Tauri command bridge for identity and trusted-device persistence.
- Future mode: OS-protected key storage for private key material and stronger native persistence.

The frontend calls the same async services in both current modes: `identityStore` for the Windows identity and `trustedDeviceStore` for trusted Android metadata.

### Testing Windows Pairing UI With Mock Android Client

1. Start the relay with `npm run dev:relay`.
2. Start the Windows UI with `npm run dev:windows`.
3. Create a pairing code on the Pair page.
4. Copy the QR payload JSON to `tmp/qr-payload.json`.
5. Run `npm run mock:android-pair -- --qr ./tmp/qr-payload.json`.
6. Compare the verification code on both screens.
7. Confirm in Windows, then press Enter in the mock helper.
8. Confirm the Devices page shows the trusted Android device.
9. Refresh the page and confirm the trusted Android device still appears.
10. Remove the trusted device and confirm the Devices page updates.
he Devices page updates.
