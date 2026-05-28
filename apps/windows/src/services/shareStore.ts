import type { TextSharePayload, TrustedDevice } from "@crossbridge/protocol";

export type ShareSendStatus = "sending" | "sent" | "received" | "failed";

export interface SentShare {
  shareId: string;
  messageId: string;
  targetDevice: TrustedDevice;
  contentType: "text" | "url";
  text: string;
  createdAt: number;
  status: ShareSendStatus;
  statusMessage: string;
}

export interface ReceivedShare {
  shareId: string;
  messageId: string;
  sourceDevice: TrustedDevice;
  contentType: "text" | "url";
  text: string;
  receivedAt: number;
}

export interface ShareHistoryState {
  sentShares: SentShare[];
  receivedShares: ReceivedShare[];
}

export const SHARE_HISTORY_LIMIT = 20;

export function createEmptyShareHistory(): ShareHistoryState {
  return {
    sentShares: [],
    receivedShares: []
  };
}

export function addSendingShare(
  history: ShareHistoryState,
  share: Omit<SentShare, "status" | "statusMessage">
): ShareHistoryState {
  return {
    ...history,
    sentShares: [
      {
        ...share,
        status: "sending" as const,
        statusMessage: "Sending..."
      },
      ...history.sentShares
    ].slice(0, SHARE_HISTORY_LIMIT)
  };
}

export function markShareSent(
  history: ShareHistoryState,
  messageId: string
): ShareHistoryState {
  return updateSentShare(history, messageId, {
    status: "sent",
    statusMessage: "Sent."
  });
}

export function markShareReceived(
  history: ShareHistoryState,
  shareId: string
): ShareHistoryState {
  return {
    ...history,
    sentShares: history.sentShares.map((share) => {
      if (share.shareId !== shareId) return share;
      return {
        ...share,
        status: "received",
        statusMessage: "Received."
      };
    })
  };
}

export function markShareFailed(
  history: ShareHistoryState,
  messageIdOrShareId: string,
  statusMessage: string
): ShareHistoryState {
  return {
    ...history,
    sentShares: history.sentShares.map((share) => {
      if (share.messageId !== messageIdOrShareId && share.shareId !== messageIdOrShareId) return share;
      return {
        ...share,
        status: "failed",
        statusMessage
      };
    })
  };
}

export function addReceivedShare(
  history: ShareHistoryState,
  share: Omit<ReceivedShare, "contentType" | "text"> & Pick<TextSharePayload, "contentType" | "text">
): ShareHistoryState {
  const alreadyReceived = history.receivedShares.some(
    (entry) => entry.shareId === share.shareId
  );
  if (alreadyReceived) return history;

  return {
    ...history,
    receivedShares: [
      share,
      ...history.receivedShares
    ].slice(0, SHARE_HISTORY_LIMIT)
  };
}

function updateSentShare(
  history: ShareHistoryState,
  messageId: string,
  patch: Pick<SentShare, "status" | "statusMessage">
): ShareHistoryState {
  return {
    ...history,
    sentShares: history.sentShares.map((share) => {
      if (share.messageId !== messageId) return share;
      return {
        ...share,
        ...patch
      };
    })
  };
}
