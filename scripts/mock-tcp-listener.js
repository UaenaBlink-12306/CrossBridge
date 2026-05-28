// Standalone mock TCP probe listener matching CrossBridge Windows probe protocol
import net from "node:net";

const PORT = 8789;
const HOST = "0.0.0.0";

const server = net.createServer((socket) => {
  console.log(`[Mock TCP Listener] Client connected: ${socket.remoteAddress}:${socket.remotePort}`);
  
  socket.write("CROSSBRIDGE_PROBE_ACK\n", "utf8", () => {
    console.log("[Mock TCP Listener] Sent CROSSBRIDGE_PROBE_ACK");
    socket.end();
  });
  
  socket.on("error", (err) => {
    console.error("[Mock TCP Listener] Socket error:", err.message);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[Mock TCP Listener] Server listening on ${HOST}:${PORT}`);
});

process.on("SIGINT", () => {
  server.close(() => {
    console.log("[Mock TCP Listener] Closed");
    process.exit(0);
  });
});
