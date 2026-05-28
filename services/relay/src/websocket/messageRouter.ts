import { MessageType, type EncryptedEnvelopeInput } from "@crossbridge/protocol";
import { WebSocket } from "ws";
import type { ConnectionManager, RelayClient } from "./connectionManager.js";

export interface RouteResult {
  delivered: boolean;
  reason?: "DEVICE_OFFLINE" | "SOCKET_CLOSED" | "UNTRUSTED_DEVICE";
}

export function routeEncryptedEnvelope(
  manager: ConnectionManager,
  sender: RelayClient,
  envelope: EncryptedEnvelopeInput
): RouteResult {
  sender.lastSeenAt = Date.now();

  const recipient = manager.get(envelope.toDeviceId);
  if (!recipient) {
    return { delivered: false, reason: "DEVICE_OFFLINE" };
  }

  if (
    !sender.trustedPeerIds.has(envelope.toDeviceId) ||
    !recipient.trustedPeerIds.has(envelope.fromDeviceId)
  ) {
    return { delivered: false, reason: "UNTRUSTED_DEVICE" };
  }

  if (recipient.socket.readyState !== WebSocket.OPEN) {
    manager.unregister(recipient.deviceId, recipient.socket);
    return { delivered: false, reason: "SOCKET_CLOSED" };
  }

  recipient.socket.send(JSON.stringify(envelope));
  return { delivered: true };
}

function sendJson(client: RelayClient, payload: unknown): boolean {
  if (client.socket.readyState !== WebSocket.OPEN) return false;
  client.socket.send(JSON.stringify(payload));
  return true;
}

export function announceTrustedDeviceOnline(
  manager: ConnectionManager,
  sender: RelayClient,
  now = Date.now()
): void {
  if (!sender.deviceIdentity) return;

  for (const trustedPeerId of sender.trustedPeerIds) {
    const peer = manager.get(trustedPeerId);
    if (!peer || peer.socket.readyState !== WebSocket.OPEN || !peer.deviceIdentity) continue;

    sendJson(sender, {
      type: MessageType.TRUSTED_DEVICE_ONLINE,
      payload: {
        deviceIdentity: peer.deviceIdentity,
        connectionMode: "relay",
        timestamp: now
      }
    });

    if (peer.trustedPeerIds.has(sender.deviceId)) {
      sendJson(peer, {
        type: MessageType.TRUSTED_DEVICE_ONLINE,
        payload: {
          deviceIdentity: sender.deviceIdentity,
          connectionMode: "relay",
          timestamp: now
        }
      });
    }
  }
}

export function announceTrustedDeviceOffline(
  manager: ConnectionManager,
  offlineClient: RelayClient,
  now = Date.now()
): void {
  for (const client of manager.listClients()) {
    if (client.deviceId === offlineClient.deviceId) continue;
    if (!client.trustedPeerIds.has(offlineClient.deviceId)) continue;

    sendJson(client, {
      type: MessageType.TRUSTED_DEVICE_OFFLINE,
      payload: {
        deviceId: offlineClient.deviceId,
        timestamp: now
      }
    });
  }
}
