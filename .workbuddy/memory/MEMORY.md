# CrossBridge Project Memory

## Project Conventions

### Architecture
- Monorepo: packages (protocol, crypto, shared-types) | services (relay) | apps (windows, android)
- Protocol uses Zod schemas; shared via @crossbridge/protocol package
- Two message layers: direct relay messages ({type, payload}) and encrypted envelopes ({version, fromDeviceId, toDeviceId, messageId, timestamp, nonce, ciphertext})
- Relay is dumb: routes envelopes, enforces trust, never stores user content

### Build & Test
- Root `npm run check` = TypeScript only (protocol, crypto, relay, windows)
- Android checks are separate: `npm run android:doctor`, `android:test`, `android:build`
- Windows uses Vite/React; Android uses Kotlin + Jetpack Compose + Gradle 8.13

### Key Patterns
- ShareClient creates envelopes with base64-encoded ciphertext (not real encryption yet)
- ConnectionManager owns all state; messages flow RelayClient -> ConnectionManager -> UI
- Android mirrors TypeScript implementations 1:1 (ShareClient.kt mirrors shareClient.ts)
- Trusted devices persist in SharedPreferences (Android) / localStorage+Tauri (Windows)
- Android emulator uses ws://10.0.2.2:8787/connect; physical phones use ws://<PC-LAN-IP>:8787/connect

### VPN Messaging
- VPN can stay on. CrossBridge sends through encrypted relay mode.
- Never say "disable VPN" or "turn off VPN"

### Text/Link Sharing
- Completed 2026-05-21
- Works: Win->Android text/URL, Android->Win text/URL, Copy, Open
- Max 20,000 chars; URLs auto-detected
- E2EE pending; transport encryption via wss:// in production
