# Release Readiness

This document describes what CrossBridge testers can run today with minimal terminal work, what remains blocked for a true end-user release, and how to verify the current feature set honestly.

## Current Release Shape

CrossBridge already supports:

- Windows and Android trusted-device pairing with QR code plus 6-digit verification.
- Trusted-device auto-reconnect through relay mode.
- Encrypted text and link sharing in both directions.
- Encrypted file transfer in both directions.
- Android share-sheet receive for text, a single file, or multiple files.
- Android notification mirror, dismiss, and direct reply when Android and the source app allow it.
- Native Windows tray behavior in the Tauri runtime.

CrossBridge is not yet a finished signed consumer release. The remaining blockers are mostly packaging, signing, hosted relay operations, and platform-policy constraints rather than missing core messaging features.

VPN can stay on. CrossBridge sends encrypted app messages through relay mode.

## Fastest Tester Flow

### 1. Install dependencies

```bash
npm install
```

### 2. Start the relay

```bash
npm run relay:start
```

Default local relay URLs:

- Windows relay URL: `ws://127.0.0.1:8787/connect`
- Android emulator QR relay URL: `ws://10.0.2.2:8787/connect`
- Physical phone QR relay URL: `ws://<PC-LAN-IP>:8787/connect`

If testing with a physical phone, the relay may need to listen on the LAN interface:

```powershell
$env:CROSSBRIDGE_RELAY_HOST="0.0.0.0"
npm run relay:start
```

That is a development-hosting detail, not a product requirement to change VPN settings or rely on same Wi-Fi forever.

### 3. Start Windows

Browser UI only:

```bash
npm run windows:web
```

Native Tauri runtime:

```bash
npm run windows:start
```

Use the native Tauri runtime when you need:

- Tray behavior.
- DPAPI-backed Windows private-key protection.
- Minimize-to-tray behavior.

### 4. Build and install Android

```bash
npm run android:doctor
npm run android:build
npm run android:install
```

Debug APK path:

```text
apps/android/app/build/outputs/apk/debug/app-debug.apk
```

### 5. Pair once

1. Open the Windows `Pair` page.
2. Keep `Windows relay URL` as `ws://127.0.0.1:8787/connect`.
3. Set `Android QR relay URL`:
   - Emulator: `ws://10.0.2.2:8787/connect`
   - Physical phone: `ws://<PC-LAN-IP>:8787/connect`
4. Click `Create pairing code`.
5. On Android, scan the QR code or paste the pairing text.
6. Compare the 6-digit code on both devices.
7. Confirm on both devices.

After that, both apps reconnect to trusted peers automatically while the apps are open.

## What A Tester Can Verify Today

### Pairing and reconnect

- QR pairing works through relay mode.
- Trusted devices persist locally on both apps.
- Reopen both apps with the relay running and verify the peer shows online without another QR scan.

### Text and link sharing

- Send plain text from Windows to Android.
- Send plain text from Android to Windows.
- Send `http://` or `https://` URLs in both directions.
- Confirm offline send attempts fail clearly instead of silently disappearing.

### File transfer

- Send a file from Windows to Android.
- Send a file from Android to Windows.
- Accept, reject, or cancel an in-flight transfer.
- Verify risky file warnings appear for executable-style filenames.

Android currently saves received files under the app-specific Downloads directory when available:

```text
Android/data/dev.crossbridge.android/files/Download
```

If that directory is unavailable, CrossBridge falls back to the app cache directory.

### Local LAN Fast Path Optimization & Fallback

- Verify LAN fast path transfers files directly over local TCP sockets (port 8789) when both devices are on the same local network.
- Confirm relay fallback is active: if local direct transport fails or is blocked (e.g. firewall, separate subnet, active VPN), CrossBridge automatically and transparently falls back to the encrypted relay path.
- Verify security remains first-class: direct TCP transfer does not weaken ECDH encryption, HKDF key derivation, AES-GCM encryption, replay protection, SHA-256 integrity checks, or risky-file warnings.


### Android share-sheet receive

- From another Android app, share text into CrossBridge and forward it to Windows.
- From another Android app, share one or more files into CrossBridge and forward them to Windows.

### Notification mirroring, dismiss, and reply

- In Android, enable notification access for CrossBridge.
- Post a notification from another Android app.
- Verify the Windows `Notifications` page shows the mirrored entry.
- If the notification is dismissible, dismiss it from Windows.
- If the notification exposes Android direct reply, send a reply from Windows.

Important platform truth:

- Notification access must stay enabled on Android.
- Reply works only when the source app exposes a RemoteInput action.
- Dismiss works only when Android reports the notification as clearable.

## Windows Packaging And Tray Reality

### Windows packaging prerequisites

CrossBridge now treats the MSVC toolchain as the only supported Windows packaging path. The packaging script intentionally avoids the Rust GNU target because a plain LLVM-MinGW install can fail at link time with missing `-lgcc_eh` and `-lgcc`, which is what happened on this machine on 2026-05-27.

For a clean Windows packaging environment, install or confirm all of the following:

- Node.js 22 or newer plus npm.
- Rust via `rustup`, with the MSVC host selected: `rustup default stable-msvc`.
- The Windows Rust target: `rustup target add x86_64-pc-windows-msvc`.
- Visual Studio 2022 or newer with the `Desktop development with C++` workload.
- A Windows 10 or Windows 11 SDK installed through that workload.
- Microsoft Edge WebView2 runtime. On Windows 10 version 1803 and later, and on Windows 11, this is usually already present.
- The Windows `VBSCRIPT` optional feature if MSI creation later fails with WiX `light.exe` errors.

The repo includes a Visual Studio import file for the packaging workload:

```text
docs/windows-packaging.vsconfig
```

You can import that file in Visual Studio Installer, or run an elevated installer command such as:

```powershell
& "C:\Program Files (x86)\Microsoft Visual Studio\Installer\setup.exe" modify `
  --installPath "C:\Program Files\Microsoft Visual Studio\18\Community" `
  --config "C:\path\to\crossbridge\docs\windows-packaging.vsconfig"
```

The packaging wrapper checks for the concrete MSVC files it needs before running Tauri:

- `VC\Auxiliary\Build\vcvarsall.bat`
- `VC\Tools\MSVC\<version>\include`
- `VC\Tools\MSVC\<version>\lib\x64`
- Windows SDK `rc.exe`
- Windows SDK `ucrt` and `um` x64 libraries

### Packaging commands

Use either of these commands:

```bash
npm run tauri:build -w @crossbridge/windows
npm run windows:package:check
```

Both commands now drive the same MSVC-first packaging wrapper. In a correct environment, the wrapper exports the MSVC and Windows SDK paths, selects Rust toolchain `stable-x86_64-pc-windows-msvc`, and builds with target `x86_64-pc-windows-msvc`.

### Installer outputs

With `bundle.targets` still set to `all`, a successful Windows package build should produce output under:

```text
apps/windows/src-tauri/target/x86_64-pc-windows-msvc/release/bundle
```

Expected installer artifacts:

- `msi\*.msi`
- `nsis\*-setup.exe`

The unpackaged executable also lives under the matching `release` target tree for manual verification.

### Current machine blocker

On 2026-05-27, this workspace still cannot finish Windows packaging on the current machine because the installed Visual Studio instance is incomplete for C++ packaging work. The packaging check now reports the blocker directly:

- Missing `C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvarsall.bat`
- Missing `C:\Program Files\Microsoft Visual Studio\18\Community\VC\Tools\MSVC\14.50.35717\include`
- Missing `C:\Program Files\Microsoft Visual Studio\18\Community\VC\Tools\MSVC\14.50.35717\lib\x64`

That is an environment repair issue, not an application-feature failure. Repair or add the `Desktop development with C++` workload in Visual Studio Installer, then rerun the packaging commands above.

Exact installer evidence from this machine:

- Visual Studio installer log: `%LOCALAPPDATA%\Temp\dd_installer_20260527133249.log`
- Parsed command: `modify --installPath "C:\Program Files\Microsoft Visual Studio\18\Community" --add Microsoft.VisualStudio.Workload.NativeDesktop --includeRecommended --passive --norestart`
- Refusal: `Commands with --quiet or --passive should be run elevated from the beginning.`
- Exit code: `5007`

This shell is not elevated, so the workload repair cannot be completed from the current non-admin session. An elevated Visual Studio Installer run is still required before `npm run tauri:build -w @crossbridge/windows` and `npm run windows:package:check` can pass on this machine.

### Signing status

The repo does not currently contain a committed Windows code-signing certificate, thumbprint, private key, or Tauri signing configuration. The Windows SDK already provides `signtool.exe` on this machine, but there is no release signing identity configured in the repo, so current bundle outputs are unsigned.

For a signed production-ready distribution path, the release pipeline must execute the following steps:

1. **Obtain a Code-Signing Certificate**:
   - For public consumer distribution: Acquire a commercial **Extended Validation (EV) Code Signing Certificate** from an authorized Certificate Authority (CA) like DigiCert, Sectigo, or GlobalSign.
   - For private or testing distribution: Generate a local self-signed certificate using PowerShell (elevated):
     ```powershell
     New-SelfSignedCertificate -Type CodeSigning -Subject "CN=CrossBridge Testing" -KeyUsage DigitalSignature -FriendlyName "CrossBridge Tester Cert" -NotAfter (Get-Date).AddYears(5)
     ```
2. **Execute Code-Signing via Windows SDK SignTool**:
   The installer packages and the native raw executable must be signed using `signtool.exe` (found in the Windows SDK bin folder, e.g., `C:\Program Files (x86)\Windows Kits\10\bin\<version>\x64\signtool.exe`):
   ```cmd
   signtool sign /f "C:\path\to\crossbridge-signing.pfx" /p "SecurePassword" /tr http://timestamp.digicert.com /td sha256 /fd sha256 "apps\windows\src-tauri\target\x86_64-pc-windows-msvc\release\bundle\nsis\CrossBridge_0.1.0_x64-setup.exe"
   ```
   * **Parameters**:
     - `/f`: Path to the `.pfx` certificate file.
     - `/p`: Decryption password for the PFX container.
     - `/tr`: URL of the RFC 3161 compliant Time Stamping Authority (TSA) to ensure the signature remains valid after the certificate expires.
     - `/td sha256`: Specifies SHA-256 as the digest algorithm for the RFC 3161 timestamp signature.
     - `/fd sha256`: Specifies SHA-256 as the file signature digest algorithm (required for Windows 10/11 compliance).

3. **Configure Tauri to Auto-Sign (Optional)**:
   You can configure Tauri to automatically sign the `.msi` and `.exe` bundles during `tauri build` by setting environment variables in your build runner:
   - `SIGNTOOL_PATH`: Path to `signtool.exe`
   - `SIGNTOOL_KEYPATH`: Path to your `.pfx` certificate
   - `SIGNTOOL_PASSWORD`: Password for your certificate

---

### Honest runtime limitation & Security Compliance

Unsigned Tauri builds may be blocked at launch time by:
- **Windows Defender Application Control (WDAC)**
- **AppLocker**
- **SmartScreen Reputation Warnings** (triggers the "Windows protected your PC" prompt)
- **Enterprise Unsigned Application Policies**

#### Technical Constraints:
- WDAC and AppLocker are kernel-level security features designed to enforce application whitelisting. On locked-down or enterprise-managed devices, execution of unsigned code is immediately halted with access denied errors.
- **AppLocker Log Inspection**: Blocks are logged in the Windows Event Viewer under:
  `Applications and Services Logs -> Microsoft -> Windows -> AppLocker -> EXE and DLL`.
- **Policy Compliance**: CrossBridge **does not** attempt to bypass, disable, or subvert Windows security policies. Attempting to bypass Windows Defender, WDAC, or SmartScreen is a violation of operating system security integrity.
- **Whitelisting & Sideloading for Testers**:
  - To test unsigned builds on systems with SmartScreen enabled, click `More Info` -> `Run anyway`.
  - To test on WDAC/AppLocker systems, the self-signed certificate used to sign the build must be imported into the **Trusted Root Certification Authorities** and **Trusted Publishers** certificate stores on the test machine:
    ```cmd
    # Run as Administrator
    certutil -addstore Root "C:\path\to\crossbridge-test.cer"
    certutil -addstore TrustedPublisher "C:\path\to\crossbridge-test.cer"
    ```
  - Without a valid signature (commercial or trusted local self-signed), the native tray and auto-start capabilities cannot be honestly verified on locked-down hosts.

---

## Android Release Reality

### Current Android artifact

`npm run android:build` produces a debug APK that is practical for local tester installs.

---

### Debug vs Release Build Audit

Before deploying CrossBridge to real-world end users or submitting to Google Play, the differences between debug and release builds must be strictly enforced:

| Characteristic | Debug Build (`assembleDebug`) | Release Build (`assembleRelease` / `bundleRelease`) |
| :--- | :--- | :--- |
| **Signing Key** | Auto-signed with standard local `debug.keystore` | Must be signed with a secure, private Production Keystore |
| **Debuggable** | `debuggable = true` (allows attaches/inspectors) | `debuggable = false` (compiler optimization, strict security) |
| **Minification & Shrinking** | Disabled | **R8 & ProGuard enabled** (shrinks code, strips unused classes, obfuscates names) |
| **Performance Overhead** | Heavy logging, JIT profiling active | Highly optimized AOT compiler output, fast execution |
| **Target Distribution** | Local emulator / USB debug sideloading | Direct OTA tester download / Google Play Store upload |

---

### Android Release Keystore & Signing Workflow

To prepare the Android app for release, follow these exact production steps:

#### Step 1: Generate a Secure Production Keystore
Generate a private release keystore using Java's `keytool` utility. Do **not** commit this keystore file to public version control:
```bash
keytool -genkey -v -keystore crossbridge-release.keystore -alias crossbridge-key -keyalg RSA -keysize 2048 -validity 10000
```
* **Parameters**:
  - `-keystore`: Name of the output keystore file (e.g., `crossbridge-release.keystore`).
  - `-alias`: Unique name for the key entry (e.g., `crossbridge-key`).
  - `-keyalg RSA`: Uses the RSA cryptographic algorithm.
  - `-keysize 2048`: Secures the key with 2048-bit length.
  - `-validity 10000`: Validity period of the key in days (approx 27 years, required for Google Play).

#### Step 2: Configure Gradle Signing Configs Securely
To prevent exposing private credentials in version control, inject the keystore configuration via environment variables or a local unindexed configuration file (`keystore.properties` added to `.gitignore`).

Update `apps/android/app/build.gradle.kts` with the following production signing configuration structure:

```kotlin
// In apps/android/app/build.gradle.kts

android {
    ...
    signingConfigs {
        create("release") {
            // Read credentials securely from environment variables
            val keystorePath = System.getenv("CROSSBRIDGE_RELEASE_KEYSTORE_PATH")
            val keystorePassword = System.getenv("CROSSBRIDGE_RELEASE_KEYSTORE_PASSWORD")
            val keyAlias = System.getenv("CROSSBRIDGE_RELEASE_KEY_ALIAS")
            val keyPassword = System.getenv("CROSSBRIDGE_RELEASE_KEY_PASSWORD")

            if (!keystorePath.isNullOrEmpty() && 
                !keystorePassword.isNullOrEmpty() && 
                !keyAlias.isNullOrEmpty() && 
                !keyPassword.isNullOrEmpty()) {
                
                storeFile = file(keystorePath)
                storePassword = keystorePassword
                this.keyAlias = keyAlias
                this.keyPassword = keyPassword
            } else {
                // Fallback to debug signing if release credentials are not provided
                // This prevents build compile crashes in dev environments
                storeFile = file(System.getProperty("user.home") + "/.android/debug.keystore")
                storePassword = "android"
                this.keyAlias = "androiddebugkey"
                this.keyPassword = "android"
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
        debug {
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}
```

#### Step 3: Run Android Release Compilation Commands
- **Assemble Release APK (Tester Sideload / OTA)**:
  Produces a standalone, optimized installer APK:
  ```bash
  cd apps/android
  ./gradlew :app:assembleRelease
  # Output path: apps/android/app/build/outputs/apk/release/app-release.apk
  ```
- **Generate Android App Bundle (AAB - Play Store Submission)**:
  Produces the standard App Bundle required for play store indexing:
  ```bash
  cd apps/android
  ./gradlew :app:bundleRelease
  # Output path: apps/android/app/build/outputs/bundle/release/app-release.aab
  ```

---

### Android Permissions & Security Controls
* **Camera Access**: Used exclusively for pairing QR code scanning. Request is triggered dynamically only when scanning starts.
* **Notification Access Service**: Configured through `NotificationListenerService` in `AndroidManifest.xml`. Requires manual permission activation in the Android "Notification Access" system settings.
* **Storage Isolation**: CrossBridge uses scoped storage intent routing for Android share sheets (`SEND` and `SEND_MULTIPLE`). It **does not** require broad, risky external storage read/write permissions. Files are securely received and stored under isolated application directories.

## Relay Status

### Local relay

The local relay in this repo is ready for tester flows and developer verification.

### Hosted relay

There is no bundled hosted relay environment, hosted deployment recipe, or public release relay URL shipped with this repo today.

You can point the apps at a separately hosted compatible relay, but hosted relay operations remain a release blocker until ownership, deployment, TLS, logging policy, uptime, and abuse controls are defined.

## Recommended Verification Commands

Required command checks:

```bash
npm run check
npm run android:doctor
npm run android:test
npm run android:build
npx tsx scripts\e2e-verify.ts
npm run windows:build
npm run tauri:build -w @crossbridge/windows
npm run windows:package:check
```

Optional convenience wrappers:

```bash
npm run verify:e2e
npm run verify:full
```

`npm run verify:e2e` starts a local relay for the verifier automatically, then stops it when the verifier finishes.

## Remaining Release Blockers

- Windows installer signing and trusted execution on restricted Windows machines.
- Repairing or provisioning a clean Windows MSVC packaging environment where Visual Studio C++ workload files are complete.
- Honest validation of native tray behavior on unrestricted or signed Windows builds.
- Android release signing and distribution.
- Hosted relay ownership and deployment.
- Finalized always-on background behavior expectations on Android.
- Installer-grade, non-terminal setup for end users who should not run local relay commands themselves.

## Next Milestone

The strongest next milestone is:

1. Produce a signed Windows native build that can be launched and tray-tested on policy-restricted machines.
2. Produce a signed Android release artifact.
3. Stand up a hosted relay with a stable `wss://` URL and documented operations.
4. Replace the remaining tester-only local setup steps with installer or first-run setup flows.
