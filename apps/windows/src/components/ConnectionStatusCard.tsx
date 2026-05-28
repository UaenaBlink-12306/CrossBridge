import { Link, PlugZap, RotateCw, TriangleAlert } from "lucide-react";
import type { ConnectionViewState } from "../services/connectionManager.js";

interface ConnectionStatusCardProps {
  state: ConnectionViewState;
  onRelayUrlChange: (relayUrl: string) => void;
  onReconnect: () => void;
}

export function connectionStatusLabel(state: ConnectionViewState): string {
  if (state.phase === "not_paired") return "Not paired";
  if (state.phase === "connecting") return "Connecting";
  if (state.phase === "connected_to_relay") return "Connected to relay";
  if (state.phase === "trusted_device_online") return "Trusted device online";
  if (state.phase === "trusted_device_offline") return "Trusted device offline";
  if (state.phase === "reconnecting") return "Reconnecting";
  if (state.phase === "error") return "Error";
  return "Disconnected";
}

export function ConnectionStatusCard({
  state,
  onRelayUrlChange,
  onReconnect
}: ConnectionStatusCardProps) {
  const onlineCount = state.trustedDevices.filter((device) => device.online).length;
  const hasTrustedDevices = state.trustedDevices.length > 0;
  const busy = state.relayConnectionState === "connecting" ||
    state.relayConnectionState === "reconnecting";

  return (
    <section className="content-band connection-status-card">
      <div className="section-heading">
        <div>
          <h2>Connection</h2>
          <p>{connectionStatusLabel(state)}</p>
        </div>
        {state.phase === "error" ? (
          <TriangleAlert size={22} aria-hidden="true" />
        ) : (
          <PlugZap size={22} aria-hidden="true" />
        )}
      </div>

      <div className="connection-summary-grid">
        <div className="connection-summary-item">
          <span>Relay</span>
          <strong>{state.relayConnectionState.replaceAll("_", " ")}</strong>
        </div>
        <div className="connection-summary-item">
          <span>Fast path</span>
          <strong style={{ color: state.trustedDevices.some(d => d.online && d.localFastPathAvailable) ? "#10b981" : "inherit" }}>
            {state.trustedDevices.some(d => d.online && d.localFastPathAvailable) ? "Available" : "Relay fallback"}
          </strong>
        </div>
        <div className="connection-summary-item">
          <span>Trusted online</span>
          <strong>{onlineCount} / {state.trustedDevices.length}</strong>
        </div>
      </div>

      <label className="relay-url-field connection-relay-field">
        <span>Windows relay URL</span>
        <input
          type="url"
          value={state.relayUrl}
          onChange={(event) => onRelayUrlChange(event.target.value)}
          spellCheck={false}
        />
      </label>

      {state.error ? <p className="error-note">{state.error}</p> : null}

      <button
        className="secondary-action"
        type="button"
        onClick={onReconnect}
        disabled={!hasTrustedDevices || busy}
      >
        {busy ? <RotateCw size={16} aria-hidden="true" /> : <Link size={16} aria-hidden="true" />}
        Reconnect
      </button>
    </section>
  );
}
