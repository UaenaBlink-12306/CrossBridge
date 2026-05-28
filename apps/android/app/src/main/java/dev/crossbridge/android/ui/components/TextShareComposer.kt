package dev.crossbridge.android.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.crossbridge.android.network.TrustedDeviceConnection
import dev.crossbridge.android.network.detectContentType

@Composable
fun TextShareComposer(
    devices: List<TrustedDeviceConnection>,
    selectedDeviceId: String,
    text: String,
    disabledReason: String?,
    onSelectedDeviceChange: (String) -> Unit,
    onTextChange: (String) -> Unit,
    onSend: () -> Unit,
    modifier: Modifier = Modifier
) {
    val contentType = detectContentType(text)
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        tonalElevation = 1.dp
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = "Send to Windows",
                    style = MaterialTheme.typography.titleMedium
                )
                Text(
                    text = if (contentType == "url") "URL" else "Text",
                    style = MaterialTheme.typography.labelLarge
                )
            }

            if (devices.isEmpty()) {
                Text(
                    text = "No trusted devices yet.",
                    style = MaterialTheme.typography.bodyMedium
                )
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    devices.forEach { connection ->
                        val selected = connection.device.deviceId == selectedDeviceId
                        val label = "${connection.device.deviceName} - ${if (connection.online) "online" else "offline"}"
                        if (selected) {
                            Button(
                                modifier = Modifier.fillMaxWidth(),
                                onClick = { onSelectedDeviceChange(connection.device.deviceId) }
                            ) {
                                Text(label)
                            }
                        } else {
                            OutlinedButton(
                                modifier = Modifier.fillMaxWidth(),
                                onClick = { onSelectedDeviceChange(connection.device.deviceId) }
                            ) {
                                Text(label)
                            }
                        }
                    }
                }
            }

            OutlinedTextField(
                modifier = Modifier.fillMaxWidth(),
                value = text,
                onValueChange = onTextChange,
                minLines = 4,
                maxLines = 8,
                label = { Text("Text or URL") }
            )

            disabledReason?.let {
                Text(
                    text = it,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Button(
                    onClick = onSend,
                    enabled = disabledReason == null
                ) {
                    Text("Send to Windows")
                }
                Text(
                    text = "${text.length} / 20,000",
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }
    }
}
