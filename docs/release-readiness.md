# Release readiness — CrossBridge 0.2.0 beta

The beta provides a signed Android release APK and Windows Setup EXE, MSI, and portable ZIP through [GitHub Releases](https://github.com/UaenaBlink-12306/CrossBridge/releases/tag/v0.2.0). See [QUICK-START.md](QUICK-START.md). Both apps use the hosted encrypted relay without developer commands. The free hosted relay can take about a minute to wake after inactivity.

## Usable features

- QR pairing with matching six-digit confirmation on both devices.
- Trusted-device reconnect, encrypted text/link sharing, file offers, accept/reject/cancel, integrity checks, and Android share-sheet intake.
- Android file picker for real documents and photos, with a 64 MB limit for this in-memory implementation.
- Android 10+ received files in Downloads/CrossBridge; Open and Save a copy controls on completed transfers, including Android 8–9.
- Android notification mirror/reply/dismiss when notification access is enabled and the source app permits the action.
- Optional Android foreground connection service and Windows tray operation.
- Persisted Windows notification-text privacy setting and diagnostic exports based on current connection state.

## Packaging and retained signing identity

`npm run android:release` builds a release APK using a retained key under the current user's `.codex/signing/crossbridge` directory. Both release.jks and signing.json must be backed up privately to preserve update compatibility. They are outside the repository and must never be committed. GitHub Actions uses encrypted ANDROID_KEYSTORE_* / ANDROID_KEY_* repository secrets for the same signing identity. Previous tester builds may have a different signature and need uninstalling before this release.

The tag-triggered release workflow runs Windows workspaces/tests and Android unit tests, builds installers/APK/AAB, publishes installable downloads, and adds SHA-256 checksums. A workflow_dispatch run builds artifacts without publishing a release.

Windows binaries currently have no trusted Authenticode certificate. SmartScreen may show an unknown publisher; WDAC/AppLocker policies can block execution. A consumer store/trusted Windows signing release remains future work, and no OS policy bypass is included.

## Validation

Run `npm run check`, `npm run android:test`, `npm run verify:e2e`, and `npm run android:release`. Native Windows packaging runs on the GitHub Windows runner when the local Visual Studio C++ workload is incomplete. A passing workflow verifies packaging; runtime evidence should be checked separately with the actual APK and Windows executable.

## Boundaries

This is a sideloaded beta, not a Play Store/Microsoft Store release. It does not implement automatic application updates, screen mirroring, SMS, calls, or guaranteed wake after Android Force stop/reboot/battery restrictions. The Android background service is opt-in and follows the [connected-device foreground-service requirements](https://developer.android.com/develop/background-work/services/fgs/service-types#connected-device).
