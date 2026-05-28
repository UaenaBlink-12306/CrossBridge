# CrossBridge Text/Link Sharing Runtime Verification Report

**Date:** 2026-05-21
**Relay URL:** `ws://127.0.0.1:8787/connect`
**Android default relay URL (emulator):** `ws://10.0.2.2:8787/connect`

---

## Commands Run

| Command | Result |
|---------|--------|
| `npm install` | ✅ 198 packages, 0 vulnerabilities |
| `npm run check` | ✅ Build + all tests pass |
| `npm run android:doctor` | ✅ Environment ready (JDK 17, android-36, build tools 35.0.0, Gradle 8.13) |
| `npm run android:test` | ✅ `:app:testDebugUnitTest` passed |
| `npm run android:build` | ✅ `:app:assembleDebug` BUILD SUCCESSFUL |
| `npm run dev:relay` | ✅ Listening on `ws://127.0.0.1:8787/connect` |
| `npm run dev:windows` | ✅ Vite dev server at `http://127.0.0.1:5175/` |

## Test Results

### Unit Tests (all pass)

| Package | Tests | Status |
|---------|-------|--------|
| `@crossbridge/protocol` | 14 | ✅ |
| `@crossbridge/crypto` | 3 | ✅ |
| `@crossbridge/relay` | 14 (3 files) | ✅ |
| `@crossbridge/windows` | 16 (5 files) | ✅ |
| **Total** | **47** | ✅ |

### Android Build

- **Unit tests:** ✅ PASS (24 tasks, all UP-TO-DATE)
- **Debug APK:** ✅ BUILD SUCCESSFUL (37 tasks)
- APK path: `apps/android/app/build/outputs/apk/debug/app-debug.apk`

### E2E Verification (39/39 pass)

The full E2E script (`scripts/e2e-verify.ts`) simulates both a Windows and Android client connecting to the live relay server.

| Step | Test | Result |
|------|------|--------|
| 1 | Relay health check (`/health`) | ✅ Returns `{ok: true}` |
| 2 | Windows creates pairing session | ✅ Session ID + QR payload generated |
| 3 | Android joins via PAIRING_JOIN | ✅ Both sides get matching verification code |
| 4 | Both sides confirm pairing | ✅ PAIRING_COMPLETE with trusted devices |
| 5 | TRUSTED_DEVICE_HELLO mutual announcement | ✅ Both sides see each other online |
| 6 | **Windows → Android: text share** | ✅ RELAY_ACK delivered=true, Android receives text |
| 7 | **Windows → Android: URL share** | ✅ RELAY_ACK delivered=true, Android receives URL, contentType="url" |
| 8 | **Android → Windows: text share** | ✅ RELAY_ACK delivered=true, Windows receives text |
| 9 | **Android → Windows: URL share** | ✅ RELAY_ACK delivered=true, Windows receives URL, contentType="url" |
| 10 | **Offline send behavior** | ✅ RELAY_ACK delivered=false, reason="DEVICE_OFFLINE" |
| 11 | **Reconnect and resend** | ✅ Devices reconnect, resend succeeds |

## Relay URL

- Default: `ws://127.0.0.1:8787/connect`
- Windows UI relay URL field: configurable on Home and Pair pages
- Android emulator default: `ws://10.0.2.2:8787/connect` (QR payload carries the actual relay URL)
- Health endpoint: `GET http://127.0.0.1:8787/health` → `{ok: true, onlineDevices: N}`

## Sharing Results Summary

| Flow | Send | Receive | Content Type Detection | RELAY_ACK |
|------|------|---------|----------------------|-----------|
| Windows → Android text | ✅ | ✅ | `"text"` | delivered=true |
| Windows → Android URL | ✅ | ✅ | `"url"` | delivered=true |
| Android → Windows text | ✅ | ✅ | `"text"` | delivered=true |
| Android → Windows URL | ✅ | ✅ | `"url"` | delivered=true |

### Copy/Open Actions (code-verified)

| Platform | Copy | Open (URL only) | Share (Android only) |
|----------|------|------------------|----------------------|
| **Windows** | `navigator.clipboard.writeText()` | `window.open(url, "_blank", "noopener,noreferrer")` | N/A |
| **Android** | `ClipboardManager.setText()` | `Intent(ACTION_VIEW, Uri.parse(url))` | `Intent(ACTION_SEND) + createChooser()` |

## Offline Behavior

- When Android disconnects, Windows receives `TRUSTED_DEVICE_OFFLINE` notification
- Sending to offline device: relay returns `RELAY_ACK {delivered: false, reason: "DEVICE_OFFLINE"}`
- Windows UI shows share error: "device is offline"
- Android UI shows: "Failed to send because the device is offline."

## Reconnection Behavior

- Both platforms use exponential backoff: 1s → 2s → 5s → 10s → 30s (max)
- Android: unlimited reconnect attempts (`RECONNECT_MAX_ATTEMPTS = Int.MAX_VALUE`)
- Windows: also unlimited (reconnect loop continues until manual disconnect)
- On reconnect: client sends `RELAY_HELLO` → `TRUSTED_DEVICE_HELLO` → relay notifies peers via `TRUSTED_DEVICE_ONLINE`
- Verified: after relay restart, both devices reconnect and sharing resumes successfully

## Runtime Bugs Found and Fixed

No runtime bugs were found during this verification. The codebase functions correctly as implemented.

**Note:** The E2E test script itself required fixes (not in the product code):
- `btoa()` doesn't handle Unicode → switched to `Buffer.from().toString("base64")`
- Message ordering between `waitForType` and `waitForEnvelope` → added `drain()` and filter-by-type logic
- This is a test infrastructure issue, not a product bug.

## Known Limitation

⚠️ **App-layer E2EE is still pending.** Text/link payloads currently use Base64 encoding inside the relay envelope, not real encryption. The `ciphertext` field contains `base64(JSON.stringify(controlMessage))`, and the `nonce` is random but unused for decryption. This should NOT be described as secure E2EE.

## Windows UI Verification (Browser)

- Home page renders correctly with connection status "Not paired"
- Pair page shows relay URL fields and "Create pairing code" button
- Share page shows device selector, text input, send button (disabled when no trusted devices)
- Debug page shows "Export logs" button
- All navigation tabs work (Home, Pair, Devices, Share, Transfers, Notifications, Settings, Debug)

## Architecture Summary

```
Windows (React+Vite)  ←→  Relay (Fastify+ws)  ←→  Android (Kotlin+Ktor)
     |                         |                        |
  RelayClient              MessageRouter            RelayClient
  ConnectionManager        ConnectionManager        ConnectionManager
  ShareClient              routeEncryptedEnvelope   ShareClient
  PairingClient            announceTrusted*         PairingClient
```

Message flow: `sender → createTextShareEnvelope() → relay → RELAY_ACK → recipient → decodeShareEnvelope() → TEXT_SHARE_ACK`
