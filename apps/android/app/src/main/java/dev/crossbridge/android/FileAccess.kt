package dev.crossbridge.android

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import java.io.ByteArrayOutputStream

// Transfers are currently buffered in memory; bound reads before allocating them.
const val MAX_SHARED_FILE_BYTES = 64L * 1024 * 1024

fun readSharedFile(context: Context, uri: Uri): SharedFile {
    val resolver = context.contentResolver
    var name = "shared_file"
    resolver.query(uri, null, null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
            val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
            if (nameIndex >= 0) name = cursor.getString(nameIndex) ?: name
            if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) {
                require(cursor.getLong(sizeIndex) <= MAX_SHARED_FILE_BYTES) {
                    "Choose a file smaller than 64 MB."
                }
            }
        }
    }
    val bytes = resolver.openInputStream(uri)?.use { input ->
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        var total = 0L
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            total += count
            require(total <= MAX_SHARED_FILE_BYTES) { "Choose a file smaller than 64 MB." }
            output.write(buffer, 0, count)
        }
        output.toByteArray()
    } ?: error("This file could not be opened. Choose it again.")
    return SharedFile(uri.toString(), name, resolver.getType(uri) ?: "application/octet-stream", bytes.size.toLong(), bytes)
}
