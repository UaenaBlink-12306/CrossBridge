import type { NotificationPostedPayload } from "@crossbridge/protocol";
import type { TrustedDevice } from "@crossbridge/protocol";

export type NotificationDismissState = "idle" | "sending" | "failed";
export type NotificationReplyState = "idle" | "sending" | "sent" | "failed";

export interface MirroredNotification extends NotificationPostedPayload {
  sourceDevice: TrustedDevice;
  receivedAt: number;
  dismissState: NotificationDismissState;
  dismissError?: string;
  replyState: NotificationReplyState;
  replyStatusMessage?: string;
}

export interface NotificationHistory {
  notifications: MirroredNotification[];
}

export function createEmptyNotificationHistory(): NotificationHistory {
  return {
    notifications: []
  };
}

export function upsertMirroredNotification(
  history: NotificationHistory,
  notification: Omit<MirroredNotification, "dismissState" | "replyState" | "replyStatusMessage">
): NotificationHistory {
  const next: MirroredNotification[] = [
    {
      ...notification,
      dismissState: "idle",
      replyState: "idle"
    },
    ...history.notifications.filter(
      (item) =>
        item.notificationId !== notification.notificationId ||
        item.sourceDevice.deviceId !== notification.sourceDevice.deviceId
    )
  ];

  return {
    notifications: next
      .sort((a, b) => b.postTime - a.postTime || b.receivedAt - a.receivedAt)
      .slice(0, NOTIFICATION_HISTORY_LIMIT)
  };
}

export function removeMirroredNotification(
  history: NotificationHistory,
  sourceDeviceId: string,
  notificationId: string
): NotificationHistory {
  return {
    notifications: history.notifications.filter(
      (item) => item.sourceDevice.deviceId !== sourceDeviceId || item.notificationId !== notificationId
    )
  };
}

export function markMirroredNotificationDismissSending(
  history: NotificationHistory,
  sourceDeviceId: string,
  notificationId: string
): NotificationHistory {
  return updateMirroredNotification(history, sourceDeviceId, notificationId, (notification) => ({
    ...notification,
    dismissState: "sending",
    dismissError: undefined
  }));
}

export function markMirroredNotificationDismissFailed(
  history: NotificationHistory,
  sourceDeviceId: string,
  notificationId: string,
  dismissError: string
): NotificationHistory {
  return updateMirroredNotification(history, sourceDeviceId, notificationId, (notification) => ({
    ...notification,
    dismissState: "failed",
    dismissError
  }));
}

export function markMirroredNotificationReplySending(
  history: NotificationHistory,
  sourceDeviceId: string,
  notificationId: string
): NotificationHistory {
  return updateMirroredNotification(history, sourceDeviceId, notificationId, (notification) => ({
    ...notification,
    replyState: "sending",
    replyStatusMessage: undefined
  }));
}

export function markMirroredNotificationReplySent(
  history: NotificationHistory,
  sourceDeviceId: string,
  notificationId: string,
  replyStatusMessage: string
): NotificationHistory {
  return updateMirroredNotification(history, sourceDeviceId, notificationId, (notification) => ({
    ...notification,
    replyState: "sent",
    replyStatusMessage
  }));
}

export function markMirroredNotificationReplyFailed(
  history: NotificationHistory,
  sourceDeviceId: string,
  notificationId: string,
  replyStatusMessage: string
): NotificationHistory {
  return updateMirroredNotification(history, sourceDeviceId, notificationId, (notification) => ({
    ...notification,
    replyState: "failed",
    replyStatusMessage
  }));
}

function updateMirroredNotification(
  history: NotificationHistory,
  sourceDeviceId: string,
  notificationId: string,
  updater: (notification: MirroredNotification) => MirroredNotification
): NotificationHistory {
  return {
    notifications: history.notifications.map((notification) => {
      if (
        notification.sourceDevice.deviceId !== sourceDeviceId ||
        notification.notificationId !== notificationId
      ) {
        return notification;
      }

      return updater(notification);
    })
  };
}

const NOTIFICATION_HISTORY_LIMIT = 100;
