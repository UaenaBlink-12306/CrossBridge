import { useState, useEffect, useMemo } from "react";
import { AlertTriangle, Bell, CheckCircle2, File, Laptop, Link, QrCode, Smartphone, Upload, X, XCircle } from "lucide-react";
import { ConnectionStatusCard, connectionStatusLabel } from "../components/ConnectionStatusCard.js";
import type { ConnectionViewState } from "../services/connectionManager.js";
import { inferRiskyFileWarning } from "../services/fileTransferClient.js";

interface HomePageProps {
  connectionState: ConnectionViewState;
  onPair: () => void;
  onRelayUrlChange: (relayUrl: string) => void;
  onReconnect: () => void;
}

export function HomePage({
  connectionState,
  onPair,
  onRelayUrlChange,
  onReconnect
}: HomePageProps) {
  const onlineDevice = connectionState.trustedDevices.find((device) => device.online);
  const androidStatus = onlineDevice
    ? `${onlineDevice.device.deviceName} online`
    : connectionState.trustedDevices.length > 0
      ? "Trusted device offline"
      : "Not paired";

  return (
    <section className="page">
      <div className="hero-panel">
        <div>
          <h2>Connect your phone and PC</h2>
          <p>
            Pair once, then CrossBridge reconnects trusted devices through encrypted relay mode when both apps open.
          </p>
        </div>
        <button className="primary-action" type="button" onClick={onPair}>
          <QrCode size={18} aria-hidden="true" />
          Pair phone
        </button>
      </div>

      <ConnectionStatusCard
        state={connectionState}
        onRelayUrlChange={onRelayUrlChange}
        onReconnect={onReconnect}
      />

      <div className="status-grid">
        <div className="status-panel">
          <Laptop size={20} aria-hidden="true" />
          <span>Windows app</span>
          <strong>Ready</strong>
        </div>
        <div className="status-panel">
          <Smartphone size={20} aria-hidden="true" />
          <span>Android app</span>
          <strong>{androidStatus}</strong>
        </div>
        <div className="status-panel">
          <Link size={20} aria-hidden="true" />
          <span>Connection</span>
          <strong>{connectionStatusLabel(connectionState)}</strong>
        </div>
      </div>
    </section>
  );
}

interface TransfersPageProps {
  connectionState: ConnectionViewState;
  onSendFileOffer: (toDeviceId: string, fileName: string, mimeType: string, bytes: Uint8Array) => Promise<string>;
  onAcceptFileOffer: (transferId: string) => Promise<void>;
  onRejectFileOffer: (transferId: string) => Promise<void>;
  onCancelFileTransfer: (transferId: string) => Promise<void>;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function TransfersPage({
  connectionState,
  onSendFileOffer,
  onAcceptFileOffer,
  onRejectFileOffer,
  onCancelFileTransfer
}: TransfersPageProps) {
  const trustedAndroidDevices = useMemo(
    () => connectionState.trustedDevices.filter((entry) => entry.device.platform === "android"),
    [connectionState.trustedDevices]
  );

  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (trustedAndroidDevices.length === 0) {
      setSelectedDeviceId("");
      return;
    }
    if (trustedAndroidDevices.some((entry) => entry.device.deviceId === selectedDeviceId)) {
      return;
    }
    const onlineDevice = trustedAndroidDevices.find((entry) => entry.online);
    setSelectedDeviceId((onlineDevice ?? trustedAndroidDevices[0]).device.deviceId);
  }, [selectedDeviceId, trustedAndroidDevices]);

  const target = trustedAndroidDevices.find((entry) => entry.device.deviceId === selectedDeviceId);
  const isOnline = target?.online ?? false;
  const isConnected = connectionState.relayConnectionState === "connected";

  const riskyWarning = selectedFile ? inferRiskyFileWarning(selectedFile.name) : undefined;

  async function handleSend() {
    if (!selectedFile || !selectedDeviceId) return;
    if (!isOnline || !isConnected) {
      setError("Target device is offline.");
      return;
    }

    setSending(true);
    setError(null);

    try {
      const reader = new FileReader();
      const bytesPromise = new Promise<Uint8Array>((resolve, reject) => {
        reader.onload = () => {
          if (reader.result instanceof ArrayBuffer) {
            resolve(new Uint8Array(reader.result));
          } else {
            reject(new Error("Failed to read file."));
          }
        };
        reader.onerror = () => reject(reader.error);
      });

      reader.readAsArrayBuffer(selectedFile);
      const bytes = await bytesPromise;

      await onSendFileOffer(selectedDeviceId, selectedFile.name, selectedFile.type, bytes);
      setSelectedFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read or send file.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="page transfers-page">
      <div className="two-column">
        {/* Left Side: Send File Form */}
        <section className="content-band file-sender-band">
          <div className="section-heading">
            <div>
              <h2>Send File</h2>
              <p>Transfer encrypted files safely over the relay.</p>
            </div>
            <Upload size={22} aria-hidden="true" />
          </div>

          <div className="status-list" style={{ marginTop: "16px", border: "none" }}>
            <label className="relay-url-field">
              <span>Trusted Android device</span>
              <select
                value={selectedDeviceId}
                onChange={(event) => setSelectedDeviceId(event.target.value)}
                disabled={trustedAndroidDevices.length === 0}
              >
                {trustedAndroidDevices.length === 0 ? (
                  <option value="">No trusted devices yet</option>
                ) : (
                  trustedAndroidDevices.map((entry) => (
                    <option key={entry.device.deviceId} value={entry.device.deviceId}>
                      {entry.device.deviceName} - {entry.online ? "online" : "offline"}
                    </option>
                  ))
                )}
              </select>
            </label>

            <div className="file-picker-container">
              <label className="file-picker-label">
                <input
                  type="file"
                  className="hidden-file-input"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      setSelectedFile(file);
                      setError(null);
                    }
                  }}
                />
                <div className="file-picker-box">
                  <File size={36} className="file-icon" />
                  {selectedFile ? (
                    <div className="file-picker-info">
                      <span className="file-picker-name">{selectedFile.name}</span>
                      <span className="file-picker-size">{formatBytes(selectedFile.size)}</span>
                    </div>
                  ) : (
                    <span className="file-picker-placeholder">Click to select a file</span>
                  )}
                </div>
              </label>
            </div>

            {riskyWarning && (
              <div className="risky-warning-box">
                <AlertTriangle size={18} />
                <div>
                  <strong>Security Alert</strong>
                  <p>{riskyWarning}</p>
                </div>
              </div>
            )}

            {error && <p className="error-note">{error}</p>}
            {connectionState.shareError && <p className="error-note">{connectionState.shareError}</p>}

            <button
              className="primary-action"
              style={{ width: "100%", marginTop: "10px" }}
              type="button"
              disabled={!selectedFile || !selectedDeviceId || !isOnline || !isConnected || sending}
              onClick={handleSend}
            >
              {sending ? "Sending Offer..." : "Send to Phone"}
            </button>
          </div>
        </section>

        {/* Right Side: Active/Past Transfers List */}
        <section className="content-band transfers-list-band">
          <div className="section-heading">
            <div>
              <h2>Transfers History</h2>
              <p>Active and recent file shares.</p>
            </div>
          </div>

          {connectionState.transfers.length === 0 ? (
            <div className="empty-state" style={{ minHeight: "220px", border: "none" }}>
              <File size={32} />
              <p>No transfers yet.</p>
            </div>
          ) : (
            <div className="transfers-list">
              {connectionState.transfers.map((transfer) => {
                const isIncoming = transfer.direction === "ANDROID_TO_WINDOWS";
                const directionText = isIncoming ? "Received from" : "Sent to";
                const peerName =
                  connectionState.trustedDevices.find((d) => d.device.deviceId === transfer.peerDeviceId)
                    ?.device.deviceName ?? "Phone";

                return (
                  <article key={transfer.transferId} className={`transfer-card ${transfer.status}`}>
                    <div className="transfer-card-info">
                      <div className="transfer-card-meta">
                        <span className="transfer-direction">
                          {directionText} <strong>{peerName}</strong>
                        </span>
                        <span className="transfer-size">{formatBytes(transfer.fileSize)}</span>
                      </div>
                      <h4 className="transfer-filename">{transfer.fileName}</h4>
                    </div>

                    {/* Pending incoming offer */}
                    {transfer.status === "offered" && isIncoming && (
                      <div className="transfer-actions">
                        {transfer.riskyWarning && (
                          <div className="risky-warning-box compact">
                            <AlertTriangle size={14} />
                            <span>{transfer.riskyWarning}</span>
                          </div>
                        )}
                        <div className="transfer-buttons">
                          <button
                            className="primary-action compact-btn"
                            type="button"
                            onClick={() => void onAcceptFileOffer(transfer.transferId)}
                          >
                            Accept
                          </button>
                          <button
                            className="secondary-action compact-btn"
                            type="button"
                            onClick={() => void onRejectFileOffer(transfer.transferId)}
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Pending outgoing offer */}
                    {transfer.status === "offered" && !isIncoming && (
                      <div className="transfer-status-text">
                        <span className="spinner-dot" /> Waiting for recipient to accept...
                      </div>
                    )}

                    {/* Active transfer progress */}
                    {(transfer.status === "transferring" || transfer.status === "accepted") && (
                      <div className="transfer-progress-container">
                        <div className="progress-bar-bg">
                          <div className="progress-bar-fill" style={{ width: `${transfer.progress}%` }} />
                        </div>
                        <div className="progress-details">
                          <span>{transfer.progress}% ({formatBytes(transfer.bytesTransferred)})</span>
                          <button
                            className="cancel-btn"
                            type="button"
                            onClick={() => void onCancelFileTransfer(transfer.transferId)}
                          >
                            <X size={14} /> Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Completed */}
                    {transfer.status === "completed" && (
                      <div className="transfer-completed-banner">
                        <CheckCircle2 size={16} className="text-success" />
                        <span>Completed. File downloaded successfully!</span>
                      </div>
                    )}

                    {/* Rejected */}
                    {transfer.status === "rejected" && (
                      <div className="transfer-failed-banner">
                        <XCircle size={16} />
                        <span>Declined: {transfer.error ?? "Recipient rejected the file."}</span>
                      </div>
                    )}

                    {/* Failed */}
                    {transfer.status === "failed" && (
                      <div className="transfer-failed-banner">
                        <XCircle size={16} />
                        <span>Failed: {transfer.error}</span>
                      </div>
                    )}

                    {/* Cancelled */}
                    {transfer.status === "cancelled" && (
                      <div className="transfer-failed-banner grey">
                        <XCircle size={16} />
                        <span>Cancelled: {transfer.error ?? "Transfer was aborted."}</span>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function formatNotificationTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric"
  }).format(new Date(timestamp));
}

interface NotificationFeedPageProps {
  connectionState: ConnectionViewState;
  onDismissNotification?: (sourceDeviceId: string, notificationId: string) => void;
  onReplyNotification?: (
    sourceDeviceId: string,
    notificationId: string,
    actionId: string,
    replyText: string
  ) => void;
}

export function NotificationFeedPage({
  connectionState,
  onDismissNotification,
  onReplyNotification
}: NotificationFeedPageProps) {
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});

  return (
    <section className="page notifications-page">
      {connectionState.notifications.length === 0 ? (
        <div className="empty-state">
          <Bell size={32} aria-hidden="true" />
          <h2>No mirrored notifications</h2>
          <p>Android notifications stay off until notification mirroring is enabled on the phone.</p>
        </div>
      ) : (
        <section className="content-band notification-feed-band">
          <div className="section-heading">
            <div>
              <h2>Notifications</h2>
              <p>Mirrored from trusted Android devices, with dismiss support when Android allows it.</p>
            </div>
            <Bell size={22} aria-hidden="true" />
          </div>
          <div className="notification-list">
            {connectionState.notifications.map((notification) => {
              const replyAction = notification.actions.find((action) => action.supportsRemoteInput);
              const replyKey = `${notification.sourceDevice.deviceId}:${notification.notificationId}`;
              const replyDraft = replyDrafts[replyKey] ?? "";
              const dismissButtonLabel = notification.dismissState === "sending"
                ? "Dismissing..."
                : notification.canDismiss
                  ? "Dismiss on phone"
                  : "Can't dismiss";

              return (
                <article
                  key={`${notification.sourceDevice.deviceId}:${notification.notificationId}`}
                  className="notification-card"
                >
                  <div className="notification-card-heading">
                    <div>
                      <strong>{notification.appName}</strong>
                      <span>{notification.sourceDevice.deviceName}</span>
                    </div>
                    <time dateTime={new Date(notification.postTime).toISOString()}>
                      {formatNotificationTime(notification.postTime)}
                    </time>
                  </div>
                  {notification.title ? <h3>{notification.title}</h3> : null}
                  {notification.text ? <p>{notification.text}</p> : null}
                  {notification.subText ? <small>{notification.subText}</small> : null}
                  <div className="notification-card-footer">
                    <div className="notification-status-pills">
                      <span
                        className={
                          notification.canDismiss
                            ? "share-type-pill notification-status-pill"
                            : "share-type-pill notification-status-pill blocked"
                        }
                      >
                        {notification.canDismiss ? "Dismiss available" : "Dismiss blocked by Android"}
                      </span>
                      {replyAction ? (
                        <span className="share-type-pill notification-status-pill">
                          Reply available
                        </span>
                      ) : null}
                    </div>
                    <button
                      className="secondary-action compact-btn notification-dismiss-button"
                      type="button"
                      disabled={
                        !notification.canDismiss ||
                        notification.dismissState === "sending" ||
                        !onDismissNotification
                      }
                      onClick={() => onDismissNotification?.(
                        notification.sourceDevice.deviceId,
                        notification.notificationId
                      )}
                    >
                      <X size={14} aria-hidden="true" />
                      {dismissButtonLabel}
                    </button>
                  </div>
                  {replyAction && onReplyNotification ? (
                    <div className="notification-reply-composer">
                      <label className="notification-reply-field">
                        <span>Reply from Windows</span>
                        <textarea
                          rows={2}
                          value={replyDraft}
                          disabled={notification.replyState === "sending"}
                          placeholder={`Send ${replyAction.title.toLowerCase()} through your phone`}
                          onChange={(event) => {
                            const nextDraft = event.target.value;
                            setReplyDrafts((current) => ({
                              ...current,
                              [replyKey]: nextDraft
                            }));
                          }}
                        />
                      </label>
                      <div className="notification-reply-actions">
                        <span>{replyAction.title} supports direct reply</span>
                        <button
                          className="primary-action compact-btn notification-reply-button"
                          type="button"
                          disabled={notification.replyState === "sending" || replyDraft.trim().length === 0}
                          onClick={() => onReplyNotification(
                            notification.sourceDevice.deviceId,
                            notification.notificationId,
                            replyAction.actionId,
                            replyDraft
                          )}
                        >
                          {notification.replyState === "sending" ? "Sending..." : "Send reply"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {notification.dismissError ? (
                    <p className="error-note notification-error-note">{notification.dismissError}</p>
                  ) : null}
                  {notification.replyState === "failed" && notification.replyStatusMessage ? (
                    <p className="error-note notification-error-note">{notification.replyStatusMessage}</p>
                  ) : null}
                  {notification.replyState === "sent" && notification.replyStatusMessage ? (
                    <p className="notification-success-note">{notification.replyStatusMessage}</p>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      )}
      <div className="content-band notification-note-band">
        <Bell size={32} aria-hidden="true" />
        <div>
          <h3>Encrypted mirror, dismiss, and reply</h3>
          <p>CrossBridge mirrors Android notification metadata and sends dismiss or direct-reply actions over the encrypted trusted-device relay path when Android exposes them.</p>
        </div>
      </div>
    </section>
  );
}
