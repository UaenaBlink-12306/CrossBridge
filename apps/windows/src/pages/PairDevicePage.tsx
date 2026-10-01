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

interface PairDevicePageProps {
  initialRelayUrl?: string;
  onPairingStart?: () => void;
  onPairingEnd?: (relayUrl: string) => void;
}

export function PairDevicePage({ initialRelayUrl, onPairingStart, onPairingEnd }: PairDevicePageProps) {
  const pairingClient = useMemo(() => new PairingClient(), []);
  const [viewState, setViewState] = useState(() => pairingClient.getState());
  const [relayUrl, setRelayUrl] = useState(initialRelayUrl ?? DEFAULT_WINDOWS_RELAY_URL);
  const [androidRelayUrl, setAndroidRelayUrl] = useState(initialRelayUrl ?? DEFAULT_ANDROID_RELAY_URL);
  const [urlError, setUrlError] = useState<string | undefined>();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const unsubscribe = pairingClient.onStateChange(setViewState);
    return () => {
      unsubscribe();
      pairingClient.dispose();
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
    onPairingStart?.();
    await pairingClient.createPairingSession(relayUrl, androidRelayUrl);
  }

  useEffect(() => {
    if (viewState.state === "complete") onPairingEnd?.(relayUrl);
  }, [viewState.state, relayUrl, onPairingEnd]);

  function confirmPairing() {
    pairingClient.confirmPairing();
  }

  const creating = viewState.state === "connecting" ||
    viewState.relayConnectionState === "connecting" ||
    viewState.relayConnectionState === "reconnecting";
  const canCreate = !creating && isWebSocketUrl(relayUrl) && isWebSocketUrl(androidRelayUrl);

  return (
    <section className="page pair-page">
      <div className="hero-panel">
        <div>
          <h2>Pair your Android phone</h2>
          <p>1. Create a code here. 2. Open CrossBridge on your phone and scan it. 3. Confirm the matching six digits on both devices.</p>
        </div>
        <button className="primary-action" type="button" onClick={createPairingCode} disabled={!canCreate}>
          {creating ? <RotateCcw size={18} aria-hidden="true" /> : <QrCode size={18} aria-hidden="true" />}
          {creating ? "Connecting…" : "Create pairing code"}
        </button>
      </div>
      <p className="setup-note">VPN can stay on. The hosted connection is configured for you. After inactivity, the first connection may take about a minute.</p>
      <details className="advanced-settings">
        <summary>Advanced connection settings</summary>
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
        </div>
        <p>For development: Windows uses ws://127.0.0.1:8787/connect; the Android emulator uses ws://10.0.2.2:8787/connect. For a phone, use an address reachable from both devices.</p>
      </details>
      {urlError ? <p className="relay-url-error">{urlError}</p> : null}

      <div className="two-column">
        <PairingQrPanel qrPayload={viewState.qrPayload} />
        <PairingStatusCard viewState={viewState} now={now} onConfirm={confirmPairing} />
      </div>
    </section>
  );
}
