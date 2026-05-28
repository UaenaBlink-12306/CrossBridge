import type { WebSocketServer, WebSocket } from "ws";

type HeartbeatSocket = WebSocket & { isAlive?: boolean };

export function attachHeartbeat(wss: WebSocketServer, intervalMs: number): () => void {
  wss.on("connection", (socket: HeartbeatSocket) => {
    socket.isAlive = true;
    socket.on("pong", () => {
      socket.isAlive = true;
    });
  });

  const timer = setInterval(() => {
    for (const socket of wss.clients as Set<HeartbeatSocket>) {
      if (socket.isAlive === false) {
        socket.terminate();
        continue;
      }

      socket.isAlive = false;
      socket.ping();
    }
  }, intervalMs);

  timer.unref();
  return () => clearInterval(timer);
}
