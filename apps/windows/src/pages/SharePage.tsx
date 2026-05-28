import { Inbox, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ReceivedShareCard } from "../components/ReceivedShareCard.js";
import { TextShareComposer } from "../components/TextShareComposer.js";
import type { ConnectionViewState } from "../services/connectionManager.js";

interface SharePageProps {
  connectionState: ConnectionViewState;
  onSendTextShare: (toDeviceId: string, text: string) => Promise<void>;
}

function disabledReason(
  connectionState: ConnectionViewState,
  selectedDeviceId: string,
  text: string
): string | undefined {
  const trustedAndroidDevices = connectionState.trustedDevices
    .filter((entry) => entry.device.platform === "android");
  const selected = trustedAndroidDevices.find((entry) => entry.device.deviceId === selectedDeviceId);

  if (trustedAndroidDevices.length === 0) return "No trusted devices yet.";
  if (!selected) return "Select a trusted Android device.";
  if (connectionState.relayConnectionState !== "connected") return "Connected relay is required.";
  if (!selected.online) return "Trusted device offline.";
  if (text.trim().length === 0) return "Enter text or a URL.";
  if (text.length > 20_000) return "Text is longer than 20,000 characters.";
  return undefined;
}

export function SharePage({ connectionState, onSendTextShare }: SharePageProps) {
  const trustedAndroidDevices = useMemo(
    () => connectionState.trustedDevices.filter((entry) => entry.device.platform === "android"),
    [connectionState.trustedDevices]
  );
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [text, setText] = useState("");

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

  const reason = disabledReason(connectionState, selectedDeviceId, text);

  async function send() {
    if (reason) return;
    await onSendTextShare(selectedDeviceId, text);
    setText("");
  }

  return (
    <section className="page share-page">
      <TextShareComposer
        devices={trustedAndroidDevices}
        selectedDeviceId={selectedDeviceId}
        text={text}
        disabledReason={reason}
        onSelectedDeviceChange={setSelectedDeviceId}
        onTextChange={setText}
        onSend={() => {
          void send();
        }}
      />

      {connectionState.shareError ? <p className="error-note">{connectionState.shareError}</p> : null}

      <section className="content-band share-history-band">
        <div className="section-heading">
          <div>
            <h2>Sent</h2>
            <p>Recent outgoing text and links.</p>
          </div>
          <Send size={22} aria-hidden="true" />
        </div>
        {connectionState.sentShares.length === 0 ? (
          <div className="compact-empty">
            <p>No sent shares yet.</p>
          </div>
        ) : (
          <div className="sent-share-list">
            {connectionState.sentShares.map((share) => (
              <article key={share.shareId} className={`sent-share-row ${share.status}`}>
                <div>
                  <strong>{share.targetDevice.deviceName}</strong>
                  <p>{share.text}</p>
                </div>
                <span>{share.statusMessage}</span>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="content-band share-history-band">
        <div className="section-heading">
          <div>
            <h2>Received</h2>
            <p>Open and copy received items manually.</p>
          </div>
          <Inbox size={22} aria-hidden="true" />
        </div>
        {connectionState.receivedShares.length === 0 ? (
          <div className="compact-empty">
            <p>No received shares yet.</p>
          </div>
        ) : (
          <div className="received-share-list">
            {connectionState.receivedShares.map((share) => (
              <ReceivedShareCard key={share.shareId} share={share} />
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
