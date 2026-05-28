import { Check, Copy, QrCode } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import type { PairingQrPayload } from "../types/pairing.js";

interface PairingQrPanelProps {
  qrPayload?: PairingQrPayload;
}

function copyWithFallback(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }

  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "true");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  document.execCommand("copy");
  field.remove();
  return Promise.resolve();
}

export function PairingQrPanel({ qrPayload }: PairingQrPanelProps) {
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | undefined>();

  // Compact JSON for QR encoding (no pretty-printing so the QR code is smaller)
  const qrCompactJson = useMemo(
    () => qrPayload ? JSON.stringify(qrPayload) : "",
    [qrPayload]
  );

  // Pretty JSON for display and copy
  const qrJson = useMemo(
    () => qrPayload ? JSON.stringify(qrPayload, null, 2) : "",
    [qrPayload]
  );

  // Generate QR code data URL when payload changes
  useEffect(() => {
    if (!qrCompactJson) {
      setQrDataUrl(undefined);
      return;
    }

    QRCode.toDataURL(qrCompactJson, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 280,
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    }).then(setQrDataUrl).catch((err: unknown) => {
      console.error("QR code generation failed:", err);
      setQrDataUrl(undefined);
    });
  }, [qrCompactJson]);

  async function copyPayload() {
    if (!qrJson) return;
    await copyWithFallback(qrJson);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  if (!qrPayload) {
    return (
      <section className="content-band qr-panel" aria-label="Pairing code">
        <div className="section-heading">
          <div>
            <h2>Pair a phone</h2>
            <p>Start on Windows, then scan from Android. VPN can stay on.</p>
          </div>
        </div>
        <div className="qr-placeholder" aria-label="QR payload placeholder">
          <QrCode size={96} aria-hidden="true" />
        </div>
      </section>
    );
  }

  return (
    <section className="content-band qr-panel" aria-label="Pairing code">
      <div className="section-heading">
        <div>
          <h2>Pairing code</h2>
          <p>Scan this with the CrossBridge Android app, then compare the 6-digit code on both devices.</p>
        </div>
        <button className="secondary-action" type="button" onClick={copyPayload}>
          {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          {copied ? "Copied" : "Copy JSON"}
        </button>
      </div>
      {qrDataUrl ? (
        <div className="qr-image-container">
          <img
            src={qrDataUrl}
            alt="CrossBridge pairing QR code"
            className="qr-image"
            width={280}
            height={280}
          />
        </div>
      ) : null}
      <details className="qr-json-details">
        <summary>Show QR JSON payload</summary>
        <pre className="qr-json">{qrJson}</pre>
      </details>
    </section>
  );
}
