package dev.crossbridge.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import dev.crossbridge.android.network.ConnectionManager
import dev.crossbridge.android.network.ConnectionViewState
import dev.crossbridge.android.network.PairingClient
import dev.crossbridge.android.network.PairingState
import dev.crossbridge.android.network.PairingViewState
import dev.crossbridge.android.ui.components.ConnectionStatusCard
import dev.crossbridge.android.ui.components.PairingStatusCard
import dev.crossbridge.android.ui.components.connectionStatusText

import androidx.compose.runtime.MutableState
import dev.crossbridge.android.CrossBridgeApplication
import dev.crossbridge.android.IncomingShare
import dev.crossbridge.android.isNotificationListenerEnabled
import dev.crossbridge.android.openNotificationListenerSettings
import dev.crossbridge.android.ui.components.IncomingShareDialog

private enum class CrossBridgeScreen {
    HOME,
    SCAN_QR,
    PASTE_QR,
    PAIRING_CONFIRM,
    TRUSTED_DEVICES,
    SHARE,
    TRANSFERS,
    NOTIFICATIONS
}

@Composable
fun CrossBridgeApp(incomingShareState: MutableState<IncomingShare?> = remember { mutableStateOf(null) }) {
    val context = LocalContext.current.applicationContext
    val application = context as CrossBridgeApplication
    val pairingClient = remember { PairingClient(context) }
    val connectionManager = remember(application) { application.connectionManager }
    val viewState by pairingClient.viewState.collectAsState()
    val connectionState by connectionManager.viewState.collectAsState()
    var screen by remember { mutableStateOf(CrossBridgeScreen.HOME) }

    LaunchedEffect(Unit) {
        connectionManager.start()
    }

    LaunchedEffect(viewState.state) {
        if (viewState.state == PairingState.COMPLETE) {
            connectionManager.refreshAfterPairingComplete()
        }
    }

    DisposableEffect(pairingClient) {
        onDispose {
            pairingClient.dispose()
        }
    }

    MaterialTheme {
        incomingShareState.value?.let { incomingShare ->
            IncomingShareDialog(
                incomingShare = incomingShare,
                connectionState = connectionState,
                onDismiss = { incomingShareState.value = null },
                onSend = { targetDeviceId ->
                    when (incomingShare) {
                        is IncomingShare.Text -> {
                            connectionManager.sendTextShare(targetDeviceId, incomingShare.text)
                            screen = CrossBridgeScreen.SHARE
                        }
                        is IncomingShare.File -> {
                            connectionManager.sendFileOffer(
                                targetDeviceId,
                                incomingShare.file.name,
                                incomingShare.file.mimeType,
                                incomingShare.file.bytes
                            )
                            screen = CrossBridgeScreen.TRANSFERS
                        }
                        is IncomingShare.MultipleFiles -> {
                            incomingShare.files.forEach { file ->
                                connectionManager.sendFileOffer(
                                    targetDeviceId,
                                    file.name,
                                    file.mimeType,
                                    file.bytes
                                )
                            }
                            screen = CrossBridgeScreen.TRANSFERS
                        }
                    }
                    incomingShareState.value = null
                }
            )
        }

        Surface(
            modifier = Modifier.fillMaxSize(),
            color = MaterialTheme.colorScheme.background
        ) {
            when (screen) {
                CrossBridgeScreen.HOME -> HomeScreen(
                    viewState = viewState,
                    connectionState = connectionState,
                    onScanQr = { screen = CrossBridgeScreen.SCAN_QR },
                    onPasteQrJson = { screen = CrossBridgeScreen.PASTE_QR },
                    onTrustedDevices = { screen = CrossBridgeScreen.TRUSTED_DEVICES },
                    onShare = { screen = CrossBridgeScreen.SHARE },
                    onTransfers = { screen = CrossBridgeScreen.TRANSFERS },
                    onNotifications = { screen = CrossBridgeScreen.NOTIFICATIONS },
                    onRelayUrlChange = connectionManager::setRelayUrl,
                    onReconnect = connectionManager::reconnectNow
                )

                CrossBridgeScreen.SCAN_QR -> ScanQrScreen(
                    onBack = { screen = CrossBridgeScreen.HOME },
                    onPayloadReady = { payload ->
                        pairingClient.startPairing(payload)
                        screen = CrossBridgeScreen.PAIRING_CONFIRM
                    },
                    onPasteQrJson = { screen = CrossBridgeScreen.PASTE_QR }
                )

                CrossBridgeScreen.PASTE_QR -> PasteQrScreen(
                    onBack = { screen = CrossBridgeScreen.HOME },
                    onPayloadReady = { payload ->
                        pairingClient.startPairing(payload)
                        screen = CrossBridgeScreen.PAIRING_CONFIRM
                    }
                )

                CrossBridgeScreen.PAIRING_CONFIRM -> PairingConfirmScreen(
                    viewState = viewState,
                    onConfirm = pairingClient::confirmPairing,
                    onBack = { screen = CrossBridgeScreen.HOME },
                    onTrustedDevices = { screen = CrossBridgeScreen.TRUSTED_DEVICES }
                )

                CrossBridgeScreen.TRUSTED_DEVICES -> TrustedDevicesScreen(
                    devices = connectionState.trustedDevices,
                    onBack = { screen = CrossBridgeScreen.HOME },
                    onReconnect = connectionManager::reconnectNow,
                    onRemoveDevice = connectionManager::removeTrustedDevice
                )

                CrossBridgeScreen.SHARE -> ShareScreen(
                    connectionState = connectionState,
                    onSendTextShare = connectionManager::sendTextShare,
                    onBack = { screen = CrossBridgeScreen.HOME }
                )

                CrossBridgeScreen.TRANSFERS -> TransfersScreen(
                    connectionState = connectionState,
                    onSendFileOffer = connectionManager::sendFileOffer,
                    onAcceptFileOffer = connectionManager::acceptFileOffer,
                    onRejectFileOffer = connectionManager::rejectFileOffer,
                    onCancelFileTransfer = connectionManager::cancelFileTransfer,
                    onBack = { screen = CrossBridgeScreen.HOME }
                )

                CrossBridgeScreen.NOTIFICATIONS -> NotificationAccessScreen(
                    onBack = { screen = CrossBridgeScreen.HOME }
                )
            }
        }
    }
}

@Composable
fun HomeScreen(
    viewState: PairingViewState,
    connectionState: ConnectionViewState,
    onScanQr: () -> Unit,
    onPasteQrJson: () -> Unit,
    onTrustedDevices: () -> Unit,
    onShare: () -> Unit,
    onTransfers: () -> Unit,
    onNotifications: () -> Unit,
    onRelayUrlChange: (String) -> Unit,
    onReconnect: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        Text(
            text = "CrossBridge",
            style = MaterialTheme.typography.headlineMedium
        )
        Text(
            text = connectionStatusText(connectionState.phase),
            style = MaterialTheme.typography.titleMedium
        )
        Text(
            text = "VPN can stay on. CrossBridge sends encrypted app messages through relay mode.",
            style = MaterialTheme.typography.bodyMedium
        )

        ConnectionStatusCard(
            viewState = connectionState,
            onRelayUrlChange = onRelayUrlChange,
            onReconnect = onReconnect
        )

        PairingStatusCard(viewState = viewState)

        Button(
            modifier = Modifier.fillMaxWidth(),
            onClick = onScanQr
        ) {
            Text("Scan QR code")
        }
        OutlinedButton(
            modifier = Modifier.fillMaxWidth(),
            onClick = onPasteQrJson
        ) {
            Text("Paste pairing text")
        }
        OutlinedButton(
            modifier = Modifier.fillMaxWidth(),
            onClick = onTrustedDevices
        ) {
            Text("Trusted devices")
        }
        Button(
            modifier = Modifier.fillMaxWidth(),
            onClick = onShare
        ) {
            Text("Share text or link")
        }
        Button(
            modifier = Modifier.fillMaxWidth(),
            onClick = onTransfers
        ) {
            Text("File transfers")
        }
        OutlinedButton(
            modifier = Modifier.fillMaxWidth(),
            onClick = onNotifications
        ) {
            Text("Notification access and mirroring")
        }
    }
}

@Composable
private fun NotificationAccessScreen(
    onBack: () -> Unit
) {
    val context = LocalContext.current
    var enabled by remember { mutableStateOf(isNotificationListenerEnabled(context)) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        Text(
            text = "Notification mirroring",
            style = MaterialTheme.typography.headlineSmall
        )
        Text(
            text = if (enabled) {
                "Notification access is enabled. CrossBridge can mirror notification metadata and send dismiss or reply actions while the apps stay connected."
            } else {
                "Enable notification access for CrossBridge before mirrored notifications, dismiss, or reply from Windows can work."
            },
            style = MaterialTheme.typography.bodyMedium
        )
        Button(
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                openNotificationListenerSettings(context)
            }
        ) {
            Text(if (enabled) "Open notification access settings" else "Enable notification access")
        }
        OutlinedButton(
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                enabled = isNotificationListenerEnabled(context)
            }
        ) {
            Text("Check permission again")
        }
        OutlinedButton(
            modifier = Modifier.fillMaxWidth(),
            onClick = onBack
        ) {
            Text("Back")
        }
    }
}

private fun PairingState.summaryText(): String {
    return when (this) {
        PairingState.IDLE -> "Ready to pair through relay mode"
        PairingState.QR_SCANNED -> "Pairing code accepted"
        PairingState.CONNECTING -> "Connecting to relay"
        PairingState.JOIN_SENT -> "Joining pairing session"
        PairingState.WAITING_FOR_WINDOWS -> "Waiting for Windows"
        PairingState.VERIFICATION_READY -> "Ready to confirm verification code"
        PairingState.CONFIRMED -> "Waiting for pairing completion"
        PairingState.COMPLETE -> "Pairing complete"
        PairingState.EXPIRED -> "Pairing code expired"
        PairingState.ERROR -> "Pairing needs attention"
    }
}
