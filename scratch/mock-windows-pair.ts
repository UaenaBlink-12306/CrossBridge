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
  decodeFileTransferEnvelope,
  createFileAcceptEnvelope,
  createFileCompleteEnvelope
} from "../apps/windows/src/services/fileTransferClient.js";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

interface DeviceIdentity {
  deviceId: string;
  deviceName: string;
  platform: "windows";
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

const RELAY_URL = "ws://127.0.0.1:8787/connect";
let windowsKeys: DevelopmentKeyPair;
let WINDOWS_IDENTITY: DeviceIdentity;
let androidPeerIdentity: any = null;

async function askQuestion(query: string): Promise<string> {
  const readline = createInterface({ input, output });
  try {
    return await readline.question(query);
  } finally {
    readline.close();
  }
}

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
    sessionToken: `token_windows_dev_${Date.now()}`,
    protocolVersion: 1
  });
  await waitForType(socket, "RELAY_WELCOME");
  return socket;
}

async function handleIncomingEnvelope(envelope: any) {
  if (envelope.version !== 1 || typeof envelope.ciphertext !== "string") return;

  if (!androidPeerIdentity) {
    console.log("⚠️ Received encrypted message before Android peer identity was established!");
    return;
  }

  // 1. Try decoding as Text Share
  try {
    const decoded = await decryptAppMessage({
      envelope: envelope as EncryptedEnvelope,
      localDeviceId: WINDOWS_IDENTITY.deviceId,
      localPrivateKey: windowsKeys.privateKey,
      localPublicKey: windowsKeys.publicKey,
      peerPublicKey: androidPeerIdentity.publicKey
    });

    if (decoded.type === "TEXT_SHARE") {
      const payload = decoded.payload as any;
      console.log("\n📬 [Windows Received Text/Link Share]!");
      console.log(`- Type: ${payload.contentType.toUpperCase()}`);
      console.log(`- Content: "${payload.text}"`);
      console.log(`- Sent At: ${new Date(payload.createdAt).toLocaleTimeString()}`);
      return;
    }
  } catch (_) {}

  // 2. Try decoding as File Offer
  try {
    const decodedFile = await decodeFileTransferEnvelope({
      envelope: envelope,
      localDeviceId: WINDOWS_IDENTITY.deviceId,
      localPrivateKey: windowsKeys.privateKey,
      localPublicKey: windowsKeys.publicKey,
      peerPublicKey: androidPeerIdentity.publicKey
    });

    if (decodedFile && decodedFile.controlMessage) {
      const cm = decodedFile.controlMessage as any;
      if (cm.type === "FILE_OFFER") {
        const payload = cm.payload;
        console.log("\n📂 [Windows Received File Offer]!");
        console.log(`- File Name: "${payload.fileName}"`);
        console.log(`- Size: ${(payload.fileSize / 1024).toFixed(2)} KB (${payload.fileSize} bytes)`);
        console.log(`- MIME Type: ${payload.mimeType}`);
        console.log(`- SHA-256: ${payload.sha256}`);
        console.log("✅ Auto-accepting and simulating complete transfer...");
        return;
      }
    }
  } catch (_) {}
}

async function main(): Promise<void> {
  console.log("=== CrossBridge Dev Windows Mock Client ===");
  windowsKeys = await generateDevelopmentKeyPair();
  WINDOWS_IDENTITY = {
    deviceId: "windows_dev_test_id",
    deviceName: "Dev Windows PC",
    platform: "windows",
    publicKey: windowsKeys.publicKey
  };

  const socket = await connect(RELAY_URL, WINDOWS_IDENTITY.deviceId);
  console.log("Connected to local relay successfully.");

  // 1. Create pairing session
  send(socket, {
    type: "PAIRING_SESSION_CREATE",
    payload: {
      deviceIdentity: WINDOWS_IDENTITY
    }
  });

  const sessionCreated = await waitForType<{
    type: "PAIRING_SESSION_CREATED";
    payload: { qrPayload: PairingQrPayload };
  }>(socket, "PAIRING_SESSION_CREATED");

  const qrPayload = sessionCreated.payload.qrPayload;
  console.log("\n================ QR PAYLOAD JSON ================");
  // Note: Emulator needs 10.0.2.2 as relay URL
  const emulatorQrPayload = {
    ...qrPayload,
    relayUrl: "ws://10.0.2.2:8787/connect"
  };
  console.log(JSON.stringify(emulatorQrPayload, null, 2));
  console.log("=================================================\n");
  console.log("👉 Paste the JSON above into 'Paste QR JSON for dev testing' screen in the Android app.\n");

  // 2. Wait for Android to join
  console.log("Waiting for Android device to join...");
  const joined = await waitForType<{
    type: "PAIRING_JOINED";
    payload: { verificationCode: string; androidIdentity: any };
  }>(socket, "PAIRING_JOINED");

  androidPeerIdentity = joined.payload.androidIdentity;
  console.log(`\n🎉 Android joined! Device Name: ${androidPeerIdentity.deviceName} (${androidPeerIdentity.deviceId})`);
  console.log(`Verification Code: ${joined.payload.verificationCode}`);

  await askQuestion("\nPress Enter to CONFIRM pairing on Windows side...");

  // 3. Confirm pairing
  send(socket, {
    type: "PAIRING_CONFIRM",
    payload: {
      pairingSessionId: qrPayload.pairingSessionId,
      deviceId: WINDOWS_IDENTITY.deviceId
    }
  });

  console.log("Pairing confirmed. Waiting for pairing completion...");
  const complete = await waitForType<{
    type: "PAIRING_COMPLETE";
  }>(socket, "PAIRING_COMPLETE");

  console.log("🎉 Pairing Complete! Android device is now trusted.");

  // 4. Establish Trusted Connection
  console.log("\nEstablishing trusted connection...");
  send(socket, {
    type: "TRUSTED_DEVICE_HELLO",
    payload: {
      deviceIdentity: WINDOWS_IDENTITY,
      trustedPeerIds: [androidPeerIdentity.deviceId]
    }
  });

  // Listen for message events on WebSocket
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
  console.log("Type 'exit' to quit or type 'text <content>' to send a text share to the Android device.");

  // Keep script running and handle input
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
          toDeviceId: androidPeerIdentity.deviceId,
          payload: {
            shareId,
            fromDeviceId: WINDOWS_IDENTITY.deviceId,
            toDeviceId: androidPeerIdentity.deviceId,
            contentType: textToSend.startsWith("http") ? "url" : "text",
            text: textToSend,
            createdAt: now
          }
        };
        const envelope = await encryptAppMessage({
          message: appMessage,
          localPrivateKey: windowsKeys.privateKey,
          localPublicKey: windowsKeys.publicKey,
          peerPublicKey: androidPeerIdentity.publicKey
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
