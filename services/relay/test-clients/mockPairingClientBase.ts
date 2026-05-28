import { once } from "node:events";
import { WebSocket } from "ws";
import type { DeviceIdentity, PairingCompletePayload, TrustedDevice } from "@crossbridge/protocol";

interface QueuedWaiter<T> {
  predicate: (message: unknown) => message is T;
  resolve: (message: T) => void;
  reject: (error: Error) => void;
}

export class MockPairingClientBase {
  readonly trustedDevices = new Map<string, TrustedDevice>();
  protected socket?: WebSocket;
  private readonly inbox: unknown[] = [];
  private readonly waiters: QueuedWaiter<unknown>[] = [];

  constructor(readonly identity: DeviceIdentity) {}

  async connect(relayUrl: string, sessionToken = `token_${this.identity.deviceId}`): Promise<void> {
    const socket = new WebSocket(relayUrl);
    this.socket = socket;

    socket.on("message", (data) => {
      const parsed = JSON.parse(data.toString()) as unknown;
      this.enqueue(parsed);
    });
    socket.on("error", (error) => {
      this.rejectWaiters(error instanceof Error ? error : new Error(String(error)));
    });

    await once(socket, "open");
    this.send({
      type: "RELAY_HELLO",
      deviceId: this.identity.deviceId,
      sessionToken,
      protocolVersion: 1
    });
    await this.waitForType("RELAY_WELCOME");
  }

  close(): void {
    this.socket?.close();
  }

  protected send(message: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Mock pairing client is not connected.");
    }
    this.socket.send(JSON.stringify(message));
  }

  protected waitForType<T extends { type: string }>(type: string): Promise<T> {
    return this.waitFor((message): message is T => {
      return typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === type;
    });
  }

  protected saveTrustedPeer(payload: PairingCompletePayload): void {
    for (const device of payload.trustedDevices) {
      if (device.deviceId !== this.identity.deviceId) {
        this.trustedDevices.set(device.deviceId, device);
      }
    }
  }

  private waitFor<T>(predicate: (message: unknown) => message is T): Promise<T> {
    const existingIndex = this.inbox.findIndex(predicate);
    if (existingIndex >= 0) {
      const [message] = this.inbox.splice(existingIndex, 1);
      return Promise.resolve(message as T);
    }

    return new Promise<T>((resolve, reject) => {
      this.waiters.push({ predicate, resolve: resolve as (message: unknown) => void, reject });
    });
  }

  private enqueue(message: unknown): void {
    const waiterIndex = this.waiters.findIndex((waiter) => waiter.predicate(message));
    if (waiterIndex >= 0) {
      const [waiter] = this.waiters.splice(waiterIndex, 1);
      waiter?.resolve(message);
      return;
    }

    this.inbox.push(message);
  }

  private rejectWaiters(error: Error): void {
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(error);
    }
  }
}
