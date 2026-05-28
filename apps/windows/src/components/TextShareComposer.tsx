import { Link2, Send, Type } from "lucide-react";
import { detectContentType } from "@crossbridge/protocol";
import type { TrustedDeviceConnection } from "../services/connectionManager.js";

interface TextShareComposerProps {
  devices: TrustedDeviceConnection[];
  selectedDeviceId: string;
  text: string;
  disabledReason?: string;
  onSelectedDeviceChange: (deviceId: string) => void;
  onTextChange: (text: string) => void;
  onSend: () => void;
}

export function TextShareComposer({
  devices,
  selectedDeviceId,
  text,
  disabledReason,
  onSelectedDeviceChange,
  onTextChange,
  onSend
}: TextShareComposerProps) {
  const contentType = detectContentType(text);
  const disabled = Boolean(disabledReason);

  return (
    <section className="content-band share-composer">
      <div className="section-heading">
        <div>
          <h2>Send to Android</h2>
          <p>{disabledReason ?? (contentType === "url" ? "URL detected." : "Text ready.")}</p>
        </div>
        <span className="share-type-pill">
          {contentType === "url" ? <Link2 size={15} aria-hidden="true" /> : <Type size={15} aria-hidden="true" />}
          {contentType === "url" ? "URL" : "Text"}
        </span>
      </div>

      <label className="relay-url-field">
        <span>Trusted Android device</span>
        <select
          value={selectedDeviceId}
          onChange={(event) => onSelectedDeviceChange(event.target.value)}
          disabled={devices.length === 0}
        >
          {devices.length === 0 ? (
            <option value="">No trusted devices yet</option>
          ) : (
            devices.map((entry) => (
              <option key={entry.device.deviceId} value={entry.device.deviceId}>
                {entry.device.deviceName} - {entry.online ? "online" : "offline"}
              </option>
            ))
          )}
        </select>
      </label>

      <label className="share-text-field">
        <span>Text or URL</span>
        <textarea
          value={text}
          maxLength={20_000}
          onChange={(event) => onTextChange(event.target.value)}
          placeholder="Paste text or a URL"
        />
      </label>

      <div className="share-composer-actions">
        <button
          className="primary-action"
          type="button"
          onClick={onSend}
          disabled={disabled}
        >
          <Send size={16} aria-hidden="true" />
          Send to Android
        </button>
        <span>{text.length.toLocaleString()} / 20,000</span>
      </div>
    </section>
  );
}
