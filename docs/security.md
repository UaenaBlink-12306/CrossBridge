# Security Model

Security is part of the MVP, not a later polish pass.

## Identity

Each device has:

- Device ID
- Device name
- Long-term public/private key pair
- Trusted peer list

Private keys should be stored with OS-backed protection where feasible:

- Android: Android Keystore
- Windows: OS-protected storage

## Windows storage modes

- Browser dev mode: `localStorage` stores the Windows development identity, trusted-device metadata, and a real ECDH P-256 private key.
- Native mode: the React frontend calls Tauri commands for identity and trusted-device persistence; public identity/trusted-device metadata is written as JSON under the app data directory, and private-key material is protected with Windows DPAPI.
- Future mode: Windows key generation, rotation, and lifecycle controls should move further into native code where feasible.

The relay receives public identity metadata for pairing, but it must not receive private keys. Full secure native key generation and X25519 identity support are still pending.

## Android storage modes

- Current Android mode: SharedPreferences stores stable public Android identity metadata and trusted Windows metadata; private-key material is wrapped with Android Keystore-backed AES-GCM where available, with a SharedPreferences fallback only when protected storage is unavailable.
- Current Android public key: exported from the development ECDH P-256 key pair, with no private key sent to the relay.
- Future Android mode: Android Keystore-backed non-exportable key agreement or stronger native key lifecycle controls.

The Android trusted-device store ignores malformed stored entries, deduplicates by `deviceId`, and saves trusted Windows metadata only after `PAIRING_COMPLETE`.

## Pairing

Pairing must use:

- QR code
- Short-lived pairing token
- Public key exchange
- 6-digit verification code on both devices
- Explicit user confirmation

Trusted devices should be saved only after both screens confirm the same code.

The current implementation proves this over relay mode with the Windows UI, the mock Android helper, and the Android native pairing client. The relay sees public identity metadata and the short-lived token, but it does not receive private keys.

The 6-digit verification code is derived from the PC public key, Android public key, and pairing session ID with SHA-256. It lets users detect a relay or network attacker who tries to substitute one public key during pairing.

The shared fixture is:

```text
PC public key: pc_test_public_key
Android public key: android_test_public_key
Pairing session ID: pairing_test_session
Expected code: 926486
```

## Transport

TLS protects transport. App-layer encryption protects user payloads from the relay.

Current app-layer encryption for trusted text/link messages:

1. Exchange development ECDH P-256 public keys during pairing.
2. Derive a shared payload key with ECDH and HKDF-SHA256.
3. Encrypt each inner app message with AES-GCM and a fresh random 96-bit nonce.
4. Authenticate envelope metadata as AES-GCM additional authenticated data.
5. Wrap ciphertext in the shared encrypted envelope.

This is real app-layer encryption, but it is still development-grade rather than production-grade E2EE. Private keys use protected storage where practical, replayed decrypted envelopes are deduplicated, and the preferred X25519 key agreement remains pending.

## Relay-Visible Envelope

```json
{
  "version": 1,
  "fromDeviceId": "android_xxx",
  "toDeviceId": "pc_xxx",
  "messageId": "msg_xxx",
  "ciphertext": "base64",
  "nonce": "base64",
  "timestamp": 1779100000000,
  "algorithm": "ECDH-P256-HKDF-SHA256-AES-GCM",
  "keyId": "..."
}
```

## Inner Message

```json
{
  "version": 1,
  "id": "msg_xxx",
  "type": "TEXT_SHARE",
  "timestamp": 1779100000000,
  "fromDeviceId": "pc_xxx",
  "toDeviceId": "android_xxx",
  "payload": {}
}
```

The relay routes only the outer envelope. Windows and Android decrypt the inner message.

## Replay Protection

Windows and Android record recently accepted encrypted envelope IDs/nonces and drop duplicate decrypted payload envelopes before applying share side effects or acknowledgements.

Future hardening should add tighter timestamp sanity checks and monotonic counters where possible.

## File Safety

Received files must be verified with SHA-256 before they are kept.

Risky extensions:

```text
.exe
.msi
.bat
.cmd
.ps1
.vbs
.scr
.js
.jar
```

Risky files must not auto-open.

## Logging

Logs must redact:

- Notification content
- File names if privacy setting is enabled
- Shared text and URLs
- Keys and tokens

## Current Build Limits

Native Android camera QR scanning is implemented. Trusted text/link payloads now use real development-grade app-layer encryption with practical protected private-key storage and replay deduplication. Android build and unit-test verification require JDK 17+, Android SDK API 36, and a Gradle wrapper or installed Gradle. Windows native build verification still requires Cargo.
