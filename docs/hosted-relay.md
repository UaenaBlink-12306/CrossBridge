# CrossBridge Hosted Relay Deployment & Configuration

This guide explains how to configure, run, and deploy the CrossBridge WebSocket relay server to a hosted VPS or cloud provider. It also provides a matrix for configuring local and physical device testing.

---

## 1. High-Level Architecture & Security Boundaries

The CrossBridge relay is a **stateless, "dumb" WebSocket server** designed to route encrypted envelopes between mutually trusted online devices. 

To maintain security and trust, the relay operates under these strict rules:
* **No Plaintext Access**: The relay only sees metadata (e.g., sender, receiver, message ID, nonces) and a ciphertext blob. It cannot inspect payload text, URLs, files, or actions.
* **No Persistent Cloud Storage**: The relay tracks online connections in memory. It does not write messages or device relationships to any database or disk.
* **No Key Access**: The relay never receives, generates, or stores private encryption keys. All key agreement (ECDH P-256) happens purely on the clients (Windows/Android).
* **VPN Compatibility**: Because all communications use standard outbound HTTP/WebSocket ports and TLS connections, **VPNs can stay active** on both devices. Local discovery or port forwarding is not required.

---

## 2. Environment Configuration

The relay loads settings from environment variables with safe defaults:

| Variable | Default | Purpose | Fallback / Cloud Host Support |
| :--- | :--- | :--- | :--- |
| `CROSSBRIDGE_RELAY_HOST` | `127.0.0.1` | IP interface to bind to. Set to `0.0.0.0` for LAN or public networks. | `HOST` |
| `CROSSBRIDGE_RELAY_PORT` | `8787` | Port for Fastify HTTP and WebSocket traffic. | `PORT` |
| `CROSSBRIDGE_RELAY_PUBLIC_URL` | *Derived* | Public WebSocket URL. Used when generating the QR code payload. | *Auto-detected from Host header* |
| `CROSSBRIDGE_RELAY_MAX_PAYLOAD_BYTES` | `2,000,000` | Maximum size in bytes of incoming message payloads (e.g. file chunks). | — |
| `CROSSBRIDGE_RELAY_HEARTBEAT_MS` | `30,000` | WebSocket ping/pong interval to clean up stale sockets. | — |
| `CROSSBRIDGE_RELAY_TOKEN_MIN_LENGTH` | `8` | Minimum length required for relay session tokens. | — |
| `CROSSBRIDGE_PAIRING_TTL_MS` | `120,000` | Lifetime in milliseconds of short-lived pairing sessions (default 2 mins). | — |
| `CROSSBRIDGE_PAIRING_CLEANUP_MS` | `30,000` | Interval in milliseconds at which expired pairing sessions are garbage collected. | — |

---

## 3. Local & Production Testing Matrix

| Scenario | Windows Relay URL | Android QR Relay URL | Binding | Required Setup |
| :--- | :--- | :--- | :--- | :--- |
| **Local Emulator** | `ws://127.0.0.1:8787/connect` | `ws://10.0.2.2:8787/connect` | `127.0.0.1` | Run Windows app & Emulator on same PC. |
| **Physical Phone (LAN)** | `ws://127.0.0.1:8787/connect` | `ws://<PC-LAN-IP>:8787/connect` | `0.0.0.0` | Set `CROSSBRIDGE_RELAY_HOST=0.0.0.0`. |
| **Hosted Production** | `wss://<your-domain>/connect` | `wss://<your-domain>/connect` | `0.0.0.0` | Run with HTTPS reverse proxy. |

> [!NOTE]
> Physical LAN phone testing requires binding the relay to `0.0.0.0` so other devices on the same Wi-Fi router can reach the PC's LAN IP.

---

## 4. VPS / Cloud Deployment Guide

> [!TIP]
> For a detailed, step-by-step checklist of deployment commands, DNS mappings, TLS configurations, and verification playbooks for Render and VPS, see the [Hosted Relay Deployment Checklist](hosted-relay-deployment-checklist.md).

### A. Architectural Scaling Constraints (CRITICAL)
Before deploying to production, it is vital to understand the **in-memory lifecycle** of the CrossBridge relay:
* **In-Memory Active Sockets**: WebSocket connections are mapped in-memory in `ConnectionManager`. The server routes envelope packets directly between these connected sockets.
* **In-Memory Pairing Sessions**: Short-lived pairing sessions and verification states are stored in an in-memory `Map` with a 2-minute TTL.
* **Production Scaling Impact**:
  * **Single-Instance Deployment (Recommended)**: Running a single server instance is the simplest, most reliable setup. Both the Windows PC and the Android phone will connect to the same server, ensuring pairing and envelope routing succeed instantly.
  * **Multi-Instance / Load-Balanced Deployment**: If running multiple instances behind a load balancer (for high availability or geographic proximity), you **must** configure **Sticky Sessions (Session Affinity)** based on client IP or a session cookie. Without sticky sessions, client WebSocket handshakes and pairing requests will route to different servers, preventing devices from discovering each other or routing messages. A Redis/pub-sub backplane is not implemented in this version.

---

### B. General Node.js Host or VPS (Ubuntu/Debian)
1. **Clone and Install Dependencies**:
   ```bash
   git clone <your-repo-url> crossbridge
   cd crossbridge
   npm install --production
   ```
2. **Build the Workspace Packages**:
   Build the protocol and relay packages:
   ```bash
   npm run build -w @crossbridge/protocol
   npm run build -w @crossbridge/relay
   ```
3. **Start the Relay Server**:
   Provide the production variables:
   ```bash
   export PORT=8787
   export HOST=0.0.0.0
   export CROSSBRIDGE_RELAY_PUBLIC_URL="wss://relay.example.com/connect"
   npm run relay:start:prod
   ```

4. **Running with PM2 (Process Keep-Alive & Restart Strategy)**:
   PM2 is excellent for keeping the relay running and automatically restarting it on crashes.
   
   * **Installation**:
     ```bash
     sudo npm install -g pm2
     ```
   * **Start Command**:
     ```bash
     # Single instance recommended due to in-memory state constraints:
     CROSSBRIDGE_RELAY_HOST="0.0.0.0" \
     CROSSBRIDGE_RELAY_PORT=8787 \
     CROSSBRIDGE_RELAY_PUBLIC_URL="wss://relay.yourdomain.com/connect" \
     pm2 start services/relay/dist/index.js --name "crossbridge-relay" --max-memory-restart 200M
     ```
   * **PM2 Startup & Persistence**:
     ```bash
     pm2 save
     pm2 startup
     # Run the command generated by the startup script to register the service
     ```
   * **Restart Policies**:
     - `--max-memory-restart 200M`: Restarts the process if heap usage leaks beyond 200MB (safe limit for the stateless relay).
     - `--exp-backoff-restart-delay 100`: Prevents thrashing by introducing exponential backoff if the relay enters a crash loop.

---

### C. PaaS / Cloud Containers (Render, Fly.io, Google Cloud Run)
The relay naturally integrates with modern cloud platforms because it reads `PORT` and `HOST` out of the box.

* **Render / Fly.io Configuration**:
  * **Build Command**: `npm install && npm run build`
  * **Start Command**: `node services/relay/dist/index.js`
  * **Environment Variables**:
    * `HOST`: `0.0.0.0`
    * `PORT`: `8787` (Render overrides this automatically)
    * `CROSSBRIDGE_RELAY_PUBLIC_URL`: `wss://<your-app-name>.onrender.com/connect`

* **Google Cloud Run Configuration**:
  * Because Cloud Run is auto-scaling and serverless, special care must be taken with state:
    * **Max Instances**: Set `max-instances` to `1` (unless a session-affinity-aware load balancer is configured in front of it).
    * **Session Affinity**: Enable Session Affinity in the Cloud Run service settings.
    * **CPU Allocation**: Select "CPU is always allocated" to prevent background throttling of WebSocket heartbeats.
    * **Connection Concurrency**: Set concurrency to `1000` (Fastify can easily handle 1000 simultaneous idle WebSockets on a single container instance).

---

## 5. SSL/TLS & Reverse Proxy Configuration

A secure hosted relay must run over `wss://` (WebSocket Secure). The easiest way to configure this is to run Nginx or Caddy on your VPS as a reverse proxy to terminate TLS (SSL) and forward traffic to the local Fastify/ws instance.

### Option A: Nginx Configuration
Add the following virtual host definition to `/etc/nginx/sites-available/crossbridge`:

```nginx
server {
    listen 80;
    server_name relay.your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name relay.your-domain.com;

    # SSL Certificate Configuration (e.g. Certbot / Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/relay.your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/relay.your-domain.com/privkey.pem;

    # Optimal SSL Settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass http://127.0.0.1:8787;
        
        # Enable HTTP/1.1 for keepalive & WebSockets
        proxy_http_version 1.1;
        
        # Required headers for WebSocket connections
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # Standard proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket timeouts (prevent premature proxy disconnects)
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        
        # Disable buffering for WebSockets
        proxy_buffering off;
    }
}
```

### Option B: Caddy Configuration
Caddy automatically provisions SSL certificates and handles proxying with a tiny configuration in your `Caddyfile`:

```caddy
relay.yourdomain.com {
    reverse_proxy 127.0.0.1:8787 {
        header_up Host {host}
        header_up X-Real-IP {remote}
        
        # Enable WebSocket upgrades automatically
        transport http {
            keepalive 30s
        }
    }
}
```

---

## 6. Health Checks, Logging & Monitoring

### A. Health Endpoint
The relay server exposes a lightweight health endpoint to facilitate automated deployment checks and uptime monitoring.

* **Health Endpoint**: `https://<your-host>/health`
* **HTTP Method**: `GET`
* **Response Status Codes**:
  * `200 OK`: Server is healthy, event loop is responsive, and connections are open.
  * `503 Service Unavailable`: Server is unhealthy or shutting down.
* **Response Payload (JSON)**:
  ```json
  {
    "ok": true,
    "onlineDevices": 12
  }
  ```

Query health status locally or publicly with curl:
```bash
curl -i https://relay.yourdomain.com/health
```
This endpoint is safe to expose publicly because it returns only basic boolean health status and an anonymous count of online connections. No device metadata, tokens, or session identifiers are ever leaked.

---

### B. Logs and Monitoring
The relay is configured with Fastify's structured `pino` logger, which outputs JSON logs directly to `stdout`.

* **Structured JSON Log Format**:
  Every request, WebSocket connection, pairing handshake, and system event is logged in standard JSON format:
  ```json
  {"level":30,"time":1779948006078,"pid":46708,"hostname":"Adam","msg":"[CrossBridge Relay] WebSocket connect path: ws://127.0.0.1:8787/connect"}
  ```
  
* **Log Levels**:
  * `30 (INFO)`: Connection registrations, pairing creations, pairing completions, server lifecycle.
  * `40 (WARN)`: Unauthorized socket access, connection replacement warnings, heartbeat check timeouts.
  * `50 (ERROR)`: Uncaught exceptions, routing failures.

* **Production Log Rotation & Aggregation**:
  - **With PM2**: Install `pm2-logrotate` to prevent local logs from consuming all disk space:
    ```bash
    pm2 install pm2-logrotate
    pm2 set pm2-logrotate:max_size 10M
    pm2 set pm2-logrotate:retain 7
    ```
  - **With Cloud Run / Render**: Logs printed to `stdout` are automatically captured by Google Cloud Logging or Render's central log aggregation, where they can be queried or alert rules established.
  
* **Metrics to Monitor**:
  1. **Active Sockets**: Graph `onlineDevices` returned from `/health` to track user adoption and connection spikes.
  2. **WebSocket Upgrades**: Monitor HTTP `101 Switching Protocols` response codes on `/connect`.
  3. **Process CPU and Memory**: Track memory growth to verify the in-memory `Map` cleaning garbage-collection intervals are running correctly.
