import type { RelayConnectionState } from "../types/pairing.js";

export type { RelayConnectionState };

type MessageHandler = (message: unknown) => void;
type StateHandler = (state: RelayConnectionState) => void;

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000];
const RECONNECT_MAX_DELAY_MS = 30_000;

export function reconnectDelayMs(attempt: number): number {
  if (attempt <= 0) return RECONNECT_DELAYS_MS[0];
  return RECONNECT_DELAYS_MS[attempt - 1] ?? RECONNECT_MAX_DELAY_MS;
}

export class RelayClient {
  private socket?: WebSocket;
  private url?: string;
  private state: RelayConnectionState = "disconnected";
  private manuallyDisconnected = false;
  private reconnectAttempts = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly stateHandlers = new Set<StateHandler>();

  connect(url: string): Promise<void> {
    this.clearReconnectTimer();
    this.closeSocket();
    this.url = url;
    this.manuallyDisconnected = false;
    this.reconnectAttempts = 0;
    return this.open(url, "connecting");
  }

  disconnect(): void {
    this.manuallyDisconnected = true;
    this.clearReconnectTimer();
    this.closeSocket();
    this.setState("disconnected");
  }

  send(message: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Relay socket is not connected.");
    }
    this.socket.send(JSON.stringify(message));
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  onStateChange(handler: StateHandler): () => void {
    this.stateHandlers.add(handler);
    handler(this.state);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  getState(): RelayConnectionState {
    return this.state;
  }

  private open(url: string, state: RelayConnectionState): Promise<void> {
    this.setState(state);

    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;
      let settled = false;

      const resolveOnce = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };

      const rejectOnce = (error: Error): void => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      socket.addEventListener("open", () => {
        if (this.socket !== socket) return;
        this.reconnectAttempts = 0;
        this.setState("connected");
        resolveOnce();
      }, { once: true });

      socket.addEventListener("message", (event) => {
        if (this.socket !== socket) return;
        try {
          this.emitMessage(JSON.parse(String(event.data)));
        } catch {
          this.setState("error");
        }
      });

      socket.addEventListener("error", () => {
        if (this.socket !== socket) return;
        if (this.manuallyDisconnected || !this.url) {
          this.setState("error");
        }
        rejectOnce(new Error("Relay connection failed."));
      }, { once: true });

      socket.addEventListener("close", () => {
        const wasActiveSocket = this.socket === socket;
        if (wasActiveSocket) {
          this.socket = undefined;
        }

        if (!wasActiveSocket) {
          return;
        }

        if (this.manuallyDisconnected) {
          this.setState("disconnected");
          return;
        }

        this.scheduleReconnect();
        rejectOnce(new Error("Relay connection closed."));
      });
    });
  }

  private scheduleReconnect(): void {
    if (!this.url) {
      this.setState("error");
      return;
    }

    this.reconnectAttempts += 1;
    this.setState("reconnecting");
    const delay = reconnectDelayMs(this.reconnectAttempts);
    this.clearReconnectTimer();

    this.reconnectTimer = setTimeout(() => {
      if (!this.url || this.manuallyDisconnected) return;
      void this.open(this.url, "reconnecting").catch(() => {
        if (!this.socket && !this.manuallyDisconnected && this.url) {
          this.scheduleReconnect();
        }
      });
    }, delay);
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = undefined;
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      socket.close();
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private setState(nextState: RelayConnectionState): void {
    if (this.state === nextState) return;
    this.state = nextState;
    for (const handler of this.stateHandlers) {
      handler(nextState);
    }
  }

  private emitMessage(message: unknown): void {
    for (const handler of this.messageHandlers) {
      handler(message);
    }
  }
}
