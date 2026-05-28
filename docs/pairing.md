# Pairing

CrossBridge currently pairs devices through the relay. This is the VPN-safe foundation: the first successful connection does not depend on local network discovery, broadcast traffic, or same-Wi-Fi reachability.

## Relay Pairing Flow

1. The Windows client loads its public identity through the storage bridge, connects to `/connect`, and sends `PAIRING_SESSION_CREATE`.
2. The relay creates a short-lived session with a random session ID, random token, expiry timestamp, PC identity, and `WAITING_FOR_ANDROID` status.
3. The relay returns `PAIRING_SESSION_CREATED` with a QR payload.
4. The Android client reads the QR payload, connects to the relay URL in that payload, and sends `PAIRING_JOIN` with the token and Android public identity.
5. The relay validates the token and expiry, stores the Android identity, derives the 6-digit verification code, and sends `PAIRING_JOINED` to both sides.
6. Each side displays the same verification code.
7. Both devices send `PAIRING_CONFIRM`.
8. After both confirmations, the relay sends `PAIRING_COMPLETE` with trusted-device metadata.
9. The Windows client saves trusted Android metadata through the async trusted-device store. The Android native client saves trusted Windows metadata after `PAIRING_COMPLETE`; the mock Android helper prints the trusted Windows metadata for its manual flow.

## QR Payload

```json
{
  "protocol": "crossbridge-v1",
  "pairingSessionId": "pair_...",
  "relayUrl": "ws://127.0.0.1:8787/connect",
  "pcDeviceId": "pc_xxx",
  "pcDeviceName": "Adam-PC",
  "pcPublicKey": "base64-public-key",
  "pairingToken": "short-lived-token",
  "expiresAt": 1779100120000
}
```

During development runtime testing, the Windows Pair page has two relay URL fields:

- `Windows relay URL`: the URL the Windows browser uses to connect to the relay.
- `Android QR relay URL`: the URL written into the QR payload for Android to consume.

For emulator testing, use:

```text
Windows relay URL: ws://127.0.0.1:8787/connect
Android QR relay URL: ws://10.0.2.2:8787/connect
```

For physical-phone testing, use the PC LAN address in the Android QR relay URL:

```text
ws://<PC-LAN-IP>:8787/connect
```

The relay may need to listen on `0.0.0.0` for physical-phone development testing. This does not make CrossBridge a same-network-only product; relay mode remains the foundation.

The Windows Pair page displays the QR payload as a scannable QR code image. The compact JSON (without pretty-printing) is encoded in the QR code. A copy button and collapsible JSON view are available as fallbacks.

## VPN Compatibility

Relay pairing works when local discovery is blocked. VPN users can keep their current network settings because Android only needs the relay URL from the QR payload and an outbound WebSocket connection.

Local LAN pairing can be added later as an optimization, but relay pairing is the primary foundation.

## Windows storage modes

- Browser dev mode: Windows uses `localStorage` fallback for the development identity, trusted Android metadata, and development private key.
- Native mode: Windows calls Tauri commands for identity and trusted-device persistence; public identity and trusted-device metadata are stored in the app data directory and private-key material is protected with DPAPI.
- Future mode: Windows should move more identity lifecycle control fully into native code where feasible.

The browser fallback is development-only. Full native key generation, stronger lifecycle controls, and release signing are still pending.

## What The Relay Can See

The relay can see pairing metadata:

- Device IDs
- Device names
- Public keys
- Pairing session IDs
- Pairing tokens
- Expiry timestamps
- Pairing state

The relay must not receive or store private keys. For text/link traffic in this slice, the relay forwards encrypted app payload envelopes, enforces trusted online targets, and must not inspect, permanently store, or log message content. Current app-layer encryption is development-grade real crypto because private keys are still stored in development storage.

## Verification Code

The 6-digit code is deterministic. It is derived with SHA-256 from:

- PC public key
- Android public key
- Pairing session ID

Both devices use the same input order: PC public key first, Android public key second, pairing session ID third. If a public key is substituted, the displayed code changes.

The exact canonical input matches `packages/protocol`:

```json
{"version":1,"pcPublicKey":"pc_test_public_key","androidPublicKey":"android_test_public_key","pairingSessionId":"pairing_test_session"}
```

Fixture:

```text
PC public key: pc_test_public_key
Android public key: android_test_public_key
Pairing session ID: pairing_test_session
Expected code: 926486
```

Android ports this same SHA-256 and first-UInt32BE modulo `1_000_000` logic in `PairingCode.kt`.

## Android QR Scanning Flow

The Android app can scan the Windows pairing QR code with the camera, or accept pasted QR payload JSON as a dev fallback:

1. Start `npm run dev:relay`.
2. Start `npm run dev:windows`.
3. Open the Windows Pair page.
4. Keep `Windows relay URL` as `ws://127.0.0.1:8787/connect`.
5. Set `Android QR relay URL` to `ws://10.0.2.2:8787/connect` for an emulator or `ws://<PC-LAN-IP>:8787/connect` for a physical phone.
6. Click `Create pairing code`.
7. The QR code is displayed on the Windows Pair page.
8. Open the Android app.
9. Tap `Scan QR code` and scan the QR code on the Windows Pair page. Or tap `Paste QR JSON for dev testing` to paste the JSON manually.
10. If pasting, paste the JSON and join the pairing session.
11. Compare the verification code on Windows and Android.
12. Confirm on both devices.
13. Android saves the trusted Windows device after `PAIRING_COMPLETE`.
14. Windows saves the trusted Android device after `PAIRING_COMPLETE`.
15. Restart Android and refresh Windows to confirm trusted-device persistence.
16. Keep the relay running, reopen both apps, and confirm the trusted peer comes online without another QR scan.

VPN can stay on. CrossBridge sends encrypted app messages through relay mode.

## Trusted-Device Auto-Connect

After the first confirmed pairing, manual re-pairing is not required unless a trusted device is removed.

Development auto-connect flow:

1. Start the relay with `npm run dev:relay`.
2. Open the Windows UI with `npm run dev:windows`.
3. Open the Android app.
4. If trusted devices are saved locally, both apps connect to the relay automatically.
5. Windows sends `TRUSTED_DEVICE_HELLO` with its Windows identity and trusted Android device IDs.
6. Android sends `TRUSTED_DEVICE_HELLO` with its Android identity and trusted Windows device IDs.
7. The relay reports `TRUSTED_DEVICE_ONLINE` only for peers that are currently online and already trusted by the receiving app.
8. The Windows Devices page and Android Trusted devices screen show online/offline state and a manual reconnect button.

Windows uses `ws://127.0.0.1:8787/connect` by default. Android uses the relay URL saved from the successful pairing QR payload. For the emulator this is usually `ws://10.0.2.2:8787/connect`; for a physical phone it is usually `ws://<PC-LAN-IP>:8787/connect`.

## Trusted Device Features After Pairing

After the trusted-device auto-connect flow reports the peer online, CrossBridge can use the same relay connection for:

- Text and link sharing in both directions.
- Encrypted file transfer in both directions.
- Android share-sheet forwarding into CrossBridge.
- Android notification mirror, dismiss, and reply when permissions and source-app actions allow it.

Development test flow:

1. Start the relay with `npm run relay:start`.
2. Start the Windows UI with `npm run windows:web` or `npm run windows:start`.
3. Install and open the Android debug app.
4. Pair once if no trusted devices are saved.
5. Confirm both devices show the trusted peer online.
6. Use the Windows `Share`, `Transfers`, and `Notifications` pages.
7. Use the Android `Share text or link`, `File transfers`, and notification-access screens.
8. Stop the relay and verify sending reports that the trusted device is offline.
9. Restart the relay and verify both apps reconnect before sending again.

Current payload protection:

- Trusted messages are routed through the existing relay envelope path and are accepted only for mutually trusted online peers.
- Windows and Android encrypt the inner trusted app messages before sending them to the relay.
- Current app-layer crypto uses ECDH P-256, HKDF-SHA256, AES-GCM, a fresh random nonce per message, and authenticated relay metadata.
- This is development-grade real encryption, not production-grade E2EE. Native key lifecycle hardening and the preferred X25519 agreement remain pending.
- The relay must not inspect, permanently store, or log shared content.

## Current Limits

- Android native relay pairing is implemented with a QR JSON paste path and native camera QR scanning.
- Android JVM unit tests cover QR parsing, the verification-code fixture, trusted-device storage, and Android identity storage.
- Android runtime pairing is verified on an emulator with `ws://10.0.2.2:8787/connect`.
- Native Android camera QR scanning is implemented with CameraX and ML Kit.
- This is a development runtime pairing and auto-connect flow, not the final installer or APK distribution workflow.
- Auto-connect runs while the apps are open; full production background service behavior is not implemented yet.
- Android identity and trusted Windows devices currently use SharedPreferences, while the Android private key is wrapped with Android Keystore-backed AES-GCM when available and falls back only when protected storage is unavailable.
- Full Tauri Rust pairing commands are not implemented, but the Windows storage bridge, DPAPI-backed private-key persistence, and tray runtime are already in place.
- The Windows development UI still uses browser `localStorage` fallback until the app runs inside Tauri.
- Full release signing, hosted relay operations, and installer-grade setup are still pending.
- Android builds require JDK 17+, Android SDK API 36, and a Gradle wrapper or installed Gradle.
- Screen mirroring, clipboard sync, SMS/calls, account login, and cloud storage remain outside this slice.

## Testing Windows Pairing UI With Mock Android Client

1. Start the relay server with `npm run dev:relay`.
2. Start the Windows development UI with `npm run dev:windows`.
3. Open the Pair page.
4. Click `Create pairing code`.
5. Copy the QR payload JSON into a file such as `tmp/qr-payload.json`.
6. Run `npm run mock:android-pair -- --qr ./tmp/qr-payload.json`.
7. Confirm that Windows and the mock Android helper show the same verification code.
8. Click `Confirm pairing` in Windows.
9. Press Enter in the mock Android helper so Android sends its confirmation.
10. Confirm Windows shows pairing complete.
11. Open the Devices page and confirm the trusted Android device appears.
12. Refresh the page and confirm the trusted Android device still appears.
13. Remove the trusted device and confirm the Devices page updates.

The mock helper accepts QR JSON from `--qr` or stdin. Native Android camera QR scanning is implemented. The QR JSON paste fallback is still available. VPN can stay on. This flow uses relay mode.
