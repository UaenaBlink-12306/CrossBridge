package dev.crossbridge.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import dev.crossbridge.android.network.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TransfersScreen(
    connectionState: ConnectionViewState,
    onSendFileOffer: (String, String, String, ByteArray) -> Unit,
    onAcceptFileOffer: (String) -> Unit,
    onRejectFileOffer: (String, String) -> Unit,
    onCancelFileTransfer: (String) -> Unit,
    onBack: () -> Unit
) {
    val pcDevices = connectionState.trustedDevices
        .filter { it.device.platform == "windows" }
    var selectedDeviceId by remember { mutableStateOf("") }

    // State for mock file composer
    var customFileName by remember { mutableStateOf("notes.txt") }
    var customFileSizeKb by remember { mutableStateOf("10") }
    var customMimeType by remember { mutableStateOf("text/plain") }

    LaunchedEffect(pcDevices, selectedDeviceId) {
        if (pcDevices.isEmpty()) {
            selectedDeviceId = ""
            return@LaunchedEffect
        }
        if (pcDevices.any { it.device.deviceId == selectedDeviceId }) return@LaunchedEffect

        val onlineDevice = pcDevices.firstOrNull { it.online }
        selectedDeviceId = (onlineDevice ?: pcDevices.first()).device.deviceId
    }

    val selectedDevice = pcDevices.firstOrNull { it.device.deviceId == selectedDeviceId }
    val isOnline = selectedDevice?.online == true
    val isConnected = connectionState.relayConnectionState == RelayConnectionState.CONNECTED

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp)
    ) {
        Text(
            text = "File Transfers",
            style = MaterialTheme.typography.headlineSmall
        )

        // File Composer Section
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = MaterialTheme.shapes.medium,
            tonalElevation = 1.dp
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text(text = "Send File", style = MaterialTheme.typography.titleMedium)

                // Device selector
                Text(text = "Select trusted PC:", style = MaterialTheme.typography.labelMedium)
                pcDevices.forEach { pc ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        RadioButton(
                            selected = selectedDeviceId == pc.device.deviceId,
                            onClick = { selectedDeviceId = pc.device.deviceId }
                        )
                        Text(
                            text = "${pc.device.deviceName} (${if (pc.online) "online" else "offline"})",
                            modifier = Modifier.padding(start = 8.dp)
                        )
                    }
                }

                if (pcDevices.isEmpty()) {
                    Text(text = "No trusted PC paired yet.", color = Color.Gray)
                }

                // Preset pickers
                Text(text = "File Presets:", style = MaterialTheme.typography.labelMedium)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedButton(
                        onClick = {
                            customFileName = "notes.txt"
                            customFileSizeKb = "10"
                            customMimeType = "text/plain"
                        },
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("notes.txt (10K)")
                    }
                    OutlinedButton(
                        onClick = {
                            customFileName = "setup.exe"
                            customFileSizeKb = "256"
                            customMimeType = "application/octet-stream"
                        },
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("setup.exe (Risky!)")
                    }
                }

                // Inputs
                OutlinedTextField(
                    value = customFileName,
                    onValueChange = { customFileName = it },
                    label = { Text("File Name") },
                    modifier = Modifier.fillMaxWidth()
                )

                OutlinedTextField(
                    value = customFileSizeKb,
                    onValueChange = { customFileSizeKb = it },
                    label = { Text("File Size (KB)") },
                    modifier = Modifier.fillMaxWidth()
                )

                val enableSend = selectedDeviceId.isNotEmpty() && isOnline && isConnected && customFileName.isNotBlank()

                Button(
                    onClick = {
                        val sizeKb = customFileSizeKb.toLongOrNull() ?: 10L
                        val content = ByteArray((sizeKb * 1024).toInt()) { 0 }
                        onSendFileOffer(selectedDeviceId, customFileName, customMimeType, content)
                    },
                    enabled = enableSend,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Send File to PC")
                }

                if (selectedDeviceId.isNotEmpty() && !isOnline) {
                    Text(
                        text = "Target PC is offline.",
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }
        }

        // Active/Past Transfers List
        Text(text = "Transfers History", style = MaterialTheme.typography.titleMedium)

        if (connectionState.transfers.isEmpty()) {
            Text(text = "No transfers yet.", color = Color.Gray)
        } else {
            connectionState.transfers.forEach { transfer ->
                val isIncoming = transfer.direction == "WINDOWS_TO_ANDROID"
                val peerDevice = pcDevices.firstOrNull { it.device.deviceId == transfer.peerDeviceId }
                val peerName = peerDevice?.device?.deviceName ?: "Windows PC"

                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = MaterialTheme.shapes.medium,
                    tonalElevation = 1.dp
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(
                                text = if (isIncoming) "Incoming from $peerName" else "Outgoing to $peerName",
                                style = MaterialTheme.typography.titleSmall
                            )
                            Text(
                                text = "${transfer.fileSize / 1024} KB",
                                style = MaterialTheme.typography.bodySmall,
                                color = Color.Gray
                            )
                        }

                        Text(
                            text = transfer.fileName,
                            style = MaterialTheme.typography.bodyLarge
                        )

                        // Render based on status
                        when (transfer.status) {
                            FileTransferStatus.OFFERED -> {
                                if (isIncoming) {
                                    transfer.riskyWarning?.let { warning ->
                                        Surface(
                                            color = MaterialTheme.colorScheme.errorContainer,
                                            shape = MaterialTheme.shapes.small,
                                            modifier = Modifier.fillMaxWidth()
                                        ) {
                                            Text(
                                                text = warning,
                                                color = MaterialTheme.colorScheme.onErrorContainer,
                                                style = MaterialTheme.typography.bodySmall,
                                                modifier = Modifier.padding(8.dp)
                                            )
                                        }
                                    }

                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                                    ) {
                                        Button(
                                            onClick = { onAcceptFileOffer(transfer.transferId) },
                                            modifier = Modifier.weight(1f)
                                        ) {
                                            Text("Accept")
                                        }
                                        OutlinedButton(
                                            onClick = { onRejectFileOffer(transfer.transferId, "User rejected") },
                                            modifier = Modifier.weight(1f)
                                        ) {
                                            Text("Reject")
                                        }
                                    }
                                } else {
                                    Text(
                                        text = "Waiting for recipient to accept...",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = Color.Gray
                                    )
                                }
                            }

                            FileTransferStatus.TRANSFERRING, FileTransferStatus.ACCEPTED -> {
                                Column(
                                    modifier = Modifier.fillMaxWidth(),
                                    verticalArrangement = Arrangement.spacedBy(4.dp)
                                ) {
                                    LinearProgressIndicator(
                                        progress = { transfer.progress / 100f },
                                        modifier = Modifier.fillMaxWidth()
                                    )
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Text(
                                            text = "${transfer.progress}% (${transfer.bytesTransferred / 1024} KB sent)",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = Color.Gray
                                        )
                                        OutlinedButton(
                                            onClick = { onCancelFileTransfer(transfer.transferId) },
                                            modifier = Modifier.height(28.dp)
                                        ) {
                                            Text("Cancel", style = MaterialTheme.typography.labelSmall)
                                        }
                                    }
                                }
                            }

                            FileTransferStatus.COMPLETED -> {
                                Text(
                                    text = "Completed successfully!",
                                    color = Color(0xFF2E7D32),
                                    style = MaterialTheme.typography.bodyMedium
                                )
                                transfer.savedPath?.let {
                                    Text(
                                        text = "Saved to: $it",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = Color.Gray
                                    )
                                }
                            }

                            FileTransferStatus.REJECTED -> {
                                Text(
                                    text = "Rejected: ${transfer.error ?: "Recipient declined"}",
                                    color = MaterialTheme.colorScheme.error,
                                    style = MaterialTheme.typography.bodyMedium
                                )
                            }

                            FileTransferStatus.FAILED -> {
                                Text(
                                    text = "Failed: ${transfer.error ?: "Unknown error"}",
                                    color = MaterialTheme.colorScheme.error,
                                    style = MaterialTheme.typography.bodyMedium
                                )
                            }

                            FileTransferStatus.CANCELLED -> {
                                Text(
                                    text = "Cancelled: ${transfer.error ?: "Transfer aborted"}",
                                    color = Color.Gray,
                                    style = MaterialTheme.typography.bodyMedium
                                )
                            }
                        }
                    }
                }
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
