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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.crossbridge.android.network.TrustedDeviceConnection
import dev.crossbridge.android.ui.components.TrustedDeviceCard

@Composable
fun TrustedDevicesScreen(
    devices: List<TrustedDeviceConnection>,
    onBack: () -> Unit,
    onReconnect: () -> Unit,
    onRemoveDevice: (String) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text(
            text = "Trusted devices",
            style = MaterialTheme.typography.headlineSmall
        )

        if (devices.isEmpty()) {
            Text(
                text = "No trusted devices yet. Pair your Windows PC to begin.",
                style = MaterialTheme.typography.bodyLarge
            )
        } else {
            devices.forEach { device ->
                TrustedDeviceCard(
                    connection = device,
                    onReconnect = onReconnect,
                    onRemove = { onRemoveDevice(device.device.deviceId) }
                )
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
