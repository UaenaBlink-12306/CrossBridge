package dev.crossbridge.android

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import dev.crossbridge.android.ui.CrossBridgeApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class SharedFile(
    val uri: String,
    val name: String,
    val mimeType: String,
    val size: Long,
    val bytes: ByteArray
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false
        other as SharedFile
        if (uri != other.uri) return false
        if (name != other.name) return false
        if (mimeType != other.mimeType) return false
        if (size != other.size) return false
        if (!bytes.contentEquals(other.bytes)) return false
        return true
    }

    override fun hashCode(): Int {
        var result = uri.hashCode()
        result = 31 * result + name.hashCode()
        result = 31 * result + mimeType.hashCode()
        result = 31 * result + size.hashCode()
        result = 31 * result + bytes.contentHashCode()
        return result
    }
}

sealed class IncomingShare {
    data class Text(val text: String) : IncomingShare()
    data class File(val file: SharedFile) : IncomingShare()
    data class MultipleFiles(val files: List<SharedFile>) : IncomingShare()
}

class MainActivity : ComponentActivity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val activeIncomingShare = mutableStateOf<IncomingShare?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        (application as? CrossBridgeApplication)?.connectionManager?.start()
        handleIntent(intent)

        setContent {
            CrossBridgeApp(activeIncomingShare)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
    }

    private fun handleIntent(intent: Intent?) {
        if (intent == null) return
        val action = intent.action
        val type = intent.type

        if (Intent.ACTION_SEND == action && type != null) {
            val streamUri = if (intent.hasExtra(Intent.EXTRA_STREAM)) {
                intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri
            } else null

            if (streamUri != null) {
                scope.launch(Dispatchers.IO) {
                    getSharedFileFromUri(this@MainActivity, streamUri)?.let { sharedFile ->
                        withContext(Dispatchers.Main) {
                            activeIncomingShare.value = IncomingShare.File(sharedFile)
                        }
                    }
                }
            } else {
                val text = intent.getStringExtra(Intent.EXTRA_TEXT)
                    ?: intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
                if (text != null) {
                    activeIncomingShare.value = IncomingShare.Text(text)
                }
            }
        } else if (Intent.ACTION_SEND_MULTIPLE == action && type != null) {
            val uris = intent.getParcelableArrayListExtra<android.os.Parcelable>(Intent.EXTRA_STREAM)
                ?.mapNotNull { it as? Uri }
            if (uris != null) {
                scope.launch(Dispatchers.IO) {
                    val sharedFiles = uris.mapNotNull { getSharedFileFromUri(this@MainActivity, it) }
                    if (sharedFiles.isNotEmpty()) {
                        withContext(Dispatchers.Main) {
                            activeIncomingShare.value = IncomingShare.MultipleFiles(sharedFiles)
                        }
                    }
                }
            }
        }
    }

    private fun getSharedFileFromUri(context: Context, uri: Uri): SharedFile? {
        val contentResolver = context.contentResolver
        var name = "shared_file"
        var size = 0L

        try {
            contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (cursor.moveToFirst()) {
                    if (nameIndex != -1) {
                        name = cursor.getString(nameIndex) ?: name
                    }
                    if (sizeIndex != -1) {
                        size = cursor.getLong(sizeIndex)
                    }
                }
            }
        } catch (_: Exception) {}

        val mimeType = contentResolver.getType(uri) ?: "application/octet-stream"

        val bytes = try {
            contentResolver.openInputStream(uri)?.use { inputStream ->
                inputStream.readBytes()
            }
        } catch (_: Exception) {
            null
        } ?: return null

        if (size == 0L) {
            size = bytes.size.toLong()
        }

        return SharedFile(
            uri = uri.toString(),
            name = name,
            mimeType = mimeType,
            size = size,
            bytes = bytes
        )
    }
}
