import { QrCode, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PairingQrPanel } from "../components/PairingQrPanel.js";
import { PairingStatusCard } from "../components/PairingStatusCard.js";
import { PairingClient } from "../services/pairingClient.js";

const DEFAULT_WINDOWS_RELAY_URL = import.meta.env.VITE_CROSSBRIDGE_RELAY_URL ?? "ws://127.0.0.1:8787/connect";
const DEFAULT_ANDROID_RELAY_URL = import.meta.env.VITE_CROSSBRIDGE_ANDROID_RELAY_URL ?? DEFAULT_WINDOWS_RELAY_URL;

function isWebSocketUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "ws:" || url.protocol === "wss:";
  } catch {
    return false;
  }
}

export function PairDevicePage() {
  const pairingClient = useMemo(() => new PairingClient(), []);
  const [viewState, setViewState] = useState(() => pairingClient.getState());
  const [relayUrl, setRelayUrl] = useState(DEFAULT_WINDOWS_RELAY_URL);
  const [androidRelayUrl, setAndroidRelayUrl] = useState(DEFAULT_ANDROID_RELAY_URL);
  const [urlError, setUrlError] = useState<string | undefined>();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const unsubscribe = pairingClient.onStateChange(setViewState);
    return () => {
      unsubscribe();
      pairingClient.disconnect();
    };
  }, [pairingClient]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  async function createPairingCode() {
    if (!isWebSocketUrl(relayUrl) || !isWebSocketUrl(androidRelayUrl)) {
      setUrlError("Relay URLs must start with ws:// or wss://.");
      return;
    }

    setUrlError(undefined);
    await pairingClient.createPairingSession(relayUrl, androidRelayUrl);
  }

  function confirmPairing() {
    pairingClient.confirmPairing();
  }

  const creating = viewState.state === "connecting" ||
    viewState.relayConnectionState === "connecting" ||
    viewState.relayConnectionState === "reconnecting";
  const canCreate = !creating && isWebSocketUrl(relayUrl) && isWebSocketUrl(androidRelayUrl);

  return (
    <section className="page pair-page">
      <div className="pair-toolbar">
        <label className="relay-url-field">
          <span>Windows relay URL</span>
          <input
            type="url"
            value={relayUrl}
            onChange={(event) => setRelayUrl(event.target.value)}
            spellCheck={false}
          />
        </label>
        <label className="relay-url-field">
          <span>Android QR relay URL</span>
          <input
            type="url"
            value={androidRelayUrl}
            onChange={(event) => setAndroidRelayUrl(event.target.value)}
            placeholder="ws://10.0.2.2:8787/connect"
            spellCheck={false}
          />
        </label>
        <button className="primary-action" type="button" onClick={createPairingCode} disabled={!canCreate}>
          {creating ? <RotateCcw size={18} aria-hidden="true" /> : <QrCode size={18} aria-hidden="true" />}
          Create pairing code
        </button>
      </div>
      <div style={{ marginTop: '1rem', padding: '0.85rem', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.08)', backgroundColor: 'rgba(255, 255, 255, 0.03)', fontSize: '0.875rem', lineHeight: '1.45' }}>
        <p style={{ margin: 0, fontWeight: 600, color: '#f3f4f6', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          🛡️ VPN can stay on. CrossBridge communicates via encrypted relay envelopes.
        </p>
        <ul style={{ margin: '0.5rem 0 0 0', paddingLeft: '1.2rem', color: '#9ca3af', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <li>
            <strong>Local Emulator:</strong> Keep Windows at <code>ws://127.0.0.1:8787/connect</code> and use <code>ws://10.0.2.2:8787/connect</code> for Android.
          </li>
          <li>
            <strong>Physical LAN Phone:</strong> Set Android QR URL to your PC's LAN IP (e.g. <code>ws://&lt;PC-LAN-IP&gt;:8787/connect</code>).
          </li>
          <li>
            <strong>Hosted Relay:</strong> Configure both fields with your secure hosted URL (e.g. <code>wss://your-domain.com/connect</code>).
          </li>
        </ul>
      </div>
      {urlError ? <p className="relay-url-error">{urlError}</p> : null}

      <div className="two-column">
        <PairingQrPanel qrPayload={viewState.qrPayload} />
        <PairingStatusCard viewState={viewState} now={now} onConfirm={confirmPairing} />
      </div>
    </section>
  );
}
