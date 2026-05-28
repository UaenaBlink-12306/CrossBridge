import { describe, expect, it } from "vitest";
import { generateDevelopmentKeyPair } from "@crossbridge/crypto";
import { ErrorCode, MessageType } from "@crossbridge/protocol";
import {
  createNotificationDismissEnvelope,
  createNotificationDismissResultEnvelope,
  createNotificationPostedEnvelope,
  createNotificationReplyEnvelope,
  createNotificationRemovedEnvelope,
  decodeNotificationEnvelope
} from "./notificationClient.js";
import {
  createEmptyNotificationHistory,
  markMirroredNotificationDismissFailed,
  markMirroredNotificationDismissSending,
  markMirroredNotificationReplyFailed,
  markMirroredNotificationReplySending,
  markMirroredNotificationReplySent,
  removeMirroredNotification,
  upsertMirroredNotification
} from "./notificationStore.js";
import type { TrustedDevice } from "@crossbridge/protocol";

const pixel: TrustedDevice = {
  deviceId: "android_pixel",
  deviceName: "Pixel",
  platform: "android",
  publicKey: "android_public_key",
  pairedAt: 1_000
};

describe("notification mirror client", () => {
  it("creates and decodes notification posted envelopes", async () => {
    const android = await generateDevelopmentKeyPair();
    const pc = await generateDevelopmentKeyPair();
    const payload = {
      notificationId: "notif_1",
      packageName: "com.example",
      appName: "Example",
      title: "Hello",
      text: "Body text",
      subText: null,
      postTime: 2_000,
      canDismiss: true,
      actions: []
    };

    const envelope = await createNotificationPostedEnvelope({
      fromDeviceId: "android_xxx",
      toDeviceId: "pc_xxx",
      payload,
      now: 2_500,
      localPrivateKey: android.privateKey,
      localPublicKey: android.publicKey,
      peerPublicKey: pc.publicKey
    });

    expect(envelope.ciphertext).not.toContain("Body text");
    const decoded = await decodeNotificationEnvelope({
      envelope,
      localDeviceId: "pc_xxx",
      localPrivateKey: pc.privateKey,
      localPublicKey: pc.publicKey,
      peerPublicKey: android.publicKey
    });

    expect(decoded?.controlMessage).toEqual({
      type: MessageType.NOTIFICATION_POSTED,
      payload
    });
  });

  it("creates removed envelopes and updates bounded feed state", async () => {
    const android = await generateDevelopmentKeyPair();
    const pc = await generateDevelopmentKeyPair();
    const removed = await createNotificationRemovedEnvelope({
      fromDeviceId: "android_xxx",
      toDeviceId: "pc_xxx",
      payload: { notificationId: "notif_1" },
      now: 3_000,
      localPrivateKey: android.privateKey,
      localPublicKey: android.publicKey,
      peerPublicKey: pc.publicKey
    });
    const decoded = await decodeNotificationEnvelope({
      envelope: removed,
      localDeviceId: "pc_xxx",
      localPrivateKey: pc.privateKey,
      localPublicKey: pc.publicKey,
      peerPublicKey: android.publicKey
    });

    expect(decoded?.controlMessage).toMatchObject({
      type: MessageType.NOTIFICATION_REMOVED,
      payload: { notificationId: "notif_1" }
    });

    const history = upsertMirroredNotification(createEmptyNotificationHistory(), {
      notificationId: "notif_1",
      packageName: "com.example",
      appName: "Example",
      title: "Title",
      text: "Text",
      subText: null,
      postTime: 2_000,
      canDismiss: true,
      actions: [],
      sourceDevice: pixel,
      receivedAt: 2_100
    });
    expect(history.notifications).toHaveLength(1);
    expect(removeMirroredNotification(history, pixel.deviceId, "notif_1").notifications).toHaveLength(0);
  });

  it("creates and decodes notification dismiss request and result envelopes", async () => {
    const android = await generateDevelopmentKeyPair();
    const pc = await generateDevelopmentKeyPair();

    const dismissEnvelope = await createNotificationDismissEnvelope({
      fromDeviceId: "pc_xxx",
      toDeviceId: "android_xxx",
      payload: { notificationId: "notif_1" },
      now: 3_100,
      localPrivateKey: pc.privateKey,
      localPublicKey: pc.publicKey,
      peerPublicKey: android.publicKey
    });

    const decodedDismiss = await decodeNotificationEnvelope({
      envelope: dismissEnvelope,
      localDeviceId: "android_xxx",
      localPrivateKey: android.privateKey,
      localPublicKey: android.publicKey,
      peerPublicKey: pc.publicKey
    });

    expect(decodedDismiss?.controlMessage).toEqual({
      type: MessageType.NOTIFICATION_DISMISS,
      payload: { notificationId: "notif_1" }
    });

    const resultEnvelope = await createNotificationDismissResultEnvelope({
      fromDeviceId: "android_xxx",
      toDeviceId: "pc_xxx",
      payload: {
        notificationId: "notif_1",
        dismissed: false,
        errorCode: ErrorCode.PERMISSION_MISSING,
        message: "Notification access is not active on Android right now."
      },
      now: 3_200,
      localPrivateKey: android.privateKey,
      localPublicKey: android.publicKey,
      peerPublicKey: pc.publicKey
    });

    const decodedResult = await decodeNotificationEnvelope({
      envelope: resultEnvelope,
      localDeviceId: "pc_xxx",
      localPrivateKey: pc.privateKey,
      localPublicKey: pc.publicKey,
      peerPublicKey: android.publicKey
    });

    expect(decodedResult?.controlMessage).toEqual({
      type: MessageType.NOTIFICATION_DISMISS_RESULT,
      payload: {
        notificationId: "notif_1",
        dismissed: false,
        errorCode: ErrorCode.PERMISSION_MISSING,
        message: "Notification access is not active on Android right now."
      }
    });
  });

  it("creates and decodes notification reply request envelopes", async () => {
    const android = await generateDevelopmentKeyPair();
    const pc = await generateDevelopmentKeyPair();

    const replyEnvelope = await createNotificationReplyEnvelope({
      fromDeviceId: "pc_xxx",
      toDeviceId: "android_xxx",
      payload: {
        notificationId: "notif_1",
        actionId: "action_0",
        replyText: "On my way."
      },
      now: 3_150,
      localPrivateKey: pc.privateKey,
      localPublicKey: pc.publicKey,
      peerPublicKey: android.publicKey
    });

    const decodedReply = await decodeNotificationEnvelope({
      envelope: replyEnvelope,
      localDeviceId: "android_xxx",
      localPrivateKey: android.privateKey,
      localPublicKey: android.publicKey,
      peerPublicKey: pc.publicKey
    });

    expect(decodedReply?.controlMessage).toEqual({
      type: MessageType.NOTIFICATION_REPLY,
      payload: {
        notificationId: "notif_1",
        actionId: "action_0",
        replyText: "On my way."
      }
    });
  });

  it("tracks dismiss and reply state inside the notification feed", () => {
    const history = upsertMirroredNotification(createEmptyNotificationHistory(), {
      notificationId: "notif_1",
      packageName: "com.example",
      appName: "Example",
      title: "Title",
      text: "Text",
      subText: null,
      postTime: 2_000,
      canDismiss: true,
      actions: [
        {
          actionId: "action_0",
          title: "Reply",
          supportsRemoteInput: true
        }
      ],
      sourceDevice: pixel,
      receivedAt: 2_100
    });

    const sending = markMirroredNotificationDismissSending(history, pixel.deviceId, "notif_1");
    expect(sending.notifications[0]).toMatchObject({
      dismissState: "sending",
      dismissError: undefined
    });

    const failed = markMirroredNotificationDismissFailed(
      sending,
      pixel.deviceId,
      "notif_1",
      "Notification access is not active on Android right now."
    );
    expect(failed.notifications[0]).toMatchObject({
      dismissState: "failed",
      dismissError: "Notification access is not active on Android right now."
    });

    const replySending = markMirroredNotificationReplySending(history, pixel.deviceId, "notif_1");
    expect(replySending.notifications[0]).toMatchObject({
      replyState: "sending",
      replyStatusMessage: undefined
    });

    const replySent = markMirroredNotificationReplySent(
      replySending,
      pixel.deviceId,
      "notif_1",
      "Reply sent to Android."
    );
    expect(replySent.notifications[0]).toMatchObject({
      replyState: "sent",
      replyStatusMessage: "Reply sent to Android."
    });

    const replyFailed = markMirroredNotificationReplyFailed(
      replySent,
      pixel.deviceId,
      "notif_1",
      "Android no longer exposes a reply action for this notification."
    );
    expect(replyFailed.notifications[0]).toMatchObject({
      replyState: "failed",
      replyStatusMessage: "Android no longer exposes a reply action for this notification."
    });
  });
});
