import { WebSocket } from "ws";
import type { DeviceIdentity } from "@crossbridge/protocol";

export interface RelayClient {
  deviceId: string;
  socket: WebSocket;
  connectedAt: number;
  lastSeenAt: number;
  deviceIdentity?: DeviceIdentity;
  trustedPeerIds: Set<string>;
}

export class ConnectionManager {
  private readonly clients = new Map<string, RelayClient>();

  register(client: RelayClient): void {
    const existing = this.clients.get(client.deviceId);
    if (existing && existing.socket !== client.socket) {
      existing.socket.close(4001, "Replaced by a new CrossBridge session");
    }

    this.clients.set(client.deviceId, client);
  }

  unregister(deviceId: string, socket?: WebSocket): void {
    const existing = this.clients.get(deviceId);
    if (!existing) return;
    if (socket && existing.socket !== socket) return;
    this.clients.delete(deviceId);
  }

  get(deviceId: string): RelayClient | undefined {
    return this.clients.get(deviceId);
  }

  touch(deviceId: string, now = Date.now()): void {
    const client = this.clients.get(deviceId);
    if (client) {
      client.lastSeenAt = now;
    }
  }

  updateTrustedPresence(
    deviceId: string,
    deviceIdentity: DeviceIdentity,
    trustedPeerIds: Iterable<string>,
    now = Date.now()
  ): RelayClient | undefined {
    const client = this.clients.get(deviceId);
    if (!client) return undefined;

    client.deviceIdentity = deviceIdentity;
    client.trustedPeerIds = new Set(
      [...trustedPeerIds]
        .map((peerId) => peerId.trim())
        .filter((peerId) => peerId.length > 0 && peerId !== deviceId)
    );
    client.lastSeenAt = now;
    return client;
  }

  listClients(): RelayClient[] {
    return [...this.clients.values()];
  }

  listDeviceIds(): string[] {
    return [...this.clients.keys()].sort();
  }

  size(): number {
    return this.clients.size;
  }
}
