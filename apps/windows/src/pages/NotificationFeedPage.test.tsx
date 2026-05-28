import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NotificationFeedPage } from "./HomePage.js";
import type { ConnectionViewState } from "../services/connectionManager.js";

describe("NotificationFeedPage", () => {
  it("renders mirrored Android notification metadata", () => {
    const state: ConnectionViewState = {
      phase: "trusted_device_online",
      relayConnectionState: "connected",
      relayUrl: "ws://127.0.0.1:8787/connect",
      trustedDevices: [],
      sentShares: [],
      receivedShares: [],
      transfers: [],
      notifications: [
        {
          notificationId: "notification_1",
          packageName: "com.example.calendar",
          appName: "Calendar",
          title: "CrossBridge Runtime",
          text: "Notification mirror live check",
          subText: "Work",
          postTime: 2_000,
          canDismiss: true,
          actions: [
            {
              actionId: "action_0",
              title: "Reply",
              supportsRemoteInput: true
            }
          ],
          sourceDevice: {
            deviceId: "android_pixel",
            deviceName: "Pixel",
            platform: "android",
            publicKey: "android_public_key",
            pairedAt: 1_000
          },
          receivedAt: 2_100,
          dismissState: "failed",
          dismissError: "Notification access is not active on Android right now.",
          replyState: "sent",
          replyStatusMessage: "Reply sent to Android."
        }
      ]
    };

    const html = renderToStaticMarkup(
      <NotificationFeedPage
        connectionState={state}
        onReplyNotification={() => {}}
      />
    );

    expect(html).toContain("Notifications");
    expect(html).toContain("Calendar");
    expect(html).toContain("Pixel");
    expect(html).toContain("CrossBridge Runtime");
    expect(html).toContain("Notification mirror live check");
    expect(html).toContain("Dismiss on phone");
    expect(html).toContain("Reply available");
    expect(html).toContain("Reply from Windows");
    expect(html).toContain("Send reply");
    expect(html).toContain("Reply sent to Android.");
    expect(html).toContain("Notification access is not active on Android right now.");
    expect(html).toContain("Encrypted mirror, dismiss, and reply");
  });
});
