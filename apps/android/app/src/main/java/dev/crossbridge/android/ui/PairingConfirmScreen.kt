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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.crossbridge.android.network.PairingState
import dev.crossbridge.android.network.PairingViewState
import dev.crossbridge.android.ui.components.PairingStatusCard
import java.text.DateFormat
import java.util.Date

@Composable
fun PairingConfirmScreen(
    viewState: PairingViewState,
    onConfirm: () -> Unit,
    onBack: () -> Unit,
    onTrustedDevices: () -> Unit
) {
    val windowsName = viewState.pcIdentity?.deviceName
        ?: viewState.qrPayload?.pcDeviceName
        ?: "Windows PC"

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        Text(
            text = "Confirm pairing",
            style = MaterialTheme.typography.headlineSmall
        )

        PairingStatusCard(viewState = viewState)

        DetailRow(label = "Windows device", value = windowsName)
        DetailRow(
            label = "Relay",
            value = if (viewState.relayConnected) "Connected" else "Not connected"
        )
        viewState.expiresAt?.let { expiresAt ->
            DetailRow(label = "Expires", value = formatTime(expiresAt))
        }

        Text(
            text = viewState.verificationCode ?: "------",
            style = MaterialTheme.typography.displayMedium,
            fontWeight = FontWeight.Bold
        )
        Text(
            text = "Compare this code with Windows before you confirm pairing.",
            style = MaterialTheme.typography.bodyMedium
        )

        if (viewState.error != null) {
            Text(
                text = viewState.error,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyMedium
            )
        }

        if (viewState.state == PairingState.COMPLETE) {
            Text(
                text = "Pairing complete",
                style = MaterialTheme.typography.titleMedium
            )
            Button(
                modifier = Modifier.fillMaxWidth(),
                onClick = onTrustedDevices
            ) {
                Text("Trusted devices")
            }
        } else {
            Button(
                modifier = Modifier.fillMaxWidth(),
                onClick = onConfirm,
                enabled = viewState.state == PairingState.VERIFICATION_READY
            ) {
                Text("Confirm pairing")
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
private fun DetailRow(label: String, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelLarge
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodyLarge
        )
    }
}

private fun formatTime(timestamp: Long): String {
    return DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(timestamp))
}
