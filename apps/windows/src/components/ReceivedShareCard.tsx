import { Check, Clipboard, ExternalLink, Link2, Type } from "lucide-react";
import { useState } from "react";
import type { ReceivedShare } from "../services/shareStore.js";

interface ReceivedShareCardProps {
  share: ReceivedShare;
}

function formatReceivedAt(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    hour: "2-digit",
    minute: "2-digit",
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

export function ReceivedShareCard({ share }: ReceivedShareCardProps) {
  const [copied, setCopied] = useState(false);
  const isUrl = share.contentType === "url";

  async function copyText() {
    await navigator.clipboard.writeText(share.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  }

  function openUrl() {
    if (!isUrl) return;
    window.open(share.text.trim(), "_blank", "noopener,noreferrer");
  }

  return (
    <article className="received-share-card">
      <div className="received-share-header">
        <span className="share-type-pill">
          {isUrl ? <Link2 size={15} aria-hidden="true" /> : <Type size={15} aria-hidden="true" />}
          {isUrl ? "URL" : "Text"}
        </span>
        <span>{formatReceivedAt(share.receivedAt)}</span>
      </div>
      <p className="received-share-preview">{share.text}</p>
      <div className="received-share-meta">
        <span>{share.sourceDevice.deviceName}</span>
      </div>
      <div className="share-card-actions">
        <button className="secondary-action" type="button" onClick={() => void copyText()}>
          {copied ? <Check size={16} aria-hidden="true" /> : <Clipboard size={16} aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
        {isUrl ? (
          <button className="secondary-action" type="button" onClick={openUrl}>
            <ExternalLink size={16} aria-hidden="true" />
            Open
          </button>
        ) : null}
      </div>
    </article>
  );
}
