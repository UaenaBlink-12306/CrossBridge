package dev.crossbridge.android.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.crossbridge.android.IncomingShare
import dev.crossbridge.android.SharedFile
import dev.crossbridge.android.network.ConnectionViewState
import dev.crossbridge.android.network.RelayConnectionState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun IncomingShareDialog(
    incomingShare: IncomingShare,
    connectionState: ConnectionViewState,
    onSend: (targetDeviceId: String) -> Unit,
    onDismiss: () -> Unit
) {
    val windowsDevices = connectionState.trustedDevices
        .filter { it.device.platform == "windows" }
    
    var selectedDeviceId by remember { mutableStateOf("") }

    // Auto-select first online device, or fallback to first device
    LaunchedEffect(windowsDevices, selectedDeviceId) {
        if (windowsDevices.isEmpty()) {
            selectedDeviceId = ""
            return@LaunchedEffect
        }
        if (windowsDevices.any { it.device.deviceId == selectedDeviceId }) return@LaunchedEffect

        val onlineDevice = windowsDevices.firstOrNull { it.online }
        selectedDeviceId = (onlineDevice ?: windowsDevices.first()).device.deviceId
    }

    val selectedDevice = windowsDevices.firstOrNull { it.device.deviceId == selectedDeviceId }
    val isOnline = selectedDevice?.online == true
    val isConnected = connectionState.relayConnectionState == RelayConnectionState.CONNECTED
    val anyOnlineDeviceExists = windowsDevices.any { it.online }

    AlertDialog(
        onDismissRequest = onDismiss,
        properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false),
        modifier = Modifier
            .fillMaxWidth()
            .padding(24.dp)
            .background(MaterialTheme.colorScheme.surface, shape = MaterialTheme.shapes.extraLarge),
        content = {
            Surface(
                shape = MaterialTheme.shapes.extraLarge,
                color = MaterialTheme.colorScheme.surface,
                tonalElevation = 6.dp,
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(0.dp)
                ) {
                    // Header with vibrant premium gradient
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(
                                Brush.horizontalGradient(
                                    listOf(
                                        Color(0xFF3F51B5),
                                        Color(0xFF00BCD4)
                                    )
                                )
                            )
                            .padding(horizontal = 24.dp, vertical = 20.dp)
                    ) {
                        Text(
                            text = "Share to Windows",
                            style = MaterialTheme.typography.titleLarge,
                            color = Color.White,
                            fontWeight = FontWeight.Bold
                        )
                    }

                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .verticalScroll(rememberScrollState())
                            .padding(24.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        // Section 1: Shared Content Details
                        Text(
                            text = "Content Preview",
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.primary,
                            fontWeight = FontWeight.SemiBold
                        )

                        Surface(
                            shape = MaterialTheme.shapes.medium,
                            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(16.dp)
                            ) {
                                when (incomingShare) {
                                    is IncomingShare.Text -> {
                                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                            Text(
                                                text = "Shared Text / Link",
                                                style = MaterialTheme.typography.titleSmall,
                                                fontWeight = FontWeight.Bold
                                            )
                                            Text(
                                                text = incomingShare.text,
                                                style = MaterialTheme.typography.bodyMedium,
                                                maxLines = 4,
                                                overflow = TextOverflow.Ellipsis
                                            )
                                        }
                                    }

                                    is IncomingShare.File -> {
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                                        ) {
                                            Text(text = "📄", style = MaterialTheme.typography.headlineMedium)
                                            Column {
                                                Text(
                                                    text = incomingShare.file.name,
                                                    style = MaterialTheme.typography.titleSmall,
                                                    fontWeight = FontWeight.Bold,
                                                    maxLines = 1,
                                                    overflow = TextOverflow.Ellipsis
                                                )
                                                Text(
                                                    text = "${incomingShare.file.size / 1024} KB • ${incomingShare.file.mimeType}",
                                                    style = MaterialTheme.typography.bodySmall,
                                                    color = Color.Gray
                                                )
                                            }
                                        }
                                    }

                                    is IncomingShare.MultipleFiles -> {
                                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                            Row(
                                                verticalAlignment = Alignment.CenterVertically,
                                                horizontalArrangement = Arrangement.spacedBy(12.dp)
                                            ) {
                                                Text(text = "📂", style = MaterialTheme.typography.headlineMedium)
                                                Column {
                                                    Text(
                                                        text = "${incomingShare.files.size} Files Selected",
                                                        style = MaterialTheme.typography.titleSmall,
                                                        fontWeight = FontWeight.Bold
                                                    )
                                                    Text(
                                                        text = "Total: ${incomingShare.files.sumOf { it.size } / 1024} KB",
                                                        style = MaterialTheme.typography.bodySmall,
                                                        color = Color.Gray
                                                    )
                                                }
                                            }
                                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                                            Column(
                                                verticalArrangement = Arrangement.spacedBy(4.dp),
                                                modifier = Modifier.heightIn(max = 120.dp).verticalScroll(rememberScrollState())
                                            ) {
                                                incomingShare.files.forEach { file ->
                                                    Row(
                                                        modifier = Modifier.fillMaxWidth(),
                                                        horizontalArrangement = Arrangement.SpaceBetween
                                                    ) {
                                                        Text(
                                                            text = file.name,
                                                            style = MaterialTheme.typography.bodySmall,
                                                            maxLines = 1,
                                                            overflow = TextOverflow.Ellipsis,
                                                            modifier = Modifier.weight(1f)
                                                        )
                                                        Text(
                                                            text = "${file.size / 1024} KB",
                                                            style = MaterialTheme.typography.bodySmall,
                                                            color = Color.Gray,
                                                            modifier = Modifier.padding(start = 8.dp)
                                                        )
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // Section 2: Device Selection
                        Text(
                            text = "Select Target Device",
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.primary,
                            fontWeight = FontWeight.SemiBold
                        )

                        if (windowsDevices.isEmpty()) {
                            Surface(
                                shape = MaterialTheme.shapes.medium,
                                color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.2f),
                                border = BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.3f)),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(
                                    text = "No trusted Windows devices found. Please pair a PC first.",
                                    color = MaterialTheme.colorScheme.error,
                                    style = MaterialTheme.typography.bodyMedium,
                                    modifier = Modifier.padding(16.dp)
                                )
                            }
                        } else {
                            Column(
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                windowsDevices.forEach { deviceEntry ->
                                    val isSelected = selectedDeviceId == deviceEntry.device.deviceId
                                    Surface(
                                        shape = MaterialTheme.shapes.medium,
                                        color = if (isSelected) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f) else Color.Transparent,
                                        border = BorderStroke(
                                            width = 1.dp,
                                            color = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant
                                        ),
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clickable { selectedDeviceId = deviceEntry.device.deviceId }
                                    ) {
                                        Row(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .padding(12.dp),
                                            verticalAlignment = Alignment.CenterVertically
                                        ) {
                                            RadioButton(
                                                selected = isSelected,
                                                onClick = { selectedDeviceId = deviceEntry.device.deviceId }
                                            )
                                            Column(
                                                modifier = Modifier
                                                    .weight(1f)
                                                    .padding(start = 8.dp)
                                            ) {
                                                Text(
                                                    text = deviceEntry.device.deviceName,
                                                    style = MaterialTheme.typography.bodyMedium,
                                                    fontWeight = FontWeight.SemiBold
                                                )
                                                Row(
                                                    verticalAlignment = Alignment.CenterVertically,
                                                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                                                ) {
                                                    Box(
                                                        modifier = Modifier
                                                            .size(8.dp)
                                                            .background(
                                                                color = if (deviceEntry.online) Color(0xFF2E7D32) else Color.Gray,
                                                                shape = RoundedCornerShape(50)
                                                            )
                                                    )
                                                    Text(
                                                        text = if (deviceEntry.online) "Online" else "Offline",
                                                        style = MaterialTheme.typography.bodySmall,
                                                        color = if (deviceEntry.online) Color(0xFF2E7D32) else Color.Gray
                                                    )
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // Clear Error or Status Banner
                        if (windowsDevices.isNotEmpty() && !anyOnlineDeviceExists) {
                            Surface(
                                shape = MaterialTheme.shapes.medium,
                                color = MaterialTheme.colorScheme.errorContainer,
                                border = BorderStroke(1.dp, MaterialTheme.colorScheme.onErrorContainer.copy(alpha = 0.2f)),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Row(
                                    modifier = Modifier.padding(12.dp),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(text = "⚠️", style = MaterialTheme.typography.titleMedium)
                                    Text(
                                        text = "No trusted online Windows devices. Please make sure the CrossBridge app is open and running on your computer.",
                                        color = MaterialTheme.colorScheme.onErrorContainer,
                                        style = MaterialTheme.typography.bodySmall
                                    )
                                }
                            }
                        } else if (selectedDevice != null && !isOnline) {
                            Surface(
                                shape = MaterialTheme.shapes.medium,
                                color = MaterialTheme.colorScheme.errorContainer,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(
                                    text = "Selected device is offline.",
                                    color = MaterialTheme.colorScheme.onErrorContainer,
                                    style = MaterialTheme.typography.bodySmall,
                                    modifier = Modifier.padding(12.dp)
                                )
                            }
                        } else if (!isConnected) {
                            Surface(
                                shape = MaterialTheme.shapes.medium,
                                color = MaterialTheme.colorScheme.errorContainer,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(
                                    text = "CrossBridge is disconnected from the relay. Please check your internet connection.",
                                    color = MaterialTheme.colorScheme.onErrorContainer,
                                    style = MaterialTheme.typography.bodySmall,
                                    modifier = Modifier.padding(12.dp)
                                )
                            }
                        }

                        // Footer Buttons
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.End,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            TextButton(onClick = onDismiss) {
                                Text("Cancel")
                            }
                            Spacer(modifier = Modifier.width(8.dp))
                            val isActionEnabled = selectedDeviceId.isNotEmpty() && isOnline && isConnected
                            Button(
                                onClick = { onSend(selectedDeviceId) },
                                enabled = isActionEnabled,
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = Color(0xFF3F51B5),
                                    contentColor = Color.White
                                )
                            ) {
                                Text("Send to PC")
                            }
                        }
                    }
                }
            }
        }
    )
}
