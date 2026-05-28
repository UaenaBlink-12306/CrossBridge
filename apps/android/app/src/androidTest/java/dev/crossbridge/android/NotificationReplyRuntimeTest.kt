package dev.crossbridge.android

import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.BufferedReader
import java.io.InputStreamReader
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NotificationReplyRuntimeTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val targetContext = instrumentation.targetContext

    @Before
    fun setUp() {
        shell("pm grant ${targetContext.packageName} android.permission.POST_NOTIFICATIONS")
        shell("pm grant $HELPER_PACKAGE android.permission.POST_NOTIFICATIONS")
        shell("cmd notification allow_listener ${listenerComponentName()}")
        launchApp()
        waitForNotificationListener()
    }

    @After
    fun tearDown() {
        shell("am force-stop $HELPER_PACKAGE")
        shell("cmd notification disallow_listener ${listenerComponentName()}")
    }

    @Test
    fun replyToMirroredNotificationExecutesRemoteInputPendingIntent() {
        shell("logcat -c")
        launchHelperApp()
        val notificationKey = waitForNotificationKey()

        val result = CrossBridgeNotificationListenerService.replyToMirroredNotification(
            notificationId = notificationKey,
            actionId = "action_0",
            replyText = TEST_REPLY_TEXT
        )

        assertTrue(result.message, result.replied)
        assertEquals(notificationKey, result.notificationId)
        assertEquals("action_0", result.actionId)
        assertEquals("Reply sent on Android.", result.message)
        assertEquals(TEST_REPLY_TEXT, waitForHelperReplyLog())
    }

    private fun launchApp() {
        val launchIntent = targetContext.packageManager.getLaunchIntentForPackage(targetContext.packageName)
            ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ?: return
        targetContext.startActivity(launchIntent)
        instrumentation.waitForIdleSync()
    }

    private fun waitForNotificationListener(timeoutMs: Long = 15_000L) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (isNotificationListenerEnabled(targetContext)) {
                val probe = CrossBridgeNotificationListenerService.replyToMirroredNotification(
                    notificationId = "probe_notification",
                    actionId = "action_0",
                    replyText = "probe"
                )
                if (!probe.replied && probe.errorCode != "PERMISSION_MISSING") {
                    return
                }
            }
            Thread.sleep(250L)
        }
        throw AssertionError("CrossBridge notification listener did not become active in time.")
    }

    private fun launchHelperApp() {
        val launchIntent = Intent()
            .setClassName(HELPER_PACKAGE, "$HELPER_PACKAGE.MainActivity")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        targetContext.startActivity(launchIntent)
        instrumentation.waitForIdleSync()
    }

    private fun waitForNotificationKey(timeoutMs: Long = 10_000L): String {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val mirroredId = CrossBridgeNotificationListenerService.findMirroredNotificationId(
                packageName = HELPER_PACKAGE,
                notificationId = TEST_NOTIFICATION_ID,
                notificationTag = TEST_NOTIFICATION_TAG
            )
            if (mirroredId != null) {
                return mirroredId
            }
            Thread.sleep(200L)
        }
        throw AssertionError("Timed out waiting for the runtime reply helper notification to appear.")
    }

    private fun waitForHelperReplyLog(timeoutMs: Long = 10_000L): String {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val logs = shell("logcat -d -s ReplyHelper:I")
            val marker = "RUNTIME_REPLY_RECEIVED:"
            val match = logs.lineSequence()
                .mapNotNull { line ->
                    val index = line.indexOf(marker)
                    if (index >= 0) line.substring(index + marker.length).trim() else null
                }
                .firstOrNull()
            if (!match.isNullOrBlank()) {
                return match
            }
            Thread.sleep(250L)
        }
        throw AssertionError("Timed out waiting for the helper app to log the received reply text.")
    }

    private fun listenerComponentName(): String {
        return "${targetContext.packageName}/${CrossBridgeNotificationListenerService::class.java.name}"
    }

    private fun shell(command: String): String {
        val descriptor = instrumentation.uiAutomation.executeShellCommand(command)
        return descriptor.use { fileDescriptor ->
            BufferedReader(InputStreamReader(android.os.ParcelFileDescriptor.AutoCloseInputStream(fileDescriptor))).use {
                it.readText()
            }
        }
    }

    companion object {
        private const val HELPER_PACKAGE = "dev.crossbridge.replyhelper"
        private const val TEST_NOTIFICATION_ID = 4217
        private const val TEST_NOTIFICATION_TAG = "runtime_reply_test"
        private const val TEST_REPLY_TEXT = "Runtime reply test"
    }
}
