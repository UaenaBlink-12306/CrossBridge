package dev.crossbridge.android.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.crossbridge.android.network.TrustedDeviceConnection
import java.text.DateFormat
import java.util.Date

@Composable
fun TrustedDeviceCard(
    connection: TrustedDeviceConnection,
    onReconnect: () -> Unit,
    onRemove: () -> Unit
) {
    val device = connection.device
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        tonalElevation = 1.dp
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                text = device.deviceName,
                style = MaterialTheme.typography.titleMedium
            )
            Text(text = "Platform: ${device.platform}", style = MaterialTheme.typography.bodyMedium)
            Text(text = "Device ID: ${device.deviceId}", style = MaterialTheme.typography.bodyMedium)
            Text(text = "Paired: ${formatTime(device.pairedAt)}", style = MaterialTheme.typography.bodyMedium)
            Text(
                text = if (connection.online) "Status: online" else "Status: offline",
                style = MaterialTheme.typography.bodyMedium
            )
            connection.lastSeenAt?.let {
                Text(text = "Last seen: ${formatTime(it)}", style = MaterialTheme.typography.bodyMedium)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onReconnect) {
                    Text("Reconnect")
                }
                OutlinedButton(onClick = onRemove) {
                    Text("Remove")
                }
            }
        }
    }
}

private fun formatTime(timestamp: Long): String {
    return DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)
        .format(Date(timestamp))
}
