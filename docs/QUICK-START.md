# CrossBridge 0.2.1 beta — install and pair

Download the Windows Setup EXE and Android APK from this release. No terminal, account, or local server is needed. Windows needs a 64-bit Windows 10/11 PC; Android needs Android 8 or newer. Both devices need internet access. Your VPN can stay on.

1. On Windows, run **CrossBridge-Windows-0.2.1-Setup.exe** and open CrossBridge. The MSI is an alternative installer; the portable ZIP can be extracted and run as CrossBridge.exe.
2. On Android, open **CrossBridge-Android-0.2.1.apk** and install it. Android may ask you to allow installs from the browser or file manager. This is a sideloaded beta, not a Play Store download.
3. On Windows, choose **Pair → Create pairing code**.
4. On Android, choose **Scan QR code**. Allow camera access when prompted and scan the PC screen.
5. Compare the six-digit verification code and confirm on **both** devices. Leave both apps open until the trusted device shows online.
6. Use **Share** for text/links and **Transfers** for files. On Android, tap **Choose a file** or share a file to CrossBridge from another app. Accept incoming transfers on the receiving device.

Android 10 and newer save received files to **Downloads/CrossBridge**. Android 8–9 provide **Open** and **Save a copy** on the completed transfer. Windows saves received files through its download flow. Each Android file selection is limited to 64 MB because this beta buffers transfers in memory.

For notifications, enable **Notification access and mirroring** on Android. Reply appears only for notifications whose source app supports direct reply. Windows Settings can hide mirrored message text.

For background reception, turn on **Keep connected in background** on Android. It runs an Android foreground service with a connection notification. On Windows, closing the window keeps CrossBridge in the tray; use the tray menu's **Quit** to stop it. Android Force stop, reboot, or battery restrictions may require reopening the phone app.

## Connection help

- The hosted relay is configured automatically. After inactivity its first connection can take about a minute. Leave the pairing screen open; create a fresh code if the two-minute code expires.
- If the PC shows the phone offline, open CrossBridge on the phone and use **Reconnect**.
- **Advanced connection settings** are only needed for a custom relay or development.
- If upgrading an old Android tester APK reports a signature conflict, uninstall the old tester build first. This removes its pairing, so pair again. Future 0.2.x APKs should use the same retained release key.
- Windows binaries are currently **not Authenticode signed**. Windows may warn about an unknown publisher, and managed PCs may refuse them. A trusted Windows signing certificate/store distribution is still needed for those PCs; this release does not bypass OS policy.

This beta supports encrypted text/link sharing, files, and Android notification mirroring/reply/dismiss. Screen mirroring, calls, SMS, app-store publishing, and automatic app updates are not included.
