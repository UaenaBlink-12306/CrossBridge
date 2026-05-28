import { readFile } from "node:fs/promises";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { WebSocket } from "ws";

interface DeviceIdentity {
  deviceId: string;
  deviceName: string;
  platform: "android";
  publicKey: string;
}

interface PairingQrPayload {
  protocol: "crossbridge-v1";
  pairingSessionId: string;
  relayUrl: string;
  pairingToken: string;
}

const androidIdentity: DeviceIdentity = {
  deviceId: "android_xxx",
  deviceName: "Pixel",
  platform: "android",
  publicKey: "YW5kcm9pZC1wdWJsaWMta2V5"
};

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function isQrPayload(value: unknown): value is PairingQrPayload {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "protocol" in value &&
    value.protocol === "crossbridge-v1" &&
    "pairingSessionId" in value &&
    typeof value.pairingSessionId === "string" &&
    "relayUrl" in value &&
    typeof value.relayUrl === "string" &&
    "pairingToken" in value &&
    typeof value.pairingToken === "string";
}

async function loadQrPayload(): Promise<PairingQrPayload> {
  const qrPath = argValue("--qr");
  const raw = qrPath ? await readFile(qrPath, "utf8") : await readStdin();
  const parsed = JSON.parse(raw.trim().replace(/^\uFEFF/, "")) as unknown;
  if (!isQrPayload(parsed)) {
    throw new Error("QR payload JSON is not a CrossBridge pairing payload.");
  }
  return parsed;
}

async function waitForEnter(): Promise<void> {
  const readline = createInterface({ input, output });
  try {
    await readline.question("Press Enter after clicking Confirm pairing in the Windows UI...");
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

async function connect(relayUrl: string): Promise<WebSocket> {
  const socket = new WebSocket(relayUrl);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  send(socket, {
    type: "RELAY_HELLO",
    deviceId: androidIdentity.deviceId,
    sessionToken: `token_${androidIdentity.deviceId}`,
    protocolVersion: 1
  });
  await waitForType(socket, "RELAY_WELCOME");
  return socket;
}

async function main(): Promise<void> {
  const qrPayload = await loadQrPayload();
  const socket = await connect(qrPayload.relayUrl);

  try {
    send(socket, {
      type: "PAIRING_JOIN",
      payload: {
        pairingSessionId: qrPayload.pairingSessionId,
        pairingToken: qrPayload.pairingToken,
        deviceIdentity: androidIdentity
      }
    });

    const joined = await waitForType<{
      type: "PAIRING_JOINED";
      payload: { verificationCode: string };
    }>(socket, "PAIRING_JOINED");

    console.log(`Android joined as ${androidIdentity.deviceName}.`);
    console.log(`Verification code: ${joined.payload.verificationCode}`);

    if (!hasArg("--auto-confirm")) {
      await waitForEnter();
    }

    send(socket, {
      type: "PAIRING_CONFIRM",
      payload: {
        pairingSessionId: qrPayload.pairingSessionId,
        deviceId: androidIdentity.deviceId
      }
    });

    const complete = await waitForType<{
      type: "PAIRING_COMPLETE";
      payload: {
        trustedDevices: Array<{ deviceName: string; deviceId: string; platform: string }>;
      };
    }>(socket, "PAIRING_COMPLETE");
    const trustedPc = complete.payload.trustedDevices.find((device) => device.platform === "windows");
    console.log("Pairing complete.");
    if (trustedPc) {
      console.log(`Trusted Windows device: ${trustedPc.deviceName} (${trustedPc.deviceId})`);
    }
  } finally {
    socket.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
