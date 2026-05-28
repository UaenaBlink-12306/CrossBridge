import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RelayClient } from "./relayClient.js";

type Listener = {
  handler: () => void;
  once: boolean;
};

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static instances: FakeWebSocket[] = [];
  static autoOpen = true;

  readonly listeners = new Map<string, Listener[]>();
  readonly sentMessages: string[] = [];
  readyState = FakeWebSocket.CONNECTING;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
    if (FakeWebSocket.autoOpen) {
      setTimeout(() => this.openConnection(), 0);
    }
  }

  addEventListener(
    type: string,
    handler: () => void,
    options?: { once?: boolean }
  ): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push({ handler, once: Boolean(options?.once) });
    this.listeners.set(type, listeners);
  }

  send(message: string): void {
    this.sentMessages.push(message);
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    setTimeout(() => this.dispatch("close"), 0);
  }

  failConnection(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatch("error");
    this.dispatch("close");
  }

  private openConnection(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatch("open");
  }

  private dispatch(type: string): void {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(type, listeners.filter((listener) => !listener.once));
    for (const listener of listeners) {
      listener.handler();
    }
  }
}

const originalWebSocket = globalThis.WebSocket;

describe("relay client", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    FakeWebSocket.autoOpen = true;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    vi.useRealTimers();
  });

  it("does not reconnect a socket that was intentionally replaced", async () => {
    const client = new RelayClient();

    const firstConnect = client.connect("ws://relay.example/one");
    await vi.runOnlyPendingTimersAsync();
    await firstConnect;

    const secondConnect = client.connect("ws://relay.example/two");
    await vi.runOnlyPendingTimersAsync();
    await secondConnect;

    expect(FakeWebSocket.instances.map((socket) => socket.url)).toEqual([
      "ws://relay.example/one",
      "ws://relay.example/two"
    ]);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(FakeWebSocket.instances.map((socket) => socket.url)).toEqual([
      "ws://relay.example/one",
      "ws://relay.example/two"
    ]);
  });

  it("keeps transient reconnect failures out of the hard error state", async () => {
    FakeWebSocket.autoOpen = false;
    const client = new RelayClient();
    const states: string[] = [];
    client.onStateChange((state) => states.push(state));

    const firstConnect = client.connect("ws://relay.example/connect");
    FakeWebSocket.instances[0].failConnection();

    await expect(firstConnect).rejects.toThrow("Relay connection failed.");

    expect(client.getState()).toBe("reconnecting");
    expect(states).not.toContain("error");

    FakeWebSocket.autoOpen = true;
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.runOnlyPendingTimersAsync();

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(client.getState()).toBe("connected");
  });
});
