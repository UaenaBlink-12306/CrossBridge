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
  decodeFileTransferEnvelope
} from "../apps/windows/src/services/fileTransferClient.js";
import { readFileSync } from "node:fs";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

interface DeviceIdentity {
  deviceId: string;
  deviceName: string;
  platform: "windows";
  publicKey: string;
}

const RELAY_URL = "ws://127.0.0.1:8787/connect";
let windowsKeys: DevelopmentKeyPair;
let WINDOWS_IDENTITY: DeviceIdentity;
let androidPeerId: string;
let androidPeerPublicKey: string;

function send(socket: WebSocket, message: unknown): void {
  socket.send(JSON.stringify(message));
}

function waitForType<T extends { type: string }>(socket: WebSocket, type: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData) => {
      try {
        const message = JSON.parse(data.toString()) as unknown;
        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === type
        ) {
          cleanup();
          resolve(message as T);
        }
      } catch (_) {}
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off("message", onMessage);
      socket.off("error", onError);
    };
    socket.on("message", onMessage);
    socket.on("error", onError);
  });
}

async function connect(relayUrl: string, deviceId: string): Promise<WebSocket> {
  const socket = new WebSocket(relayUrl);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  send(socket, {
    type: "RELAY_HELLO",
    deviceId,
    sessionToken: `token_windows_online_${Date.now()}`,
    protocolVersion: 1
  });
  await waitForType(socket, "RELAY_WELCOME");
  return socket;
}

async function handleIncomingEnvelope(envelope: any) {
  console.log("Incoming envelope:", { version: envelope.version, from: envelope.fromDeviceId, to: envelope.toDeviceId, msgId: envelope.messageId });
  if (envelope.version !== 1 || typeof envelope.ciphertext !== "string") return;

  // 1. Try decoding as Text Share
  try {
    console.log("Debugging Decryption Keys:", {
      localDeviceId: WINDOWS_IDENTITY.deviceId,
      localPublicKey: windowsKeys.publicKey,
      peerPublicKey: androidPeerPublicKey,
      envelopeKeyId: envelope.keyId,
      envelopeFrom: envelope.fromDeviceId,
      envelopeTo: envelope.toDeviceId
    });
    const decoded = await decryptAppMessage({
      envelope: envelope as EncryptedEnvelope,
      localDeviceId: WINDOWS_IDENTITY.deviceId,
      localPrivateKey: windowsKeys.privateKey,
      localPublicKey: windowsKeys.publicKey,
      peerPublicKey: androidPeerPublicKey
    });

    if (decoded.type === "TEXT_SHARE") {
      const payload = decoded.payload as any;
      console.log("\n📬 [Windows Mock Received Text/Link Share]!");
      console.log(`- Type: ${payload.contentType.toUpperCase()}`);
      console.log(`- Content: "${payload.text}"`);
      console.log(`- Sent At: ${new Date(payload.createdAt).toLocaleTimeString()}`);
      return;
    }
  } catch (err: any) {
    console.error("Text decrypt failed:", err);
  }

  // 2. Try decoding as File Offer
  try {
    const decodedFile = await decodeFileTransferEnvelope({
      envelope: envelope,
      localDeviceId: WINDOWS_IDENTITY.deviceId,
      localPrivateKey: windowsKeys.privateKey,
      localPublicKey: windowsKeys.publicKey,
      peerPublicKey: androidPeerPublicKey
    });

    if (decodedFile && decodedFile.controlMessage) {
      const cm = decodedFile.controlMessage as any;
      if (cm.type === "FILE_OFFER") {
        const payload = cm.payload;
        console.log("\n📂 [Windows Mock Received File Offer]!");
        console.log(`- Transfer ID: "${payload.transferId}"`);
        console.log(`- File Name: "${payload.fileName}"`);
        console.log(`- Size: ${(payload.fileSize / 1024).toFixed(2)} KB (${payload.fileSize} bytes)`);
        console.log(`- MIME Type: ${payload.mimeType}`);
        console.log(`- SHA-256: ${payload.sha256}`);
        console.log("✅ Simulation: file offer decrypted successfully.");
        return;
      }
    }
  } catch (err: any) {
    console.error("File offer decrypt failed:", err);
  }
}

async function main(): Promise<void> {
  console.log("=== CrossBridge Dev Windows Online Standby ===");
  
  // 1. Load keys and identity config
  const keysRaw = readFileSync("scratch/windows_keys.json", "utf8");
  windowsKeys = JSON.parse(keysRaw);
  WINDOWS_IDENTITY = {
    deviceId: "windows_dev_test_id",
    deviceName: "Dev Windows PC",
    platform: "windows",
    publicKey: windowsKeys.publicKey
  };

  const identityRaw = readFileSync("scratch/android_identity.json", "utf8");
  const identityConfig = JSON.parse(identityRaw);
  androidPeerId = identityConfig.androidDeviceId;
  androidPeerPublicKey = identityConfig.androidPublicKey;

  console.log("✓ Loaded cryptographic configuration:");
  console.log(`- Windows Device ID: ${WINDOWS_IDENTITY.deviceId}`);
  console.log(`- Android Device ID: ${androidPeerId}`);

  // 2. Connect to Relay
  const socket = await connect(RELAY_URL, WINDOWS_IDENTITY.deviceId);
  console.log("✓ Connected to local relay.");

  // 3. Announce Trusted Hello
  send(socket, {
    type: "TRUSTED_DEVICE_HELLO",
    payload: {
      deviceIdentity: WINDOWS_IDENTITY,
      trustedPeerIds: [androidPeerId]
    }
  });

  // 4. Standby and listen
  socket.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "TRUSTED_DEVICE_ONLINE") {
        console.log(`🟢 Android device (${msg.payload.deviceIdentity.deviceName}) is ONLINE!`);
      } else if (msg.type === "TRUSTED_DEVICE_OFFLINE") {
        console.log(`🔴 Android device (${msg.payload.deviceId}) is OFFLINE.`);
      } else if (msg.type === "RELAY_ACK") {
        // console.log(`✓ Received RELAY_ACK, delivered: ${msg.delivered}`);
      } else if (msg.version === 1) {
        handleIncomingEnvelope(msg);
      } else {
        console.log(`✉️ Received message:`, msg);
      }
    } catch (_) {}
  });

  console.log("\n🟢 Standing by for incoming shares from Android emulator.");
  console.log("Commands: ");
  console.log("  text <content>  - Send a text share to the Android device");
  console.log("  exit            - Quit the standby receiver\n");

  const rl = createInterface({ input, output });
  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (trimmed === "exit") {
      socket.close();
      process.exit(0);
    } else if (trimmed.startsWith("text ")) {
      const textToSend = trimmed.substring(5);
      console.log(`Sending text share: "${textToSend}" to Android...`);
      try {
        const shareId = `share_${Date.now()}`;
        const messageId = `msg_${Date.now()}`;
        const now = Date.now();
        const appMessage: SecureAppMessage = {
          version: 1,
          id: messageId,
          type: "TEXT_SHARE",
          timestamp: now,
          fromDeviceId: WINDOWS_IDENTITY.deviceId,
          toDeviceId: androidPeerId,
          payload: {
            shareId,
            fromDeviceId: WINDOWS_IDENTITY.deviceId,
            toDeviceId: androidPeerId,
            contentType: textToSend.startsWith("http") ? "url" : "text",
            text: textToSend,
            createdAt: now
          }
        };
        const envelope = await encryptAppMessage({
          message: appMessage,
          localPrivateKey: windowsKeys.privateKey,
          localPublicKey: windowsKeys.publicKey,
          peerPublicKey: androidPeerPublicKey
        });
        send(socket, envelope);
        console.log("✓ Encrypted envelope sent to relay.");
      } catch (err: any) {
        console.error("❌ Failed to send share:", err.message);
      }
    }
  });
}

main().catch(console.error);
