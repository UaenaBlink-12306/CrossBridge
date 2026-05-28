import { CheckCircle2, Clock, Loader2, ShieldCheck, Smartphone, Wifi } from "lucide-react";
import type { PairingState, PairingViewState, RelayConnectionState } from "../types/pairing.js";

interface PairingStatusCardProps {
  viewState: PairingViewState;
  now: number;
  onConfirm: () => void;
}

const connectionLabels: Record<RelayConnectionState, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting",
  connected: "Connected to relay",
  reconnecting: "Reconnecting",
  error: "Error"
};

const pairingLabels: Record<PairingState, string> = {
  idle: "Not started",
  connecting: "Connecting",
  session_created: "Session created",
  waiting_for_android: "Waiting for Android",
  android_joined: "Android joined",
  waiting_for_confirmation: "Android joined",
  confirmed: "Windows confirmed",
  complete: "Pairing complete",
  expired: "Expired",
  error: "Error"
};

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function formatCountdown(expiresAt: number, now: number): string {
  const remainingSeconds = Math.max(0, Math.ceil((expiresAt - now) / 1_000));
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function PairingStatusCard({ viewState, now, onConfirm }: PairingStatusCardProps) {
  const isExpired = viewState.state === "expired" ||
    (viewState.expiresAt !== undefined && viewState.expiresAt <= now && viewState.state !== "complete");
  const canConfirm = viewState.state === "waiting_for_confirmation" ||
    viewState.state === "android_joined";

  return (
    <section className="content-band pairing-status-card" aria-label="Pairing status">
      <div className="status-card-heading">
        <ShieldCheck size={22} aria-hidden="true" />
        <div>
          <h3>Pairing state</h3>
          <p>VPN can stay on. If local connection is blocked, CrossBridge uses encrypted relay mode.</p>
        </div>
      </div>

      <div className="status-list">
        <div className="status-row">
          <span><Wifi size={16} aria-hidden="true" /> Relay</span>
          <strong>{connectionLabels[viewState.relayConnectionState]}</strong>
        </div>
        <div className="status-row">
          <span><Loader2 size={16} aria-hidden="true" /> Status</span>
          <strong>{isExpired ? "Expired" : pairingLabels[viewState.state]}</strong>
        </div>
        {viewState.androidIdentity ? (
          <div className="status-row">
            <span><Smartphone size={16} aria-hidden="true" /> Android</span>
            <strong>{viewState.androidIdentity.deviceName}</strong>
          </div>
        ) : null}
        {viewState.expiresAt ? (
          <div className="status-row">
            <span><Clock size={16} aria-hidden="true" /> Expires</span>
            <strong>
              {formatTime(viewState.expiresAt)}
              <small>{isExpired ? "Expired" : `${formatCountdown(viewState.expiresAt, now)} left`}</small>
            </strong>
          </div>
        ) : null}
      </div>

      {viewState.verificationCode ? (
        <div className="verification-panel" aria-live="polite">
          <span>Verification code</span>
          <strong>{viewState.verificationCode}</strong>
        </div>
      ) : null}

      {viewState.error ? (
        <div className="error-note" role="alert">
          {viewState.error}
        </div>
      ) : null}

      {viewState.state === "complete" ? (
        <div className="complete-note">
          <CheckCircle2 size={18} aria-hidden="true" />
          Pairing complete
        </div>
      ) : null}

      <button
        className="primary-action pairing-action"
        type="button"
        disabled={!canConfirm || isExpired}
        onClick={onConfirm}
      >
        <CheckCircle2 size={16} aria-hidden="true" />
        Confirm pairing
      </button>
    </section>
  );
}
