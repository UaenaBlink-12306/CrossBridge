package dev.crossbridge.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.crossbridge.android.network.ConnectionViewState
import dev.crossbridge.android.network.RelayConnectionState
import dev.crossbridge.android.network.ShareSendStatus
import dev.crossbridge.android.network.TrustedDeviceConnection
import dev.crossbridge.android.ui.components.ReceivedShareCard
import dev.crossbridge.android.ui.components.TextShareComposer

@Composable
fun ShareScreen(
    connectionState: ConnectionViewState,
    onSendTextShare: (String, String) -> Unit,
    onBack: () -> Unit
) {
    val windowsDevices = connectionState.trustedDevices
        .filter { it.device.platform == "windows" }
    var selectedDeviceId by remember { mutableStateOf("") }
    var text by remember { mutableStateOf("") }

    LaunchedEffect(windowsDevices, selectedDeviceId) {
        if (windowsDevices.isEmpty()) {
            selectedDeviceId = ""
            return@LaunchedEffect
        }
        if (windowsDevices.any { it.device.deviceId == selectedDeviceId }) return@LaunchedEffect

        val onlineDevice = windowsDevices.firstOrNull { it.online }
        selectedDeviceId = (onlineDevice ?: windowsDevices.first()).device.deviceId
    }

    val reason = disabledReason(
        connectionState = connectionState,
        windowsDevices = windowsDevices,
        selectedDeviceId = selectedDeviceId,
        text = text
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text(
            text = "Share",
            style = MaterialTheme.typography.headlineSmall
        )

        TextShareComposer(
            devices = windowsDevices,
            selectedDeviceId = selectedDeviceId,
            text = text,
            disabledReason = reason,
            onSelectedDeviceChange = { selectedDeviceId = it },
            onTextChange = { text = it },
            onSend = {
                if (reason == null) {
                    onSendTextShare(selectedDeviceId, text)
                    text = ""
                }
            }
        )

        connectionState.shareError?.let {
            Text(
                text = it,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyMedium
            )
        }

        Text(
            text = "Sent",
            style = MaterialTheme.typography.titleMedium
        )
        if (connectionState.sentShares.isEmpty()) {
            Text(
                text = "No sent shares yet.",
                style = MaterialTheme.typography.bodyMedium
            )
        } else {
            connectionState.sentShares.forEach { share ->
                SentShareRow(
                    targetName = share.targetDevice.deviceName,
                    text = share.text,
                    status = share.status,
                    statusMessage = share.statusMessage
                )
            }
        }

        Text(
            text = "Received",
            style = MaterialTheme.typography.titleMedium
        )
        if (connectionState.receivedShares.isEmpty()) {
            Text(
                text = "No received shares yet.",
                style = MaterialTheme.typography.bodyMedium
            )
        } else {
            connectionState.receivedShares.forEach { share ->
                ReceivedShareCard(share = share)
            }
        }

        OutlinedButton(
            modifier = Modifier.fillMaxWidth(),
            onClick = onBack
        ) {
            Text("Back")
        }
    }
}

@Composable
private fun SentShareRow(
    targetName: String,
    text: String,
    status: ShareSendStatus,
    statusMessage: String
) {
    val statusColor = when (status) {
        ShareSendStatus.FAILED -> MaterialTheme.colorScheme.error
        ShareSendStatus.RECEIVED -> MaterialTheme.colorScheme.primary
        ShareSendStatus.SENT -> MaterialTheme.colorScheme.primary
        ShareSendStatus.SENDING -> MaterialTheme.colorScheme.onSurfaceVariant
    }

    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        tonalElevation = 1.dp
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Text(text = targetName, style = MaterialTheme.typography.titleSmall)
            Text(text = text, style = MaterialTheme.typography.bodyMedium)
            Text(
                text = statusMessage,
                color = statusColor,
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

private fun disabledReason(
    connectionState: ConnectionViewState,
    windowsDevices: List<TrustedDeviceConnection>,
    selectedDeviceId: String,
    text: String
): String? {
    val selected = windowsDevices.firstOrNull { it.device.deviceId == selectedDeviceId }
    return when {
        windowsDevices.isEmpty() -> "No trusted devices yet."
        selected == null -> "Select a trusted Windows device."
        connectionState.relayConnectionState != RelayConnectionState.CONNECTED -> "Relay is disconnected."
        !selected.online -> "Trusted device offline."
        text.trim().isEmpty() -> "Enter text or a URL."
        text.length > 20_000 -> "Text is longer than 20,000 characters."
        else -> null
    }
}
