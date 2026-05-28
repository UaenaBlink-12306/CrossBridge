package dev.crossbridge.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.crossbridge.android.protocol.PairingQrParser
import dev.crossbridge.android.protocol.PairingQrParseResult
import dev.crossbridge.android.protocol.PairingQrPayload

@Composable
fun PasteQrScreen(
    onBack: () -> Unit,
    onPayloadReady: (PairingQrPayload) -> Unit
) {
    var qrJson by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text(
            text = "Paste pairing text",
            style = MaterialTheme.typography.headlineSmall
        )
        Text(
            text = "Paste the pairing text from the Windows Pair page if you are not scanning with the camera.",
            style = MaterialTheme.typography.bodyMedium
        )
        OutlinedTextField(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 220.dp),
            value = qrJson,
            onValueChange = {
                qrJson = it
                error = null
            },
            label = { Text("Pairing text") },
            minLines = 8
        )

        if (error != null) {
            Text(
                text = error.orEmpty(),
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyMedium
            )
        }

        Button(
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                when (val result = PairingQrParser.parse(qrJson)) {
                    is PairingQrParseResult.Success -> onPayloadReady(result.payload)
                    is PairingQrParseResult.Failure -> error = result.error.message
                }
            },
            enabled = qrJson.isNotBlank()
        ) {
            Text("Join pairing")
        }
        OutlinedButton(
            modifier = Modifier.fillMaxWidth(),
            onClick = onBack
        ) {
            Text("Back")
        }
    }
}
