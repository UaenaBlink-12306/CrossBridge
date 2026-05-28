package dev.crossbridge.replyhelper

import android.app.RemoteInput
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class ReplyReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val reply = RemoteInput.getResultsFromIntent(intent)
            ?.getCharSequence(RuntimeReplyContract.REMOTE_INPUT_KEY)
            ?.toString()
            .orEmpty()
        Log.i(RuntimeReplyContract.LOG_TAG, "RUNTIME_REPLY_RECEIVED:$reply")
    }
}
