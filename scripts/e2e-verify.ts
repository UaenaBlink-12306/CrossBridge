/**
 * CrossBridge E2E Verification Script
 *
 * Simulates a full pairing + text/link sharing flow between
 * a mock Android client and the real relay server.
 *
 * Usage: npx tsx scripts/e2e-verify.ts
 */

import { WebSocket } from "ws";
import {
  decryptAppMessage,
  encryptAppMessage,
  generateDevelopmentKeyPair,
  type DevelopmentKeyPair,
  type EncryptedEnvelope,
  type SecureAppMessage
} from "@crossbridge/crypto";
import {
  createFileAcceptEnvelope,
  createFileCancelEnvelope,
  createFileChunkEnvelope,
  createFileCompleteEnvelope,
  createFileOfferEnvelope,
  createFileProgressEnvelope,
  createFileRejectEnvelope,
  decodeFileTransferEnvelope,
  reassembleTransferredFile,
  type FileChunkPayload
} from "../apps/windows/src/services/fileTransferClient.js";

// ── Types ──────────────────────────────────────────────────────────────

interface DeviceIdentity {
  deviceId: string;
  deviceName: string;
  platform: "android" | "windows";
  publicKey: string;
}

interface PairingQrPayload {
  protocol: "crossbridge-v1";
  pairingSessionId: string;
  relayUrl: string;
  pcDeviceId: string;
  pcDeviceName: string;
  pcPublicKey: string;
  pairingToken: string;
  expiresAt: number;
}

// ── Config ─────────────────────────────────────────────────────────────

const RELAY_URL = process.env.CROSSBRIDGE_RELAY_URL ?? "ws://127.0.0.1:8787/connect";
let ANDROID_IDENTITY: DeviceIdentity;
let WINDOWS_IDENTITY: DeviceIdentity;
let androidKeys: DevelopmentKeyPair;
let windowsKeys: DevelopmentKeyPair;
const TEXT_PAYLOAD = "Hello from E2E test!";
const URL_PAYLOAD = "https://github.com/UaenaBlink-12306/CrossBridge";
const FILE_PAYLOAD = new TextEncoder().encode("CrossBridge encrypted E2E file payload");

// ── Message-collecting socket wrapper ──────────────────────────────────

class TestSocket {
  private readonly socket: WebSocket;
  private readonly messages: unknown[] = [];
  private readonly resolvers = new Map<string, Array<(msg: unknown) => void>>();

  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.messages.push(msg);
        // Notify any waiting resolvers
        if (typeof msg === "object" && msg !== null && "type" in msg) {
          const type = String(msg.type);
          const waiting = this.resolvers.get(type);
          if (waiting) {
            const resolver = waiting.shift();
            if (resolver) resolver(msg);
          }
        }
      } catch { /* ignore non-JSON */ }
    });
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.socket.close();
  }

  /** Wait for a message with the given type field, with optional filter. */
  waitForType<T>(type: string, timeoutMs = 20_000, filter?: (msg: unknown) => boolean): Promise<T> {
    // Check already-buffered messages first
    for (let i = 0; i < this.messages.length; i++) {
      const msg = this.messages[i];
      if (typeof msg === "object" && msg !== null && "type" in msg && (msg as { type: string }).type === type) {
        if (filter && !filter(msg)) continue;
        this.messages.splice(i, 1);
        return Promise.resolve(msg as T);
      }
    }
    // Not found — wait for future message
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const arr = this.resolvers.get(type);
        if (arr) {
          const idx = arr.indexOf(resolve as (msg: unknown) => void);
          if (idx >= 0) arr.splice(idx, 1);
        }
        reject(new Error(`Timed out waiting for ${type}`));
      }, timeoutMs);

      const wrappedResolve = (msg: unknown) => {
        if (filter && !filter(msg)) {
          // Not the right one — re-queue it for other resolvers
          let arr = this.resolvers.get(type);
          if (!arr) {
            arr = [];
            this.resolvers.set(type, arr);
          }
          arr.push(wrappedResolve);
          return;
        }
        clearTimeout(timer);
        resolve(msg as T);
      };

      let arr = this.resolvers.get(type);
      if (!arr) {
        arr = [];
        this.resolvers.set(type, arr);
      }
      arr.push(wrappedResolve);
    });
  }

  /** Drain all buffered messages (useful between test steps). */
  drain(): void {
    this.messages.length = 0;
  }

  /** Wait for an encrypted envelope (version=1, has ciphertext) with optional filter. */
  waitForEnvelope(timeoutMs = 20_000, filter?: (envelope: Record<string, unknown>) => Promise<boolean>): Promise<Record<string, unknown>> {
    // Check already-buffered messages first
    const buffered = async () => {
    for (let i = 0; i < this.messages.length; i++) {
      const msg = this.messages[i] as Record<string, unknown>;
      if (msg.version === 1 && typeof msg.ciphertext === "string") {
        if (filter && !(await filter(msg))) continue;
        this.messages.splice(i, 1);
        return msg;
      }
    }
    return undefined;
    };
    return buffered().then((found) => {
      if (found) return found;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.socket.off("message", handler);
        reject(new Error("Timed out waiting for encrypted envelope"));
      }, timeoutMs);

      const handler = (data: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(data.toString()) as Record<string, unknown>;
          if (msg.version === 1 && typeof msg.ciphertext === "string") {
            void (async () => {
              if (filter && !(await filter(msg))) return;
              this.socket.off("message", handler);
              clearTimeout(timer);
              resolve(msg);
            })();
          }
        } catch { /* ignore */ }
      };
      this.socket.on("message", handler);
    });
    });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    testsPassed++;
    console.log(`  ✅ PASS: ${label}`);
  } else {
    testsFailed++;
    console.log(`  ❌ FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function connectAndHello(relayUrl: string, deviceId: string): Promise<TestSocket> {
  const raw = new WebSocket(relayUrl);
  await new Promise<void>((resolve, reject) => {
    raw.once("open", resolve);
    raw.once("error", reject);
  });
  const socket = new TestSocket(raw);
  socket.send({
    type: "RELAY_HELLO",
    deviceId,
    sessionToken: `token_e2e_${Date.now()}`,
    protocolVersion: 1
  });
  await socket.waitForType("RELAY_WELCOME");
  return socket;
}

function randomToken(): string {
  const bytes = new Uint8Array(18);
  globalThis.crypto?.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `share_${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
}

function detectContentType(text: string): "text" | "url" {
  try {
    const url = new URL(text.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? "url" : "text";
  } catch {
    return "text";
  }
}

async function createTextShareEnvelope(
  fromDeviceId: string,
  toDeviceId: string,
  text: string,
  senderKeys: DevelopmentKeyPair,
  peerPublicKey: string
): Promise<{ envelope: EncryptedEnvelope; shareId: string }> {
  const shareId = randomToken();
  const messageId = randomToken();
  const contentType = detectContentType(text);
  const now = Date.now();

  const appMessage: SecureAppMessage = {
    version: 1,
    id: messageId,
    type: "TEXT_SHARE",
    timestamp: now,
    fromDeviceId,
    toDeviceId,
    payload: {
      shareId,
      fromDeviceId,
      toDeviceId,
      contentType,
      text,
      createdAt: now
    }
  };

  return {
    envelope: await encryptAppMessage({
      message: appMessage,
      localPrivateKey: senderKeys.privateKey,
      localPublicKey: senderKeys.publicKey,
      peerPublicKey
    }),
    shareId
  };
}

async function createTextShareAckEnvelope(
  fromDeviceId: string,
  toDeviceId: string,
  shareId: string,
  senderKeys: DevelopmentKeyPair,
  peerPublicKey: string
): Promise<EncryptedEnvelope> {
  const messageId = randomToken();
  const now = Date.now();

  return encryptAppMessage({
    message: {
      version: 1,
      id: messageId,
      type: "TEXT_SHARE_ACK",
      timestamp: now,
      fromDeviceId,
      toDeviceId,
      payload: {
      shareId,
      fromDeviceId,
      toDeviceId,
        receivedAt: now
      }
    },
    localPrivateKey: senderKeys.privateKey,
    localPublicKey: senderKeys.publicKey,
    peerPublicKey
  });
}

async function createNotificationPostedEnvelope(
  fromDeviceId: string,
  toDeviceId: string,
  senderKeys: DevelopmentKeyPair,
  peerPublicKey: string
): Promise<EncryptedEnvelope> {
  const messageId = randomToken();
  const now = Date.now();

  return encryptAppMessage({
    message: {
      version: 1,
      id: messageId,
      type: "NOTIFICATION_POSTED",
      timestamp: now,
      fromDeviceId,
      toDeviceId,
      payload: {
        notificationId: "e2e_notification_1",
        packageName: "com.example.calendar",
        appName: "Calendar",
        title: "Standup",
        text: "Daily sync in 10 minutes",
        subText: null,
        postTime: now,
        canDismiss: true,
        actions: [
          {
            actionId: "action_0",
            title: "Reply",
            supportsRemoteInput: true
          }
        ]
      }
    },
    localPrivateKey: senderKeys.privateKey,
    localPublicKey: senderKeys.publicKey,
    peerPublicKey
  });
}

async function createNotificationDismissEnvelope(
  fromDeviceId: string,
  toDeviceId: string,
  senderKeys: DevelopmentKeyPair,
  peerPublicKey: string,
  notificationId = "e2e_notification_1"
): Promise<EncryptedEnvelope> {
  const messageId = randomToken();
  const now = Date.now();

  return encryptAppMessage({
    message: {
      version: 1,
      id: messageId,
      type: "NOTIFICATION_DISMISS",
      timestamp: now,
      fromDeviceId,
      toDeviceId,
      payload: {
        notificationId
      }
    },
    localPrivateKey: senderKeys.privateKey,
    localPublicKey: senderKeys.publicKey,
    peerPublicKey
  });
}

async function createNotificationDismissResultEnvelope(
  fromDeviceId: string,
  toDeviceId: string,
  senderKeys: DevelopmentKeyPair,
  peerPublicKey: string,
  notificationId = "e2e_notification_1"
): Promise<EncryptedEnvelope> {
  const messageId = randomToken();
  const now = Date.now();

  return encryptAppMessage({
    message: {
      version: 1,
      id: messageId,
      type: "NOTIFICATION_DISMISS_RESULT",
      timestamp: now,
      fromDeviceId,
      toDeviceId,
      payload: {
        notificationId,
        dismissed: true,
        errorCode: null,
        message: null
      }
    },
    localPrivateKey: senderKeys.privateKey,
    localPublicKey: senderKeys.publicKey,
    peerPublicKey
  });
}

async function createNotificationReplyEnvelope(
  fromDeviceId: string,
  toDeviceId: string,
  senderKeys: DevelopmentKeyPair,
  peerPublicKey: string,
  notificationId = "e2e_notification_1",
  actionId = "action_0",
  replyText = "Reply from Windows"
): Promise<EncryptedEnvelope> {
  const messageId = randomToken();
  const now = Date.now();

  return encryptAppMessage({
    message: {
      version: 1,
      id: messageId,
      type: "NOTIFICATION_REPLY",
      timestamp: now,
      fromDeviceId,
      toDeviceId,
      payload: {
        notificationId,
        actionId,
        replyText
      }
    },
    localPrivateKey: senderKeys.privateKey,
    localPublicKey: senderKeys.publicKey,
    peerPublicKey
  });
}

async function createNotificationReplyResultEnvelope(
  fromDeviceId: string,
  toDeviceId: string,
  senderKeys: DevelopmentKeyPair,
  peerPublicKey: string,
  notificationId = "e2e_notification_1",
  actionId = "action_0"
): Promise<EncryptedEnvelope> {
  const messageId = randomToken();
  const now = Date.now();

  return encryptAppMessage({
    message: {
      version: 1,
      id: messageId,
      type: "NOTIFICATION_REPLY_RESULT",
      timestamp: now,
      fromDeviceId,
      toDeviceId,
      payload: {
        notificationId,
        actionId,
        replied: true,
        errorCode: null,
        message: "Reply sent on Android."
      }
    },
    localPrivateKey: senderKeys.privateKey,
    localPublicKey: senderKeys.publicKey,
    peerPublicKey
  });
}

async function decodeShareEnvelope(
  envelope: unknown,
  recipientDeviceId: string,
  recipientKeys: DevelopmentKeyPair,
  senderPublicKey: string
): Promise<{ controlMessage: unknown; fromDeviceId: string; toDeviceId: string; messageId: string } | null> {
  try {
    const e = envelope as EncryptedEnvelope;
    const decoded = await decryptAppMessage({
      envelope: e,
      localDeviceId: recipientDeviceId,
      localPrivateKey: recipientKeys.privateKey,
      localPublicKey: recipientKeys.publicKey,
      peerPublicKey: senderPublicKey
    });
    return {
      controlMessage: {
        type: decoded.type,
        payload: decoded.payload
      },
      fromDeviceId: e.fromDeviceId,
      toDeviceId: e.toDeviceId,
      messageId: e.messageId
    };
  } catch {
    return null;
  }
}

function isBase64Json(ciphertext: string): boolean {
  try {
    JSON.parse(Buffer.from(ciphertext, "base64").toString("utf-8"));
    return true;
  } catch {
    return false;
  }
}

async function isNotificationTypeFor(
  envelope: Record<string, unknown>,
  recipientDeviceId: string,
  recipientKeys: DevelopmentKeyPair,
  senderPublicKey: string,
  type: string
): Promise<boolean> {
  const decoded = await decodeShareEnvelope(envelope, recipientDeviceId, recipientKeys, senderPublicKey);
  const control = decoded?.controlMessage as { type?: string } | undefined;
  return control?.type === type;
}

async function isTextShareFor(
  envelope: Record<string, unknown>,
  recipientDeviceId: string,
  recipientKeys: DevelopmentKeyPair,
  senderPublicKey: string
): Promise<boolean> {
  const decoded = await decodeShareEnvelope(envelope, recipientDeviceId, recipientKeys, senderPublicKey);
  const control = decoded?.controlMessage as { type?: string } | undefined;
  return control?.type === "TEXT_SHARE";
}

async function isFileTransferFor(
  envelope: Record<string, unknown>,
  recipientDeviceId: string,
  recipientKeys: DevelopmentKeyPair,
  senderPublicKey: string,
  type: string,
  transferId?: string
): Promise<boolean> {
  const decoded = await decodeFileTransferEnvelope({
    envelope,
    localDeviceId: recipientDeviceId,
    localPrivateKey: recipientKeys.privateKey,
    localPublicKey: recipientKeys.publicKey,
    peerPublicKey: senderPublicKey
  });
  const control = decoded?.controlMessage as { type?: string; payload?: { transferId?: string } } | undefined;
  return control?.type === type && (!transferId || control.payload?.transferId === transferId);
}

async function isFileProgressForBytes(
  envelope: Record<string, unknown>,
  recipientDeviceId: string,
  recipientKeys: DevelopmentKeyPair,
  senderPublicKey: string,
  transferId: string,
  bytesTransferred: number
): Promise<boolean> {
  const decoded = await decodeFileTransferEnvelope({
    envelope,
    localDeviceId: recipientDeviceId,
    localPrivateKey: recipientKeys.privateKey,
    localPublicKey: recipientKeys.publicKey,
    peerPublicKey: senderPublicKey
  });
  const control = decoded?.controlMessage as {
    type?: string;
    payload?: { transferId?: string; bytesTransferred?: number };
  } | undefined;
  return control?.type === "FILE_PROGRESS" &&
    control.payload?.transferId === transferId &&
    control.payload?.bytesTransferred === bytesTransferred;
}

// ── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=== CrossBridge E2E Verification ===\n");
  console.log(`Relay URL: ${RELAY_URL}\n`);
  windowsKeys = await generateDevelopmentKeyPair();
  androidKeys = await generateDevelopmentKeyPair();
  WINDOWS_IDENTITY = {
    deviceId: "windows_e2e_test",
    deviceName: "E2E Windows",
    platform: "windows",
    publicKey: windowsKeys.publicKey
  };
  ANDROID_IDENTITY = {
    deviceId: "android_e2e_test",
    deviceName: "E2E Pixel",
    platform: "android",
    publicKey: androidKeys.publicKey
  };

  // ─── Step 1: Check relay health ─────────────────────────────────────
  console.log("── Step 1: Relay health check ──");
  const healthUrl = (() => {
    try {
      const parsed = new URL(RELAY_URL);
      parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
      parsed.pathname = "/health";
      return parsed.toString();
    } catch {
      return "http://127.0.0.1:8787/health";
    }
  })();
  try {
    const healthResp = await fetch(healthUrl);
    const health = await healthResp.json() as { ok: boolean; onlineDevices: number };
    assert(health.ok === true, "Relay /health returns ok");
    console.log(`  Online devices: ${health.onlineDevices}`);
  } catch (err) {
    console.log(`  ❌ Relay health check failed: ${err}`);
    process.exitCode = 1;
    return;
  }

  // ─── Step 2: Windows-side pairing session ───────────────────────────
  console.log("\n── Step 2: Create pairing session (Windows side) ──");
  const windows = await connectAndHello(RELAY_URL, WINDOWS_IDENTITY.deviceId);

  windows.send({
    type: "PAIRING_SESSION_CREATE",
    payload: {
      deviceIdentity: WINDOWS_IDENTITY
    }
  });

  const sessionCreated = await windows.waitForType<{
    type: "PAIRING_SESSION_CREATED";
    payload: { qrPayload: PairingQrPayload };
  }>("PAIRING_SESSION_CREATED");

  const qrPayload = sessionCreated.payload.qrPayload;
  assert(!!qrPayload.pairingSessionId, "Pairing session created with ID", qrPayload.pairingSessionId);
  assert(qrPayload.protocol === "crossbridge-v1", "QR payload has correct protocol");
  assert(qrPayload.pcDeviceId === WINDOWS_IDENTITY.deviceId, "QR payload has correct PC device ID");

  // ─── Step 3: Android-side pairing join ──────────────────────────────
  console.log("\n── Step 3: Android joins pairing ──");
  const android = await connectAndHello(RELAY_URL, ANDROID_IDENTITY.deviceId);

  android.send({
    type: "PAIRING_JOIN",
    payload: {
      pairingSessionId: qrPayload.pairingSessionId,
      pairingToken: qrPayload.pairingToken,
      deviceIdentity: ANDROID_IDENTITY
    }
  });

  const windowsJoined = await windows.waitForType<{
    type: "PAIRING_JOINED";
    payload: { verificationCode: string; androidIdentity: DeviceIdentity };
  }>("PAIRING_JOINED");

  const androidJoined = await android.waitForType<{
    type: "PAIRING_JOINED";
    payload: { verificationCode: string };
  }>("PAIRING_JOINED");

  assert(
    windowsJoined.payload.verificationCode === androidJoined.payload.verificationCode,
    "Both sides receive matching verification code",
    `Windows: ${windowsJoined.payload.verificationCode}, Android: ${androidJoined.payload.verificationCode}`
  );
  assert(
    windowsJoined.payload.androidIdentity.deviceId === ANDROID_IDENTITY.deviceId,
    "Windows sees correct Android identity"
  );

  // ─── Step 4: Both confirm pairing ───────────────────────────────────
  console.log("\n── Step 4: Confirm pairing ──");
  windows.send({
    type: "PAIRING_CONFIRM",
    payload: {
      pairingSessionId: qrPayload.pairingSessionId,
      deviceId: WINDOWS_IDENTITY.deviceId
    }
  });

  android.send({
    type: "PAIRING_CONFIRM",
    payload: {
      pairingSessionId: qrPayload.pairingSessionId,
      deviceId: ANDROID_IDENTITY.deviceId
    }
  });

  const windowsComplete = await windows.waitForType<{
    type: "PAIRING_COMPLETE";
    payload: { trustedDevices: Array<{ deviceId: string; platform: string }> };
  }>("PAIRING_COMPLETE");

  const androidComplete = await android.waitForType<{
    type: "PAIRING_COMPLETE";
    payload: { trustedDevices: Array<{ deviceId: string; platform: string }> };
  }>("PAIRING_COMPLETE");

  assert(windowsComplete.payload.trustedDevices.length >= 1, "Windows receives trusted devices list");
  assert(androidComplete.payload.trustedDevices.length >= 1, "Android receives trusted devices list");
  assert(
    windowsComplete.payload.trustedDevices.some((d) => d.platform === "android"),
    "Windows trusted list includes Android"
  );
  assert(
    androidComplete.payload.trustedDevices.some((d) => d.platform === "windows"),
    "Android trusted list includes Windows"
  );

  // ─── Step 5: Send TRUSTED_DEVICE_HELLO ──────────────────────────────
  console.log("\n── Step 5: Announce trusted devices ──");
  // Android sends first so its deviceIdentity is registered on relay,
  // then when Windows sends, relay will notify both sides.
  android.send({
    type: "TRUSTED_DEVICE_HELLO",
    payload: {
      deviceIdentity: ANDROID_IDENTITY,
      trustedPeerIds: [WINDOWS_IDENTITY.deviceId]
    }
  });

  await new Promise((r) => setTimeout(r, 500));

  windows.send({
    type: "TRUSTED_DEVICE_HELLO",
    payload: {
      deviceIdentity: WINDOWS_IDENTITY,
      trustedPeerIds: [ANDROID_IDENTITY.deviceId]
    }
  });

  const windowsOnline = await windows.waitForType<{
    type: "TRUSTED_DEVICE_ONLINE";
    payload: { deviceIdentity: { deviceId: string } };
  }>("TRUSTED_DEVICE_ONLINE");

  const androidOnline = await android.waitForType<{
    type: "TRUSTED_DEVICE_ONLINE";
    payload: { deviceIdentity: { deviceId: string } };
  }>("TRUSTED_DEVICE_ONLINE");

  assert(
    windowsOnline.payload.deviceIdentity.deviceId === ANDROID_IDENTITY.deviceId,
    "Windows sees Android come online"
  );
  assert(
    androidOnline.payload.deviceIdentity.deviceId === WINDOWS_IDENTITY.deviceId,
    "Android sees Windows come online"
  );

  // ─── Step 6: Android → Windows notification mirror ─────────────────
  console.log("\n── Step 6: Android → Windows notification mirror ──");
  const notificationEnvelope = await createNotificationPostedEnvelope(
    ANDROID_IDENTITY.deviceId,
    WINDOWS_IDENTITY.deviceId,
    androidKeys,
    windowsKeys.publicKey
  );
  android.send(notificationEnvelope);
  const windowsNotificationEnvelope = await windows.waitForEnvelope(
    20_000,
    (envelope) => isNotificationTypeFor(
      envelope,
      WINDOWS_IDENTITY.deviceId,
      windowsKeys,
      androidKeys.publicKey,
      "NOTIFICATION_POSTED"
    )
  );
  const decodedNotification = await decodeShareEnvelope(
    windowsNotificationEnvelope,
    WINDOWS_IDENTITY.deviceId,
    windowsKeys,
    androidKeys.publicKey
  );
  const notificationControl = decodedNotification?.controlMessage as {
    type?: string;
    payload?: {
      appName?: string;
      text?: string;
      actions?: Array<{ actionId?: string; supportsRemoteInput?: boolean }>;
    };
  } | undefined;
  assert(notificationControl?.type === "NOTIFICATION_POSTED", "Windows receives notification mirror envelope");
  assert(notificationControl?.payload?.appName === "Calendar", "Notification metadata includes app name");
  assert(notificationControl?.payload?.text === "Daily sync in 10 minutes", "Notification metadata includes text");
  assert(notificationControl?.payload?.actions?.[0]?.actionId === "action_0", "Notification metadata includes reply action ID");
  assert(notificationControl?.payload?.actions?.[0]?.supportsRemoteInput === true, "Notification metadata marks reply support");

  const dismissEnvelope = await createNotificationDismissEnvelope(
    WINDOWS_IDENTITY.deviceId,
    ANDROID_IDENTITY.deviceId,
    windowsKeys,
    androidKeys.publicKey
  );
  windows.send(dismissEnvelope);

  const dismissRelayAck = await windows.waitForType<{
    type: "RELAY_ACK";
    delivered: boolean;
    messageId?: string;
  }>("RELAY_ACK", 20_000, (msg) => {
    const ack = msg as { messageId?: string };
    return ack.messageId === dismissEnvelope.messageId;
  });
  assert(dismissRelayAck.delivered === true, "Windows receives RELAY_ACK delivered=true for notification dismiss");

  const androidDismissEnvelope = await android.waitForEnvelope(
    20_000,
    (envelope) => isNotificationTypeFor(
      envelope,
      ANDROID_IDENTITY.deviceId,
      androidKeys,
      windowsKeys.publicKey,
      "NOTIFICATION_DISMISS"
    )
  );
  const decodedDismiss = await decodeShareEnvelope(
    androidDismissEnvelope,
    ANDROID_IDENTITY.deviceId,
    androidKeys,
    windowsKeys.publicKey
  );
  const dismissControl = decodedDismiss?.controlMessage as {
    type?: string;
    payload?: { notificationId?: string };
  } | undefined;
  assert(dismissControl?.type === "NOTIFICATION_DISMISS", "Android receives notification dismiss request");
  assert(dismissControl?.payload?.notificationId === "e2e_notification_1", "Dismiss request carries the mirrored notification ID");

  const dismissResultEnvelope = await createNotificationDismissResultEnvelope(
    ANDROID_IDENTITY.deviceId,
    WINDOWS_IDENTITY.deviceId,
    androidKeys,
    windowsKeys.publicKey
  );
  android.send(dismissResultEnvelope);

  const windowsDismissResultEnvelope = await windows.waitForEnvelope(
    20_000,
    (envelope) => isNotificationTypeFor(
      envelope,
      WINDOWS_IDENTITY.deviceId,
      windowsKeys,
      androidKeys.publicKey,
      "NOTIFICATION_DISMISS_RESULT"
    )
  );
  const decodedDismissResult = await decodeShareEnvelope(
    windowsDismissResultEnvelope,
    WINDOWS_IDENTITY.deviceId,
    windowsKeys,
    androidKeys.publicKey
  );
  const dismissResultControl = decodedDismissResult?.controlMessage as {
    type?: string;
    payload?: { notificationId?: string; dismissed?: boolean };
  } | undefined;
  assert(dismissResultControl?.type === "NOTIFICATION_DISMISS_RESULT", "Windows receives notification dismiss result");
  assert(dismissResultControl?.payload?.dismissed === true, "Dismiss result confirms Android dismissed the notification");

  const replyEnvelope = await createNotificationReplyEnvelope(
    WINDOWS_IDENTITY.deviceId,
    ANDROID_IDENTITY.deviceId,
    windowsKeys,
    androidKeys.publicKey
  );
  windows.send(replyEnvelope);

  const replyRelayAck = await windows.waitForType<{
    type: "RELAY_ACK";
    delivered: boolean;
    messageId?: string;
  }>("RELAY_ACK", 20_000, (msg) => {
    const ack = msg as { messageId?: string };
    return ack.messageId === replyEnvelope.messageId;
  });
  assert(replyRelayAck.delivered === true, "Windows receives RELAY_ACK delivered=true for notification reply");

  const androidReplyEnvelope = await android.waitForEnvelope(
    20_000,
    (envelope) => isNotificationTypeFor(
      envelope,
      ANDROID_IDENTITY.deviceId,
      androidKeys,
      windowsKeys.publicKey,
      "NOTIFICATION_REPLY"
    )
  );
  const decodedReply = await decodeShareEnvelope(
    androidReplyEnvelope,
    ANDROID_IDENTITY.deviceId,
    androidKeys,
    windowsKeys.publicKey
  );
  const replyControl = decodedReply?.controlMessage as {
    type?: string;
    payload?: { notificationId?: string; actionId?: string; replyText?: string };
  } | undefined;
  assert(replyControl?.type === "NOTIFICATION_REPLY", "Android receives notification reply request");
  assert(replyControl?.payload?.actionId === "action_0", "Reply request carries the reply action ID");
  assert(replyControl?.payload?.replyText === "Reply from Windows", "Reply request carries the Windows reply text");

  const replyResultEnvelope = await createNotificationReplyResultEnvelope(
    ANDROID_IDENTITY.deviceId,
    WINDOWS_IDENTITY.deviceId,
    androidKeys,
    windowsKeys.publicKey
  );
  android.send(replyResultEnvelope);

  const windowsReplyResultEnvelope = await windows.waitForEnvelope(
    20_000,
    (envelope) => isNotificationTypeFor(
      envelope,
      WINDOWS_IDENTITY.deviceId,
      windowsKeys,
      androidKeys.publicKey,
      "NOTIFICATION_REPLY_RESULT"
    )
  );
  const decodedReplyResult = await decodeShareEnvelope(
    windowsReplyResultEnvelope,
    WINDOWS_IDENTITY.deviceId,
    windowsKeys,
    androidKeys.publicKey
  );
  const replyResultControl = decodedReplyResult?.controlMessage as {
    type?: string;
    payload?: { actionId?: string; replied?: boolean; message?: string };
  } | undefined;
  assert(replyResultControl?.type === "NOTIFICATION_REPLY_RESULT", "Windows receives notification reply result");
  assert(replyResultControl?.payload?.replied === true, "Reply result confirms Android sent the reply");
  assert(replyResultControl?.payload?.message === "Reply sent on Android.", "Reply result includes Android status text");

  // ─── Step 7: Windows → Android text share ──────────────────────────
  console.log("\n── Step 7: Windows → Android text share ──");
  const textShare = await createTextShareEnvelope(
    WINDOWS_IDENTITY.deviceId,
    ANDROID_IDENTITY.deviceId,
    TEXT_PAYLOAD,
    windowsKeys,
    androidKeys.publicKey
  );
  windows.send(textShare.envelope);

  // Android receives the envelope (may arrive before Windows gets RELAY_ACK)
  const androidTextEnvelope = await android.waitForEnvelope(
    20_000,
    (envelope) => isTextShareFor(envelope, ANDROID_IDENTITY.deviceId, androidKeys, windowsKeys.publicKey)
  );
  const textRelayAck = await windows.waitForType<{
    type: "RELAY_ACK";
    delivered: boolean;
    reason?: string;
  }>("RELAY_ACK");
  assert(textRelayAck.delivered === true, "Windows receives RELAY_ACK delivered=true for text");
  assert(!isBase64Json(textShare.envelope.ciphertext), "Ciphertext is not Base64-decoded JSON");
  const tampered = {
    ...textShare.envelope,
    ciphertext: `${textShare.envelope.ciphertext.slice(0, -2)}AA`
  };
  assert(
    await decodeShareEnvelope(tampered, ANDROID_IDENTITY.deviceId, androidKeys, windowsKeys.publicKey) === null,
    "Tampered ciphertext is rejected"
  );
  const wrongKeys = await generateDevelopmentKeyPair();
  assert(
    await decodeShareEnvelope(textShare.envelope, ANDROID_IDENTITY.deviceId, wrongKeys, windowsKeys.publicKey) === null,
    "Wrong recipient key is rejected"
  );

  const androidReceivedText = await decodeShareEnvelope(
    androidTextEnvelope,
    ANDROID_IDENTITY.deviceId,
    androidKeys,
    windowsKeys.publicKey
  );
  assert(androidReceivedText !== null, "Android decodes text share envelope");
  if (androidReceivedText) {
    const cm = androidReceivedText.controlMessage as { type: string; payload: { text: string; contentType: string; shareId: string } };
    assert(cm.type === "TEXT_SHARE", "Android received TEXT_SHARE message type");
    assert(cm.payload.text === TEXT_PAYLOAD, "Android received correct text content", `Got: ${cm.payload.text}`);
    assert(cm.payload.contentType === "text", "Content type detected as text");

    // Android sends ACK
    android.send(await createTextShareAckEnvelope(
      ANDROID_IDENTITY.deviceId,
      WINDOWS_IDENTITY.deviceId,
      cm.payload.shareId,
      androidKeys,
      windowsKeys.publicKey
    ));
  }
  // Drain any ACK envelope from Windows side
  await windows.waitForEnvelope(3000).catch(() => {});
  windows.drain();
  android.drain();

  // ─── Step 7: Windows → Android URL share ──────────────────────────
  console.log("\n── Step 7: Windows → Android URL share ──");
  // Drain any pending envelopes
  windows.drain();
  android.drain();
  const urlShare = await createTextShareEnvelope(
    WINDOWS_IDENTITY.deviceId,
    ANDROID_IDENTITY.deviceId,
    URL_PAYLOAD,
    windowsKeys,
    androidKeys.publicKey
  );
  windows.send(urlShare.envelope);

  const androidUrlEnvelope = await android.waitForEnvelope(
    20_000,
    (envelope) => isTextShareFor(envelope, ANDROID_IDENTITY.deviceId, androidKeys, windowsKeys.publicKey)
  );
  const urlRelayAck = await windows.waitForType<{
    type: "RELAY_ACK";
    delivered: boolean;
  }>("RELAY_ACK");
  assert(urlRelayAck.delivered === true, "Windows receives RELAY_ACK delivered=true for URL");

  const androidReceivedUrl = await decodeShareEnvelope(
    androidUrlEnvelope,
    ANDROID_IDENTITY.deviceId,
    androidKeys,
    windowsKeys.publicKey
  );
  assert(androidReceivedUrl !== null, "Android decodes URL share envelope");
  if (androidReceivedUrl) {
    const cm = androidReceivedUrl.controlMessage as { type: string; payload: { text: string; contentType: string } };
    assert(cm.type === "TEXT_SHARE", "Android received URL TEXT_SHARE message type");
    assert(cm.payload.text === URL_PAYLOAD, "Android received correct URL content");
    assert(cm.payload.contentType === "url", "Content type detected as URL");
  }

  // ─── Step 8: Android → Windows text share ──────────────────────────
  console.log("\n── Step 8: Android → Windows text share ──");
  const atextShare = await createTextShareEnvelope(
    ANDROID_IDENTITY.deviceId,
    WINDOWS_IDENTITY.deviceId,
    "Reply from Android",
    androidKeys,
    windowsKeys.publicKey
  );
  android.send(atextShare.envelope);

  // Windows may receive the envelope before Android gets the RELAY_ACK
  const windowsTextEnvelope = await windows.waitForEnvelope(
    20_000,
    (envelope) => isTextShareFor(envelope, WINDOWS_IDENTITY.deviceId, windowsKeys, androidKeys.publicKey)
  );
  const atextRelayAck = await android.waitForType<{
    type: "RELAY_ACK";
    delivered: boolean;
  }>("RELAY_ACK");
  assert(atextRelayAck.delivered === true, "Android receives RELAY_ACK delivered=true for text");

  const windowsReceivedText = await decodeShareEnvelope(
    windowsTextEnvelope,
    WINDOWS_IDENTITY.deviceId,
    windowsKeys,
    androidKeys.publicKey
  );
  assert(windowsReceivedText !== null, "Windows decodes text share envelope from Android");
  if (windowsReceivedText) {
    const cm = windowsReceivedText.controlMessage as { type: string; payload: { text: string; contentType: string } };
    assert(cm.type === "TEXT_SHARE", "Windows received TEXT_SHARE from Android");
    assert(cm.payload.text === "Reply from Android", "Windows received correct text from Android");
    assert(cm.payload.contentType === "text", "Content type detected as text from Android");
  }

  // ─── Step 9: Android → Windows URL share ──────────────────────────
  console.log("\n── Step 9: Android → Windows URL share ──");
  // Drain any pending envelopes
  windows.drain();
  android.drain();
  const aurlShare = await createTextShareEnvelope(
    ANDROID_IDENTITY.deviceId,
    WINDOWS_IDENTITY.deviceId,
    "https://example.com/docs",
    androidKeys,
    windowsKeys.publicKey
  );
  android.send(aurlShare.envelope);

  const windowsUrlEnvelope = await windows.waitForEnvelope(
    20_000,
    (envelope) => isTextShareFor(envelope, WINDOWS_IDENTITY.deviceId, windowsKeys, androidKeys.publicKey)
  );
  const aurlRelayAck = await android.waitForType<{
    type: "RELAY_ACK";
    delivered: boolean;
  }>("RELAY_ACK");
  assert(aurlRelayAck.delivered === true, "Android receives RELAY_ACK delivered=true for URL");

  const windowsReceivedUrl = await decodeShareEnvelope(
    windowsUrlEnvelope,
    WINDOWS_IDENTITY.deviceId,
    windowsKeys,
    androidKeys.publicKey
  );
  assert(windowsReceivedUrl !== null, "Windows decodes URL share envelope from Android");
  if (windowsReceivedUrl) {
    const cm = windowsReceivedUrl.controlMessage as { type: string; payload: { text: string; contentType: string } };
    assert(cm.type === "TEXT_SHARE", "Windows received URL TEXT_SHARE from Android");
    assert(cm.payload.text === "https://example.com/docs", "Windows received correct URL from Android", `Got: ${cm.payload.text}`);
    assert(cm.payload.contentType === "url", "Content type detected as URL from Android", `Got: ${cm.payload.contentType}`);
  }

  // ─── Step 10: Offline behavior ─────────────────────────────────────
  console.log("\n── Step 10: Offline send behavior ──");
  android.close();

  const offlineNotif = await windows.waitForType<{
    type: "TRUSTED_DEVICE_OFFLINE";
    payload: { deviceId: string };
  }>("TRUSTED_DEVICE_OFFLINE");
  assert(offlineNotif.payload.deviceId === ANDROID_IDENTITY.deviceId, "Windows receives Android offline notification");

  // Try sending to offline device
  const offlineShare = await createTextShareEnvelope(
    WINDOWS_IDENTITY.deviceId,
    ANDROID_IDENTITY.deviceId,
    "This should fail",
    windowsKeys,
    androidKeys.publicKey
  );
  windows.send(offlineShare.envelope);

  // Drain any stale RELAY_ACK first, then get the one for this share
  const offlineAck = await windows.waitForType<{
    type: "RELAY_ACK";
    delivered: boolean;
    reason?: string;
    messageId?: string;
  }>("RELAY_ACK");
  // The offline share's messageId should match
  const isForOfflineShare = offlineAck.messageId === offlineShare.envelope.messageId;
  if (!isForOfflineShare) {
    // Got a stale ACK, wait for the right one
    const realOfflineAck = await windows.waitForType<{
      type: "RELAY_ACK";
      delivered: boolean;
      reason?: string;
    }>("RELAY_ACK");
    assert(realOfflineAck.delivered === false, "RELAY_ACK delivered=false when target offline");
    assert(
      realOfflineAck.reason === "DEVICE_OFFLINE",
      "RELAY_ACK reason is DEVICE_OFFLINE",
      `Got reason: ${realOfflineAck.reason}`
    );
  } else {
    assert(offlineAck.delivered === false, "RELAY_ACK delivered=false when target offline");
    assert(
      offlineAck.reason === "DEVICE_OFFLINE",
      "RELAY_ACK reason is DEVICE_OFFLINE",
      `Got reason: ${offlineAck.reason}`
    );
  }

  // ─── Step 11: Reconnect Android and verify ─────────────────────────
  console.log("\n── Step 11: Reconnect and resend ──");
  const android2 = await connectAndHello(RELAY_URL, ANDROID_IDENTITY.deviceId);
  android2.send({
    type: "TRUSTED_DEVICE_HELLO",
    payload: {
      deviceIdentity: ANDROID_IDENTITY,
      trustedPeerIds: [WINDOWS_IDENTITY.deviceId]
    }
  });

  await new Promise((r) => setTimeout(r, 500));

  windows.send({
    type: "TRUSTED_DEVICE_HELLO",
    payload: {
      deviceIdentity: WINDOWS_IDENTITY,
      trustedPeerIds: [ANDROID_IDENTITY.deviceId]
    }
  });

  const reconnectOnline = await windows.waitForType<{
    type: "TRUSTED_DEVICE_ONLINE";
    payload: { deviceIdentity: { deviceId: string } };
  }>("TRUSTED_DEVICE_ONLINE");
  assert(
    reconnectOnline.payload.deviceIdentity.deviceId === ANDROID_IDENTITY.deviceId,
    "Windows sees Android come back online after reconnect"
  );

  // Resend successfully
  // Drain any stale messages first
  windows.drain();
  const resendShare = await createTextShareEnvelope(
    WINDOWS_IDENTITY.deviceId,
    ANDROID_IDENTITY.deviceId,
    "Reconnected!",
    windowsKeys,
    androidKeys.publicKey
  );
  windows.send(resendShare.envelope);

  const resendEnvelope = await android2.waitForEnvelope(
    20_000,
    (envelope) => isTextShareFor(envelope, ANDROID_IDENTITY.deviceId, androidKeys, windowsKeys.publicKey)
  );
  const expectedMessageId = resendShare.envelope.messageId;
  const resendAck = await windows.waitForType<{
    type: "RELAY_ACK";
    delivered: boolean;
    messageId?: string;
  }>("RELAY_ACK", 20_000, (msg) => {
    const ack = msg as { messageId?: string };
    return ack.messageId === expectedMessageId;
  });
  assert(resendAck.delivered === true, "Resend after reconnect gets RELAY_ACK delivered=true");
  const resendDecoded = await decodeShareEnvelope(
    resendEnvelope,
    ANDROID_IDENTITY.deviceId,
    androidKeys,
    windowsKeys.publicKey
  );
  assert(resendDecoded !== null, "Android receives share after reconnect");
  if (resendDecoded) {
    const cm = resendDecoded.controlMessage as { payload: { text: string } };
    assert(cm.payload.text === "Reconnected!", "Android received correct text after reconnect");
  }

  // ─── Step 12: Windows → Android small file transfer ─────────────────
  console.log("\n── Step 12: Windows → Android small file transfer ──");
  windows.drain();
  android2.drain();

  const fileData = new TextEncoder().encode("Hello world! This is a CrossBridge small file transfer.");
  const offer = await createFileOfferEnvelope({
    fromDeviceId: WINDOWS_IDENTITY.deviceId,
    toDeviceId: ANDROID_IDENTITY.deviceId,
    fileName: "hello.txt",
    mimeType: "text/plain",
    bytes: fileData,
    direction: "WINDOWS_TO_ANDROID",
    localPrivateKey: windowsKeys.privateKey,
    localPublicKey: windowsKeys.publicKey,
    peerPublicKey: androidKeys.publicKey
  });

  windows.send(offer.envelope);

  // Android receives the FILE_OFFER envelope
  const androidOfferEnv = await android2.waitForEnvelope(
    20_000,
    (envelope) => isFileTransferFor(envelope, ANDROID_IDENTITY.deviceId, androidKeys, windowsKeys.publicKey, "FILE_OFFER", offer.transferId)
  );

  const androidOfferDec = await decodeFileTransferEnvelope({
    envelope: androidOfferEnv,
    localDeviceId: ANDROID_IDENTITY.deviceId,
    localPrivateKey: androidKeys.privateKey,
    localPublicKey: androidKeys.publicKey,
    peerPublicKey: windowsKeys.publicKey
  });
  assert(androidOfferDec !== undefined, "Android decodes file offer envelope");
  assert(androidOfferDec?.controlMessage.type === "FILE_OFFER", "Android received FILE_OFFER message type");
  const offerPayload = androidOfferDec?.controlMessage.payload as any;
  assert(offerPayload.fileName === "hello.txt", "Android offer has correct file name");
  assert(offerPayload.fileSize === fileData.length, "Android offer has correct file size");

  // Android accepts the offer
  const acceptEnv = await createFileAcceptEnvelope({
    fromDeviceId: ANDROID_IDENTITY.deviceId,
    toDeviceId: WINDOWS_IDENTITY.deviceId,
    transferId: offer.transferId,
    accepted: true,
    localPrivateKey: androidKeys.privateKey,
    localPublicKey: androidKeys.publicKey,
    peerPublicKey: windowsKeys.publicKey
  });
  android2.send(acceptEnv);

  // Windows receives FILE_ACCEPT
  const winAcceptEnv = await windows.waitForEnvelope(
    20_000,
    (envelope) => isFileTransferFor(envelope, WINDOWS_IDENTITY.deviceId, windowsKeys, androidKeys.publicKey, "FILE_ACCEPT", offer.transferId)
  );
  const winAcceptDec = await decodeFileTransferEnvelope({
    envelope: winAcceptEnv,
    localDeviceId: WINDOWS_IDENTITY.deviceId,
    localPrivateKey: windowsKeys.privateKey,
    localPublicKey: windowsKeys.publicKey,
    peerPublicKey: androidKeys.publicKey
  });
  assert(winAcceptDec !== undefined, "Windows decodes accept envelope");
  assert(winAcceptDec?.controlMessage.type === "FILE_ACCEPT", "Windows received FILE_ACCEPT");

  // Windows sends the chunk(s) and FILE_COMPLETE
  for (const chunk of offer.chunks) {
    const chunkEnv = await createFileChunkEnvelope({
      fromDeviceId: WINDOWS_IDENTITY.deviceId,
      toDeviceId: ANDROID_IDENTITY.deviceId,
      payload: chunk.payload,
      localPrivateKey: windowsKeys.privateKey,
      localPublicKey: windowsKeys.publicKey,
      peerPublicKey: androidKeys.publicKey
    });
    windows.send(chunkEnv);

    // Android receives chunk
    const andChunkEnv = await android2.waitForEnvelope(
      20_000,
      (envelope) => isFileTransferFor(envelope, ANDROID_IDENTITY.deviceId, androidKeys, windowsKeys.publicKey, "FILE_CHUNK", offer.transferId)
    );
    const andChunkDec = await decodeFileTransferEnvelope({
      envelope: andChunkEnv,
      localDeviceId: ANDROID_IDENTITY.deviceId,
      localPrivateKey: androidKeys.privateKey,
      localPublicKey: androidKeys.publicKey,
      peerPublicKey: windowsKeys.publicKey
    });
    assert(andChunkDec !== undefined, "Android decodes chunk envelope");
    assert(andChunkDec?.controlMessage.type === "FILE_CHUNK", "Android received FILE_CHUNK");
  }

  // Windows sends FILE_COMPLETE
  const completeEnv = await createFileCompleteEnvelope({
    fromDeviceId: WINDOWS_IDENTITY.deviceId,
    toDeviceId: ANDROID_IDENTITY.deviceId,
    transferId: offer.transferId,
    sha256: offer.payload.sha256,
    localPrivateKey: windowsKeys.privateKey,
    localPublicKey: windowsKeys.publicKey,
    peerPublicKey: androidKeys.publicKey
  });
  windows.send(completeEnv);

  // Android receives FILE_COMPLETE
  const andCompleteEnv = await android2.waitForEnvelope(
    20_000,
    (envelope) => isFileTransferFor(envelope, ANDROID_IDENTITY.deviceId, androidKeys, windowsKeys.publicKey, "FILE_COMPLETE", offer.transferId)
  );
  const andCompleteDec = await decodeFileTransferEnvelope({
    envelope: andCompleteEnv,
    localDeviceId: ANDROID_IDENTITY.deviceId,
    localPrivateKey: androidKeys.privateKey,
    localPublicKey: androidKeys.publicKey,
    peerPublicKey: windowsKeys.publicKey
  });
  assert(andCompleteDec !== undefined, "Android decodes complete envelope");
  assert(andCompleteDec?.controlMessage.type === "FILE_COMPLETE", "Android received FILE_COMPLETE");

  // Android reassembles the file and verifies SHA-256
  const reassembled = reassembleTransferredFile(
    offer.chunks.map(c => c.payload),
    offer.payload.sha256
  );
  assert(Buffer.from(reassembled).toString() === "Hello world! This is a CrossBridge small file transfer.", "Android reassembled correct file bytes");

  // ─── Step 13: Android → Windows small file transfer ─────────────────
  console.log("\n── Step 13: Android → Windows small file transfer ──");
  windows.drain();
  android2.drain();

  const fileDataA = new TextEncoder().encode("Hello from Android! Symmetrical transfer.");
  const offerA = await createFileOfferEnvelope({
    fromDeviceId: ANDROID_IDENTITY.deviceId,
    toDeviceId: WINDOWS_IDENTITY.deviceId,
    fileName: "android_notes.txt",
    mimeType: "text/plain",
    bytes: fileDataA,
    direction: "ANDROID_TO_WINDOWS",
    localPrivateKey: androidKeys.privateKey,
    localPublicKey: androidKeys.publicKey,
    peerPublicKey: windowsKeys.publicKey
  });

  android2.send(offerA.envelope);

  // Windows receives FILE_OFFER
  const winOfferEnv = await windows.waitForEnvelope(
    20_000,
    (envelope) => isFileTransferFor(envelope, WINDOWS_IDENTITY.deviceId, windowsKeys, androidKeys.publicKey, "FILE_OFFER", offerA.transferId)
  );
  const winOfferDec = await decodeFileTransferEnvelope({
    envelope: winOfferEnv,
    localDeviceId: WINDOWS_IDENTITY.deviceId,
    localPrivateKey: windowsKeys.privateKey,
    localPublicKey: windowsKeys.publicKey,
    peerPublicKey: androidKeys.publicKey
  });
  assert(winOfferDec !== undefined, "Windows decodes file offer envelope from Android");
  assert(winOfferDec?.controlMessage.type === "FILE_OFFER", "Windows received FILE_OFFER from Android");

  // Windows accepts
  const acceptEnvW = await createFileAcceptEnvelope({
    fromDeviceId: WINDOWS_IDENTITY.deviceId,
    toDeviceId: ANDROID_IDENTITY.deviceId,
    transferId: offerA.transferId,
    accepted: true,
    localPrivateKey: windowsKeys.privateKey,
    localPublicKey: windowsKeys.publicKey,
    peerPublicKey: androidKeys.publicKey
  });
  windows.send(acceptEnvW);

  // Android receives FILE_ACCEPT
  const andAcceptEnv = await android2.waitForEnvelope(
    20_000,
    (envelope) => isFileTransferFor(envelope, ANDROID_IDENTITY.deviceId, androidKeys, windowsKeys.publicKey, "FILE_ACCEPT", offerA.transferId)
  );
  const andAcceptDec = await decodeFileTransferEnvelope({
    envelope: andAcceptEnv,
    localDeviceId: ANDROID_IDENTITY.deviceId,
    localPrivateKey: androidKeys.privateKey,
    localPublicKey: androidKeys.publicKey,
    peerPublicKey: windowsKeys.publicKey
  });
  assert(andAcceptDec !== undefined, "Android decodes accept envelope from Windows");
  assert(andAcceptDec?.controlMessage.type === "FILE_ACCEPT", "Android received FILE_ACCEPT");

  // Android sends chunks
  for (const chunk of offerA.chunks) {
    const chunkEnv = await createFileChunkEnvelope({
      fromDeviceId: ANDROID_IDENTITY.deviceId,
      toDeviceId: WINDOWS_IDENTITY.deviceId,
      payload: chunk.payload,
      localPrivateKey: androidKeys.privateKey,
      localPublicKey: androidKeys.publicKey,
      peerPublicKey: windowsKeys.publicKey
    });
    android2.send(chunkEnv);

    // Windows receives chunk
    const winChunkEnv = await windows.waitForEnvelope(
      20_000,
      (envelope) => isFileTransferFor(envelope, WINDOWS_IDENTITY.deviceId, windowsKeys, androidKeys.publicKey, "FILE_CHUNK", offerA.transferId)
    );
    const winChunkDec = await decodeFileTransferEnvelope({
      envelope: winChunkEnv,
      localDeviceId: WINDOWS_IDENTITY.deviceId,
      localPrivateKey: windowsKeys.privateKey,
      localPublicKey: windowsKeys.publicKey,
      peerPublicKey: androidKeys.publicKey
    });
    assert(winChunkDec !== undefined, "Windows decodes chunk envelope");
    assert(winChunkDec?.controlMessage.type === "FILE_CHUNK", "Windows received FILE_CHUNK");
  }

  // Android sends FILE_COMPLETE
  const completeEnvA = await createFileCompleteEnvelope({
    fromDeviceId: ANDROID_IDENTITY.deviceId,
    toDeviceId: WINDOWS_IDENTITY.deviceId,
    transferId: offerA.transferId,
    sha256: offerA.payload.sha256,
    localPrivateKey: androidKeys.privateKey,
    localPublicKey: androidKeys.publicKey,
    peerPublicKey: windowsKeys.publicKey
  });
  android2.send(completeEnvA);

  // Windows receives FILE_COMPLETE
  const winCompleteEnv = await windows.waitForEnvelope(
    20_000,
    (envelope) => isFileTransferFor(envelope, WINDOWS_IDENTITY.deviceId, windowsKeys, androidKeys.publicKey, "FILE_COMPLETE", offerA.transferId)
  );
  const winCompleteDec = await decodeFileTransferEnvelope({
    envelope: winCompleteEnv,
    localDeviceId: WINDOWS_IDENTITY.deviceId,
    localPrivateKey: windowsKeys.privateKey,
    localPublicKey: windowsKeys.publicKey,
    peerPublicKey: androidKeys.publicKey
  });
  assert(winCompleteDec !== undefined, "Windows decodes complete envelope");
  assert(winCompleteDec?.controlMessage.type === "FILE_COMPLETE", "Windows received FILE_COMPLETE");

  // Windows reassembles
  const reassembledW = reassembleTransferredFile(
    offerA.chunks.map(c => c.payload),
    offerA.payload.sha256
  );
  assert(Buffer.from(reassembledW).toString() === "Hello from Android! Symmetrical transfer.", "Windows reassembled correct file bytes from Android");

  // ─── Step 14: Large file chunking ───────────────────────────────────
  console.log("\n── Step 14: Large file chunking ──");
  windows.drain();
  android2.drain();

  // Create a payload of 100 bytes, using chunk size of 20 bytes -> 5 chunks
  const largeData = new Uint8Array(100);
  for (let i = 0; i < 100; i++) largeData[i] = i;

  const largeOffer = await createFileOfferEnvelope({
    fromDeviceId: WINDOWS_IDENTITY.deviceId,
    toDeviceId: ANDROID_IDENTITY.deviceId,
    fileName: "large.bin",
    mimeType: "application/octet-stream",
    bytes: largeData,
    direction: "WINDOWS_TO_ANDROID",
    chunkSize: 20,
    localPrivateKey: windowsKeys.privateKey,
    localPublicKey: windowsKeys.publicKey,
    peerPublicKey: androidKeys.publicKey
  });

  assert(largeOffer.chunks.length === 5, "Large file split into exactly 5 chunks");
  windows.send(largeOffer.envelope);

  // Android accepts
  const andLargeOffer = await android2.waitForEnvelope(
    20_000,
    (envelope) => isFileTransferFor(envelope, ANDROID_IDENTITY.deviceId, androidKeys, windowsKeys.publicKey, "FILE_OFFER", largeOffer.transferId)
  );
  android2.send(await createFileAcceptEnvelope({
    fromDeviceId: ANDROID_IDENTITY.deviceId,
    toDeviceId: WINDOWS_IDENTITY.deviceId,
    transferId: largeOffer.transferId,
    accepted: true,
    localPrivateKey: androidKeys.privateKey,
    localPublicKey: androidKeys.publicKey,
    peerPublicKey: windowsKeys.publicKey
  }));

  await windows.waitForEnvelope(
    20_000,
    (envelope) => isFileTransferFor(envelope, WINDOWS_IDENTITY.deviceId, windowsKeys, androidKeys.publicKey, "FILE_ACCEPT", largeOffer.transferId)
  );

  // Send chunks and track progress
  let progressCount = 0;
  for (const chunk of largeOffer.chunks) {
    const expectedBytesTransferred = (chunk.payload.chunkIndex + 1) * 20;
    windows.send(await createFileChunkEnvelope({
      fromDeviceId: WINDOWS_IDENTITY.deviceId,
      toDeviceId: ANDROID_IDENTITY.deviceId,
      payload: chunk.payload,
      localPrivateKey: windowsKeys.privateKey,
      localPublicKey: windowsKeys.publicKey,
      peerPublicKey: androidKeys.publicKey
    }));

    // Send a progress envelope
    const progressEnv = await createFileProgressEnvelope({
      fromDeviceId: WINDOWS_IDENTITY.deviceId,
      toDeviceId: ANDROID_IDENTITY.deviceId,
      transferId: largeOffer.transferId,
      bytesTransferred: expectedBytesTransferred,
      totalBytes: 100,
      localPrivateKey: windowsKeys.privateKey,
      localPublicKey: windowsKeys.publicKey,
      peerPublicKey: androidKeys.publicKey
    });
    windows.send(progressEnv);

    // Android receives chunk and progress
    await android2.waitForEnvelope(
      20_000,
      (envelope) => isFileTransferFor(envelope, ANDROID_IDENTITY.deviceId, androidKeys, windowsKeys.publicKey, "FILE_CHUNK", largeOffer.transferId)
    );
    const progressRecv = await android2.waitForEnvelope(
      20_000,
      (envelope) => isFileProgressForBytes(
        envelope,
        ANDROID_IDENTITY.deviceId,
        androidKeys,
        windowsKeys.publicKey,
        largeOffer.transferId,
        expectedBytesTransferred
      )
    );

    const progressDec = await decodeFileTransferEnvelope({
      envelope: progressRecv,
      localDeviceId: ANDROID_IDENTITY.deviceId,
      localPrivateKey: androidKeys.privateKey,
      localPublicKey: androidKeys.publicKey,
      peerPublicKey: windowsKeys.publicKey
    });
    assert(progressDec?.controlMessage.type === "FILE_PROGRESS", "Android received FILE_PROGRESS");
    const progressPayload = progressDec?.controlMessage.payload as any;
    assert(progressPayload.bytesTransferred === expectedBytesTransferred, "Progress byte count matches");
    progressCount++;
  }

  assert(progressCount === 5, "All 5 progress envelopes successfully sent and verified");

  // Send complete
  windows.send(await createFileCompleteEnvelope({
    fromDeviceId: WINDOWS_IDENTITY.deviceId,
    toDeviceId: ANDROID_IDENTITY.deviceId,
    transferId: largeOffer.transferId,
    sha256: largeOffer.payload.sha256,
    localPrivateKey: windowsKeys.privateKey,
    localPublicKey: windowsKeys.publicKey,
    peerPublicKey: androidKeys.publicKey
  }));

  await android2.waitForEnvelope(
    20_000,
    (envelope) => isFileTransferFor(envelope, ANDROID_IDENTITY.deviceId, androidKeys, windowsKeys.publicKey, "FILE_COMPLETE", largeOffer.transferId)
  );

  const reassembledLarge = reassembleTransferredFile(
    largeOffer.chunks.map(c => c.payload),
    largeOffer.payload.sha256
  );
  assert(reassembledLarge.length === 100, "Reassembled large file has correct length");
  assert(reassembledLarge[99] === 99, "Reassembled large file integrity verified");

  // ─── Step 15: Risky file warnings ───────────────────────────────────
  console.log("\n── Step 15: Risky file warnings ──");
  windows.drain();
  android2.drain();

  // Test offer creation for risky file (.exe)
  const exeOffer = await createFileOfferEnvelope({
    fromDeviceId: WINDOWS_IDENTITY.deviceId,
    toDeviceId: ANDROID_IDENTITY.deviceId,
    fileName: "setup.exe",
    mimeType: "application/octet-stream",
    bytes: new Uint8Array([1, 2, 3]),
    direction: "WINDOWS_TO_ANDROID",
    localPrivateKey: windowsKeys.privateKey,
    localPublicKey: windowsKeys.publicKey,
    peerPublicKey: androidKeys.publicKey
  });
  assert(exeOffer.riskyWarning !== undefined, "Risky warning is correctly flagged for .exe file");
  assert(exeOffer.riskyWarning?.includes("Potentially risky file type: setup.exe"), "Risky warning contains file name");

  // Test offer creation for safe file (.png)
  const pngOffer = await createFileOfferEnvelope({
    fromDeviceId: WINDOWS_IDENTITY.deviceId,
    toDeviceId: ANDROID_IDENTITY.deviceId,
    fileName: "photo.png",
    mimeType: "image/png",
    bytes: new Uint8Array([1, 2, 3]),
    direction: "WINDOWS_TO_ANDROID",
    localPrivateKey: windowsKeys.privateKey,
    localPublicKey: windowsKeys.publicKey,
    peerPublicKey: androidKeys.publicKey
  });
  assert(pngOffer.riskyWarning === undefined, "Risky warning is not flagged for safe .png file");

  // ─── Step 16: Cancel mid-transfer ───────────────────────────────────
  console.log("\n── Step 16: Cancel mid-transfer ──");
  windows.drain();
  android2.drain();

  const cancelOffer = await createFileOfferEnvelope({
    fromDeviceId: WINDOWS_IDENTITY.deviceId,
    toDeviceId: ANDROID_IDENTITY.deviceId,
    fileName: "mid_cancel.txt",
    mimeType: "text/plain",
    bytes: new TextEncoder().encode("This transfer will be cancelled."),
    direction: "WINDOWS_TO_ANDROID",
    localPrivateKey: windowsKeys.privateKey,
    localPublicKey: windowsKeys.publicKey,
    peerPublicKey: androidKeys.publicKey
  });

  windows.send(cancelOffer.envelope);

  // Android accepts
  const andCancelOffer = await android2.waitForEnvelope(
    20_000,
    (envelope) => isFileTransferFor(envelope, ANDROID_IDENTITY.deviceId, androidKeys, windowsKeys.publicKey, "FILE_OFFER", cancelOffer.transferId)
  );
  android2.send(await createFileAcceptEnvelope({
    fromDeviceId: ANDROID_IDENTITY.deviceId,
    toDeviceId: WINDOWS_IDENTITY.deviceId,
    transferId: cancelOffer.transferId,
    accepted: true,
    localPrivateKey: androidKeys.privateKey,
    localPublicKey: androidKeys.publicKey,
    peerPublicKey: windowsKeys.publicKey
  }));

  await windows.waitForEnvelope(
    20_000,
    (envelope) => isFileTransferFor(envelope, WINDOWS_IDENTITY.deviceId, windowsKeys, androidKeys.publicKey, "FILE_ACCEPT", cancelOffer.transferId)
  );

  // Send first chunk
  windows.send(await createFileChunkEnvelope({
    fromDeviceId: WINDOWS_IDENTITY.deviceId,
    toDeviceId: ANDROID_IDENTITY.deviceId,
    payload: cancelOffer.chunks[0].payload,
    localPrivateKey: windowsKeys.privateKey,
    localPublicKey: windowsKeys.publicKey,
    peerPublicKey: androidKeys.publicKey
  }));
  await android2.waitForEnvelope(
    20_000,
    (envelope) => isFileTransferFor(envelope, ANDROID_IDENTITY.deviceId, androidKeys, windowsKeys.publicKey, "FILE_CHUNK", cancelOffer.transferId)
  );

  // Windows cancels transfer mid-way
  const cancelEnv = await createFileCancelEnvelope({
    fromDeviceId: WINDOWS_IDENTITY.deviceId,
    toDeviceId: ANDROID_IDENTITY.deviceId,
    transferId: cancelOffer.transferId,
    localPrivateKey: windowsKeys.privateKey,
    localPublicKey: windowsKeys.publicKey,
    peerPublicKey: androidKeys.publicKey
  });
  windows.send(cancelEnv);

  // Android receives FILE_CANCEL
  const andCancelRecv = await android2.waitForEnvelope(
    20_000,
    (envelope) => isFileTransferFor(envelope, ANDROID_IDENTITY.deviceId, androidKeys, windowsKeys.publicKey, "FILE_CANCEL", cancelOffer.transferId)
  );
  const andCancelDec = await decodeFileTransferEnvelope({
    envelope: andCancelRecv,
    localDeviceId: ANDROID_IDENTITY.deviceId,
    localPrivateKey: androidKeys.privateKey,
    localPublicKey: androidKeys.publicKey,
    peerPublicKey: windowsKeys.publicKey
  });
  assert(andCancelDec?.controlMessage.type === "FILE_CANCEL", "Android receives FILE_CANCEL successfully");

  // ─── Step 17: SHA-256 mismatch detection ─────────────────────────────
  console.log("\n── Step 17: SHA-256 mismatch detection (forced corruption) ──");
  windows.drain();
  android2.drain();

  const corruptOffer = await createFileOfferEnvelope({
    fromDeviceId: WINDOWS_IDENTITY.deviceId,
    toDeviceId: ANDROID_IDENTITY.deviceId,
    fileName: "corrupt.txt",
    mimeType: "text/plain",
    bytes: new TextEncoder().encode("Correct file content"),
    direction: "WINDOWS_TO_ANDROID",
    localPrivateKey: windowsKeys.privateKey,
    localPublicKey: windowsKeys.publicKey,
    peerPublicKey: androidKeys.publicKey
  });

  // Corrupt the chunk data (tamper with base64 data to change content)
  const corruptChunkPayload = {
    ...corruptOffer.chunks[0].payload,
    data: btoa("Corrupted content!") // This mismatches original chunkHash and file sha256
  };

  let chunkMismatchThrown = false;
  try {
    reassembleTransferredFile([corruptChunkPayload], corruptOffer.payload.sha256);
  } catch (err: any) {
    chunkMismatchThrown = true;
    assert(err.message.includes("SHA-256 did not match") || err.message.includes("length did not match"), "Integrity check throws error on corrupted chunk", err.message);
  }
  assert(chunkMismatchThrown, "Reassembly throws exception on corrupted chunk data");

  // Test whole-file SHA-256 mismatch when chunk hashes match but the whole file hash does not
  const wrongShaOffer = await createFileOfferEnvelope({
    fromDeviceId: WINDOWS_IDENTITY.deviceId,
    toDeviceId: ANDROID_IDENTITY.deviceId,
    fileName: "wrong_sha.txt",
    mimeType: "text/plain",
    bytes: new TextEncoder().encode("Correct file content"),
    direction: "WINDOWS_TO_ANDROID",
    localPrivateKey: windowsKeys.privateKey,
    localPublicKey: windowsKeys.publicKey,
    peerPublicKey: androidKeys.publicKey
  });

  let fileMismatchThrown = false;
  try {
    // Provide a wrong expected SHA-256 hex string (all zeros)
    reassembleTransferredFile(wrongShaOffer.chunks.map(c => c.payload), "0".repeat(64));
  } catch (err: any) {
    fileMismatchThrown = true;
    assert(err.message.includes("Transferred file SHA-256 did not match"), "Whole-file integrity check throws error on wrong expected SHA-256", err.message);
  }
  assert(fileMismatchThrown, "Reassembly throws exception on wrong expected file SHA-256");

  // ─── Step 18: Offline recipient error during file offer ──────────────
  console.log("\n── Step 18: Offline recipient error during file offer ──");
  windows.drain();

  // Close the android2 socket to simulate recipient offline
  android2.close();

  // Wait to receive the trusted device offline notification first
  const offlineNotifFile = await windows.waitForType<{
    type: "TRUSTED_DEVICE_OFFLINE";
    payload: { deviceId: string };
  }>("TRUSTED_DEVICE_OFFLINE");
  assert(offlineNotifFile.payload.deviceId === ANDROID_IDENTITY.deviceId, "Windows receives Android offline notification before file offer");

  // Try to send file offer to the offline device
  const offlineOffer = await createFileOfferEnvelope({
    fromDeviceId: WINDOWS_IDENTITY.deviceId,
    toDeviceId: ANDROID_IDENTITY.deviceId,
    fileName: "offline_file.txt",
    mimeType: "text/plain",
    bytes: new TextEncoder().encode("Offline test content"),
    direction: "WINDOWS_TO_ANDROID",
    localPrivateKey: windowsKeys.privateKey,
    localPublicKey: windowsKeys.publicKey,
    peerPublicKey: androidKeys.publicKey
  });

  windows.send(offlineOffer.envelope);

  // Expect RELAY_ACK delivered = false and reason = DEVICE_OFFLINE
  const offlineAckFile = await windows.waitForType<{
    type: "RELAY_ACK";
    delivered: boolean;
    reason?: string;
    messageId?: string;
  }>("RELAY_ACK", 20_000, (msg) => {
    const ack = msg as { messageId?: string };
    return ack.messageId === offlineOffer.envelope.messageId;
  });

  assert(offlineAckFile.delivered === false, "File offer RELAY_ACK delivered=false when recipient offline");
  assert(offlineAckFile.reason === "DEVICE_OFFLINE", "File offer RELAY_ACK reason is DEVICE_OFFLINE");

  // ─── Cleanup ────────────────────────────────────────────────────────
  windows.close();

  // ─── Summary ────────────────────────────────────────────────────────
  console.log("\n=== E2E Verification Summary ===");
  console.log(`  Passed: ${testsPassed}`);
  console.log(`  Failed: ${testsFailed}`);
  console.log(`  Total:  ${testsPassed + testsFailed}`);

  if (testsFailed > 0) {
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  console.error("E2E verification failed with uncaught error:", error);
  process.exitCode = 1;
});
