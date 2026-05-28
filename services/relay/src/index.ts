import Fastify from "fastify";
import {
  MessageType,
  PairingControlMessageSchema,
  TrustedDeviceHelloMessageSchema,
  parseEncryptedEnvelope
} from "@crossbridge/protocol";
import type { IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { loadConfig, type RelayConfig } from "./config.js";
import { PairingSessionError, PairingSessionManager } from "./pairing/pairingSessions.js";
import { RateLimiter } from "./security/rateLimit.js";
import { isSessionTokenAccepted, safeJsonParse } from "./security/validation.js";
import { RelayHelloSchema } from "./types/protocol.js";
import { ConnectionManager, type RelayClient } from "./websocket/connectionManager.js";
import { attachHeartbeat } from "./websocket/heartbeat.js";
import {
  announceTrustedDeviceOffline,
  announceTrustedDeviceOnline,
  routeEncryptedEnvelope
} from "./websocket/messageRouter.js";

function sendJson(socket: RelayClient["socket"], payload: unknown): void {
  socket.send(JSON.stringify(payload));
}

function sendProtocolError(socket: RelayClient["socket"], message: string): void {
  sendJson(socket, {
    type: "RELAY_ERROR",
    message
  });
}

function relayUrlFromRequest(request: IncomingMessage, config: RelayConfig): string {
  if (config.publicRelayUrl) return config.publicRelayUrl;
  const host = request.headers.host ?? `${config.host}:${config.port}`;
  const encrypted = Boolean((request.socket as { encrypted?: boolean }).encrypted);
  const protocol = encrypted ? "wss" : "ws";
  return `${protocol}://${host}/connect`;
}

function isOpen(client: RelayClient | undefined): client is RelayClient {
  return client?.socket.readyState === WebSocket.OPEN;
}

export async function createRelayServer(config: RelayConfig = loadConfig()) {
  const app = Fastify({ logger: true });
  const manager = new ConnectionManager();
  const pairingManager = new PairingSessionManager({ ttlMs: config.pairingSessionTtlMs });
  const limiter = new RateLimiter({ windowMs: 10_000, maxEvents: 200 });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: config.maxPayloadBytes
  });
  const stopHeartbeat = attachHeartbeat(wss, config.heartbeatIntervalMs);
  const pairingCleanupTimer = setInterval(() => {
    pairingManager.cleanup();
  }, config.pairingCleanupIntervalMs ?? 30_000);
  pairingCleanupTimer.unref();

  app.get("/health", async () => ({
    ok: true,
    onlineDevices: manager.size()
  }));

  app.server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname !== "/connect") {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (socket, request) => {
    let client: RelayClient | undefined;

    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        sendProtocolError(socket, "Binary relay chunks are not enabled in this milestone.");
        return;
      }

      const parsed = safeJsonParse(data.toString());

      if (!client) {
        const hello = RelayHelloSchema.safeParse(parsed);
        if (!hello.success) {
          sendProtocolError(socket, "Send RELAY_HELLO before encrypted messages.");
          socket.close(4400, "Invalid relay hello");
          return;
        }

        if (!isSessionTokenAccepted(hello.data.sessionToken, config.sessionTokenMinLength)) {
          sendProtocolError(socket, "Relay session token was rejected.");
          socket.close(4401, "Invalid relay session token");
          return;
        }

        client = {
          deviceId: hello.data.deviceId,
          socket,
          connectedAt: Date.now(),
          lastSeenAt: Date.now(),
          trustedPeerIds: new Set()
        };
        manager.register(client);
        sendJson(socket, {
          type: "RELAY_WELCOME",
          deviceId: client.deviceId,
          protocolVersion: 1
        });
        return;
      }

      if (!limiter.isAllowed(client.deviceId)) {
        sendProtocolError(socket, "Too many relay messages. Try again shortly.");
        return;
      }

      const trustedHelloResult = TrustedDeviceHelloMessageSchema.safeParse(parsed);
      if (trustedHelloResult.success) {
        const { deviceIdentity, trustedPeerIds } = trustedHelloResult.data.payload;
        if (deviceIdentity.deviceId !== client.deviceId) {
          sendProtocolError(socket, "Trusted-device identity does not match this relay session.");
          return;
        }

        manager.updateTrustedPresence(client.deviceId, deviceIdentity, trustedPeerIds);
        announceTrustedDeviceOnline(manager, client);
        return;
      }

      const pairingResult = PairingControlMessageSchema.safeParse(parsed);
      if (pairingResult.success) {
        const pairingMessage = pairingResult.data;

        try {
          if (pairingMessage.type === MessageType.PAIRING_SESSION_CREATE) {
            const { deviceIdentity } = pairingMessage.payload;
            if (deviceIdentity.deviceId !== client.deviceId) {
              sendProtocolError(socket, "Pairing identity does not match this relay session.");
              return;
            }

            const { qrPayload } = pairingManager.createSession(
              deviceIdentity,
              relayUrlFromRequest(request, config)
            );
            sendJson(socket, {
              type: MessageType.PAIRING_SESSION_CREATED,
              payload: { qrPayload }
            });
            return;
          }

          if (pairingMessage.type === MessageType.PAIRING_JOIN) {
            const { pairingSessionId, pairingToken, deviceIdentity } = pairingMessage.payload;
            if (deviceIdentity.deviceId !== client.deviceId) {
              sendProtocolError(socket, "Pairing identity does not match this relay session.");
              return;
            }

            const { session, verificationCode } = pairingManager.joinSession(
              pairingSessionId,
              pairingToken,
              deviceIdentity
            );
            const joinedMessage = {
              type: MessageType.PAIRING_JOINED,
              payload: {
                pairingSessionId,
                pcIdentity: session.pcIdentity,
                androidIdentity: deviceIdentity,
                verificationCode
              }
            };
            const pcClient = manager.get(session.pcIdentity.deviceId);
            if (isOpen(pcClient)) {
              sendJson(pcClient.socket, joinedMessage);
            }
            sendJson(socket, joinedMessage);
            return;
          }

          if (pairingMessage.type === MessageType.PAIRING_CONFIRM) {
            const { pairingSessionId, deviceId } = pairingMessage.payload;
            if (deviceId !== client.deviceId) {
              sendProtocolError(socket, "Pairing confirmation does not match this relay session.");
              return;
            }

            const result = pairingManager.confirmPairing(pairingSessionId, deviceId);
            if (result.complete) {
              const completeMessage = {
                type: MessageType.PAIRING_COMPLETE,
                payload: result.payload
              };
              const recipientIds = new Set(result.payload.trustedDevices.map((device) => device.deviceId));
              for (const recipientId of recipientIds) {
                const recipient = manager.get(recipientId);
                if (isOpen(recipient)) {
                  sendJson(recipient.socket, completeMessage);
                }
              }
            }
            return;
          }
        } catch (error) {
          if (error instanceof PairingSessionError) {
            const pairingSessionId = "pairingSessionId" in pairingMessage.payload
              ? pairingMessage.payload.pairingSessionId
              : undefined;
            const session = pairingSessionId ? pairingManager.get(pairingSessionId) : undefined;
            if (
              error.code === "PAIRING_SESSION_EXPIRED" &&
              pairingSessionId &&
              session
            ) {
              sendJson(socket, {
                type: MessageType.PAIRING_EXPIRED,
                payload: {
                  pairingSessionId,
                  expiresAt: session.expiresAt
                }
              });
              return;
            }
            sendProtocolError(socket, error.message);
            return;
          }

          sendProtocolError(socket, "Pairing message could not be processed.");
          return;
        }
      }

      const envelopeResult = (() => {
        try {
          return { ok: true as const, envelope: parseEncryptedEnvelope(parsed) };
        } catch {
          return { ok: false as const };
        }
      })();

      if (!envelopeResult.ok) {
        sendProtocolError(socket, "Encrypted relay envelope is invalid.");
        return;
      }

      if (envelopeResult.envelope.fromDeviceId !== client.deviceId) {
        sendProtocolError(socket, "Envelope sender does not match this relay session.");
        return;
      }

      const route = routeEncryptedEnvelope(manager, client, envelopeResult.envelope);
      sendJson(socket, {
        type: "RELAY_ACK",
        messageId: envelopeResult.envelope.messageId,
        delivered: route.delivered,
        reason: route.reason
      });
    });

    socket.on("close", () => {
      if (client) {
        announceTrustedDeviceOffline(manager, client);
        manager.unregister(client.deviceId, socket);
      }
    });
  });

  return {
    app,
    manager,
    pairingManager,
    wss,
    async start() {
      await app.listen({ host: config.host, port: config.port });
      app.log.info(`[CrossBridge Relay] Server is running at http://${config.host}:${config.port}`);
      app.log.info(`[CrossBridge Relay] WebSocket connect path: ws://${config.host}:${config.port}/connect`);
      app.log.info(`[CrossBridge Relay] Health check endpoint: http://${config.host}:${config.port}/health`);
    },
    async stop() {
      stopHeartbeat();
      clearInterval(pairingCleanupTimer);
      wss.close();
      await app.close();
    }
  };
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  const relay = await createRelayServer();
  await relay.start();
}
