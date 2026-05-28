import { Smartphone, TriangleAlert } from "lucide-react";
import { TrustedDeviceCard } from "../components/TrustedDeviceCard.js";
import type { ConnectionViewState } from "../services/connectionManager.js";

interface DevicesPageProps {
  connectionState: ConnectionViewState;
  onReconnect: () => void;
  onRemoveDevice: (deviceId: string) => void;
}

export function DevicesPage({
  connectionState,
  onReconnect,
  onRemoveDevice
}: DevicesPageProps) {
  const devices = connectionState.trustedDevices;

  if (connectionState.error) {
    return (
      <section className="page">
        <div className="empty-state">
          <TriangleAlert size={32} aria-hidden="true" />
          <h2>Connection unavailable</h2>
          <p>{connectionState.error}</p>
        </div>
      </section>
    );
  }

  if (devices.length === 0) {
    return (
      <section className="page">
        <div className="empty-state">
          <Smartphone size={32} aria-hidden="true" />
          <h2>No trusted devices yet</h2>
          <p>No trusted devices yet. Pair your Android phone to begin.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="page devices-page">
      <div className="section-heading">
        <div>
          <h2>Trusted devices</h2>
          <p>Android phones saved after relay pairing appear here with current relay presence.</p>
        </div>
        <button className="secondary-action" type="button" onClick={onReconnect}>
          Reconnect
        </button>
      </div>
      <div className="trusted-device-grid">
        {devices.map((connection) => (
          <TrustedDeviceCard
            key={connection.device.deviceId}
            connection={connection}
            onReconnect={onReconnect}
            onRemove={onRemoveDevice}
          />
        ))}
      </div>
    </section>
  );
}
