package dev.crossbridge.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class IncomingShareTest {

    @Test
    fun sharedFileEqualityChecksBytes() {
        val file1 = SharedFile(
            uri = "content://media/1",
            name = "photo.jpg",
            mimeType = "image/jpeg",
            size = 100L,
            bytes = byteArrayOf(1, 2, 3)
        )
        val file2 = SharedFile(
            uri = "content://media/1",
            name = "photo.jpg",
            mimeType = "image/jpeg",
            size = 100L,
            bytes = byteArrayOf(1, 2, 3)
        )
        val file3 = SharedFile(
            uri = "content://media/1",
            name = "photo.jpg",
            mimeType = "image/jpeg",
            size = 100L,
            bytes = byteArrayOf(1, 2, 4)
        )

        assertEquals(file1, file2)
        assertEquals(file1.hashCode(), file2.hashCode())
        assertNotEquals(file1, file3)
    }

    @Test
    fun incomingShareSubtypesRepresentContentCorrectly() {
        val textShare = IncomingShare.Text("Hello World")
        assertEquals("Hello World", textShare.text)

        val file = SharedFile(
            uri = "content://docs/1",
            name = "notes.txt",
            mimeType = "text/plain",
            size = 12L,
            bytes = byteArrayOf(65, 66, 67)
        )
        val fileShare = IncomingShare.File(file)
        assertEquals(file, fileShare.file)

        val multipleFilesShare = IncomingShare.MultipleFiles(listOf(file))
        assertEquals(1, multipleFilesShare.files.size)
        assertEquals(file, multipleFilesShare.files.first())
    }
}
