package dev.crossbridge.android.ui.components

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import dev.crossbridge.android.network.ReceivedShare
import java.text.DateFormat
import java.util.Date

@Composable
fun ReceivedShareCard(
    share: ReceivedShare,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val isUrl = share.contentType == "url"

    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        tonalElevation = 1.dp
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = if (isUrl) "URL" else "Text",
                    style = MaterialTheme.typography.labelLarge
                )
                Text(
                    text = formatTime(share.receivedAt),
                    style = MaterialTheme.typography.bodySmall
                )
            }
            Text(
                text = share.text,
                style = MaterialTheme.typography.bodyMedium
            )
            Text(
                text = share.sourceDevice.deviceName,
                style = MaterialTheme.typography.bodySmall
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    onClick = {
                        clipboard.setText(AnnotatedString(share.text))
                    }
                ) {
                    Text("Copy")
                }
                if (isUrl) {
                    Button(
                        onClick = {
                            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(share.text.trim()))
                            runCatching { context.startActivity(intent) }
                        }
                    ) {
                        Text("Open")
                    }
                }
                OutlinedButton(
                    onClick = {
                        val intent = Intent(Intent.ACTION_SEND)
                            .setType("text/plain")
                            .putExtra(Intent.EXTRA_TEXT, share.text)
                        runCatching {
                            context.startActivity(Intent.createChooser(intent, "Share with"))
                        }
                    }
                ) {
                    Text("Share")
                }
            }
        }
    }
}

private fun formatTime(timestamp: Long): String {
    return DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)
        .format(Date(timestamp))
}
