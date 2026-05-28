import { Link, Smartphone, Trash2, Zap } from "lucide-react";
import type { TrustedDeviceConnection } from "../services/connectionManager.js";

interface TrustedDeviceCardProps {
  connection: TrustedDeviceConnection;
  onReconnect: () => void;
  onRemove: (deviceId: string) => void;
}

function formatTimestamp(timestamp?: number): string {
  if (!timestamp) return "Not seen yet";
  return new Date(timestamp).toLocaleString([], {
    hour: "2-digit",
    minute: "2-digit",
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

export function TrustedDeviceCard({ connection, onReconnect, onRemove }: TrustedDeviceCardProps) {
  const { device } = connection;

  return (
    <article className="trusted-device-card">
      <div className="trusted-device-main">
        <div className="device-icon">
          <Smartphone size={20} aria-hidden="true" />
        </div>
        <div>
          <h3>{device.deviceName}</h3>
          <p>{device.platform}</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
          <span className={connection.online ? "device-state online" : "device-state"}>
            {connection.online ? "Online" : "Offline"}
          </span>
          {connection.online && connection.localFastPathAvailable && (
            <span className="fast-path-pill" style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: "2px 8px",
              fontSize: "0.75rem",
              background: "rgba(16, 185, 129, 0.15)",
              color: "#10b981",
              borderRadius: "6px",
              fontWeight: 600,
              border: "1px solid rgba(16, 185, 129, 0.3)"
            }}>
              <Zap size={10} fill="#10b981" />
              Fast Path
            </span>
          )}
        </div>
      </div>
      <dl className="device-details">
        <div>
          <dt>Device ID</dt>
          <dd>{device.deviceId}</dd>
        </div>
        <div>
          <dt>Paired</dt>
          <dd>{formatTimestamp(device.pairedAt)}</dd>
        </div>
        <div>
          <dt>Last seen</dt>
          <dd>{formatTimestamp(connection.lastSeenAt ?? device.lastSeenAt)}</dd>
        </div>
      </dl>
      <div className="device-actions">
        <button className="secondary-action" type="button" onClick={onReconnect}>
          <Link size={16} aria-hidden="true" />
          Reconnect
        </button>
        <button className="secondary-action remove-device-button" type="button" onClick={() => onRemove(device.deviceId)}>
          <Trash2 size={16} aria-hidden="true" />
          Remove
        </button>
      </div>
    </article>
  );
}
