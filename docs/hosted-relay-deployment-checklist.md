# CrossBridge Production Relay Deployment Playbook

This playbook provides exact, step-by-step instructions to deploy the CrossBridge stateless WebSocket relay server to production hosting. Since local verification is 100% complete and passed, these guidelines represent the final production-ready path.

---

## 1. Selected Platform: Render (PaaS)
Render is our primary recommended target because it provides automated TLS termination, native WebSockets support (HTTP/1.1 Upgrade), auto-scaling, and painless Node.js environment setup.

### A. Prerequisites & Accounts
- [ ] **Render Account**: Register at [render.com](https://render.com).
- [ ] **GitHub / GitLab Repository**: Push the `crossbridge` workspace to a private or public repository that Render can access.
- [ ] **Custom Domain (Optional)**: A domain name (e.g., `relay.yourdomain.com`) to map to the Render web service.

### B. Render Web Service Configuration Settings
Create a new **Web Service** on Render with the following configuration:

1. **Connect Repository**: Point to your pushed `crossbridge` repository.
2. **Runtime**: `Node`
3. **Region**: Choose the region closest to your primary users (e.g., `Oregon (US West)`, `Frankfurt (EU Central)`).
4. **Branch**: `main` (or your active development branch).
5. **Root Directory**: *Keep empty* (runs from the root of the workspace).
6. **Build Command**:
   ```bash
   npm install && npm run build
   ```
7. **Start Command**:
   ```bash
   node services/relay/dist/index.js
   ```
8. **Plan**: `Web Service (Free)` or `Starter` (Starter is recommended to prevent service spinning down after inactivity, which disconnects idle clients).

### C. Environment Variables (Render Dashboard)
Configure the following environment variables in the **Environment** tab of your Render Web Service:

| Variable | Value | Purpose |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Enables production optimizations. |
| `HOST` | `0.0.0.0` | Binds Fastify to all network interfaces. |
| `PORT` | `8787` | Tells Fastify which port to listen on. |
| `CROSSBRIDGE_RELAY_PUBLIC_URL` | `wss://<your-service-name>.onrender.com/connect` | Public WebSocket entrypoint (replace `<your-service-name>` with your actual Render URL or your custom domain: `wss://relay.yourdomain.com/connect`). |
| `CROSSBRIDGE_RELAY_MAX_PAYLOAD_BYTES` | `2000000` | Limits maximum size of incoming WebSocket data chunks (2 MB) for file transfers. |
| `CROSSBRIDGE_RELAY_HEARTBEAT_MS` | `30000` | Websocket ping/pong interval (30 seconds) to clean up stale sockets. |
| `CROSSBRIDGE_RELAY_TOKEN_MIN_LENGTH` | `8` | Security minimum size for generated session tokens. |

---

## 2. Alternative Platform: VPS (Ubuntu/Debian) with Caddy & PM2
For maximum performance, lowest latency, and no background spin-downs, deploying to a standard VPS is the optimal self-hosted route.

### A. System Setup & Dependencies
Run the following commands on a clean Ubuntu/Debian VPS instance:

```bash
# 1. Install Node.js v22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Verify Node.js and npm version
node -v
npm -v

# 3. Install Git and PM2 process manager
sudo apt-get update
sudo apt-get install -y git
sudo npm install -g pm2
```

### B. Clone, Install, and Compile
```bash
# 1. Clone workspace
git clone <your-repository-url> /var/www/crossbridge
cd /var/www/crossbridge

# 2. Install production dependencies
npm install --production

# 3. Compile protocol and relay packages
npm run build -w @crossbridge/protocol
npm run build -w @crossbridge/crypto
npm run build -w @crossbridge/shared-types
npm run build -w @crossbridge/relay
```

### C. Process Keep-Alive with PM2
Start the relay service with required production environment variables:

```bash
# Start the relay server under PM2 control
env HOST=0.0.0.0 \
    PORT=8787 \
    CROSSBRIDGE_RELAY_PUBLIC_URL="wss://relay.yourdomain.com/connect" \
    CROSSBRIDGE_RELAY_MAX_PAYLOAD_BYTES=2000000 \
    pm2 start services/relay/dist/index.js --name "crossbridge-relay"

# Save the process list to revive on system restarts
pm2 save

# Generate and configure the systemd startup hook
pm2 startup
# (Copy and paste the command printed by PM2 into your terminal to enable startup persistence)
```

### D. Reverse Proxy and Auto-TLS with Caddy
Caddy automatically provisions Let's Encrypt certificates and handles TLS termination.

```bash
# 1. Install Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy

# 2. Configure Caddyfile
# Edit /etc/caddy/Caddyfile and replace its contents with:
relay.yourdomain.com {
    reverse_proxy 127.0.0.1:8787 {
        header_up Host {host}
        header_up X-Real-IP {remote}
    }
}

# 3. Reload Caddy config to provision SSL and go live
sudo systemctl reload caddy
```

---

## 3. Post-Deployment Verification Playbook
Once the server starts listening, execute these manual and E2E verification steps:

### Step 1: Query Lightweight Health check over HTTPS
```bash
curl -i https://<your-deployed-domain>/health
```
**Expected Response:**
```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{"ok":true,"onlineDevices":0}
```

### Step 2: Validate WebSocket Handshake Upgrade
```bash
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" https://<your-deployed-domain>/connect
```
**Expected Response:**
```http
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
```

### Step 3: Run Full Client-to-Client E2E Suite Against Public Endpoint
Run this directly from your local development repository to verify secure pairing, cryptography, link sharing, and multi-chunk file transfers:

```bash
# Replace with your actual public WSS endpoint
CROSSBRIDGE_RELAY_URL="wss://<your-deployed-domain>/connect" npx tsx scripts/e2e-verify.ts
```
**Expected Output:**
```text
=== CrossBridge E2E Verification ===

Relay URL: wss://relay.yourdomain.com/connect

── Step 1: Relay health check ──
  ✅ PASS: Relay /health returns ok
  Online devices: 0

── Step 2: Create pairing session (Windows side) ──
  ✅ PASS: Pairing session created with ID
  ✅ PASS: QR payload has correct protocol
  ...
=== E2E Verification Summary ===
  Passed: 104
  Failed: 0
  Total:  104
```

---

## 4. Client Configuration Guidelines

To connect your clients to the newly deployed public relay:

### A. Windows Desktop App Configuration
1. Open the Windows Desktop app UI or configuration file.
2. Locate the Relay Server settings panel.
3. Change the Relay URL value to:
   `wss://<your-deployed-domain>/connect`
4. The client will establish a secure connection over TLS.

### B. Android App Configuration
1. The Android app automatically extracts the correct Relay URL from the paired PC's QR code.
2. If manual entry is required, configure the `Relay URL` preference inside the app settings to:
   `wss://<your-deployed-domain>/connect`
3. Press **Save** and verify the status changes to "Connected".
