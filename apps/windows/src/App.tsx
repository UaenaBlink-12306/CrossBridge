import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  Bug,
  Home,
  QrCode,
  Send,
  Settings,
  ShieldCheck,
  Smartphone,
  Upload
} from "lucide-react";
import { connectionStatusLabel } from "./components/ConnectionStatusCard.js";
import { DevicesPage } from "./pages/DevicesPage.js";
import { HomePage, NotificationFeedPage, TransfersPage } from "./pages/HomePage.js";
import { PairDevicePage } from "./pages/PairDevicePage.js";
import { SharePage } from "./pages/SharePage.js";
import { ConnectionManager, type ConnectionViewState } from "./services/connectionManager.js";
import { invokeTauriCommand, isTauriRuntime } from "./services/nativeBridge.js";

type PageId = "home" | "pair" | "devices" | "share" | "transfers" | "notifications" | "settings" | "debug";

interface NavItem {
  id: PageId;
  label: string;
  icon: typeof Home;
}

const navItems: NavItem[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "pair", label: "Pair", icon: QrCode },
  { id: "devices", label: "Devices", icon: Smartphone },
  { id: "share", label: "Share", icon: Send },
  { id: "transfers", label: "Transfers", icon: Upload },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "debug", label: "Debug", icon: Bug }
];

const connectionEvents = [
  "Windows app opened",
  "Relay not connected yet",
  "Waiting for phone"
];

function AppHeader({ connectionState }: { connectionState: ConnectionViewState }) {
  const connected = connectionState.phase === "trusted_device_online" ||
    connectionState.phase === "connected_to_relay";

  return (
    <header className="app-header">
      <div className="brand">
        <div className="brand-mark">
          <ShieldCheck size={22} aria-hidden="true" />
        </div>
        <div>
          <h1>CrossBridge</h1>
          <p>{connectionStatusLabel(connectionState)}</p>
        </div>
      </div>
      <div className="connection-pill">
        <span className={connected ? "status-dot online" : "status-dot"} />
        {connectionStatusLabel(connectionState)}
      </div>
    </header>
  );
}

function Sidebar({ activePage, onSelect }: { activePage: PageId; onSelect: (page: PageId) => void }) {
  return (
    <nav className="sidebar" aria-label="Main navigation">
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            className={activePage === item.id ? "nav-button active" : "nav-button"}
            type="button"
            onClick={() => onSelect(item.id)}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function SettingsPage() {
  return (
    <section className="page settings-list">
      <p>These settings are preview-only right now. Signed startup behavior and saved privacy preferences are still release work.</p>
      <label className="setting-row">
        <span>
          <strong>Start minimized (planned)</strong>
          <small>Requires the native Windows runtime plus signed startup wiring.</small>
        </span>
        <input type="checkbox" disabled />
      </label>
      <label className="setting-row">
        <span>
          <strong>Hide sensitive notification text (planned)</strong>
          <small>Will let Windows show app names while keeping mirrored message text hidden.</small>
        </span>
        <input type="checkbox" checked disabled readOnly />
      </label>
    </section>
  );
}

function DebugPage({ connectionState }: { connectionState: ConnectionViewState }) {
  const debugText = useMemo(() => connectionEvents.join("\n"), []);
  const [exported, setExported] = useState(false);

  const isRelayConnected = connectionState.relayConnectionState === "connected";
  const isLanConnected = connectionState.trustedDevices.some((d) => d.online && d.localFastPathAvailable);
  const currentTransport = isLanConnected ? "LAN (Fast Path)" : (isRelayConnected ? "Relay Path" : "Disconnected");

  function exportLogs() {
    const blob = new Blob([debugText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "crossbridge-debug-log.txt";
    anchor.click();
    URL.revokeObjectURL(url);
    setExported(true);
  }

  return (
    <section className="page">
      <div className="debug-grid">
        <div className="debug-row"><span>Protocol version</span><strong>1</strong></div>
        <div className="debug-row"><span>Current transport</span><strong>{currentTransport}</strong></div>
        <div className="debug-row"><span>Relay connected</span><strong>{isRelayConnected ? "true" : "false"}</strong></div>
        <div className="debug-row"><span>LAN connected</span><strong>{isLanConnected ? "true" : "false"}</strong></div>
        <div className="debug-row"><span>Last heartbeat</span><strong>{isRelayConnected ? "Active" : "None"}</strong></div>
      </div>
      <pre className="event-log">{debugText}</pre>
      <button className="secondary-action" type="button" onClick={exportLogs}>
        <Send size={16} aria-hidden="true" />
        {exported ? "Logs exported" : "Export logs"}
      </button>
    </section>
  );
}

export function App() {
  const [activePage, setActivePage] = useState<PageId>("home");
  const [connectionManager] = useState(() => new ConnectionManager());
  const [connectionState, setConnectionState] = useState(() => connectionManager.getState());

  useEffect(() => {
    let unsubscribeTrayReconnect: (() => void) | undefined;
    if (isTauriRuntime()) {
      import("@tauri-apps/api/event").then(({ listen }) => {
        void listen("tray-reconnect", () => {
          void connectionManager.reconnectNow();
        }).then((unsub) => {
          unsubscribeTrayReconnect = unsub;
        });
      });
    }

    const unsubscribe = connectionManager.onStateChange((state) => {
      setConnectionState(state);
      if (isTauriRuntime()) {
        const label = connectionStatusLabel(state);
        void invokeTauriCommand("update_tray_status", { status: label });
      }
    });

    void connectionManager.start();
    return () => {
      unsubscribe();
      if (unsubscribeTrayReconnect) unsubscribeTrayReconnect();
      connectionManager.stop();
    };
  }, [connectionManager]);

  return (
    <div className="app-shell">
      <AppHeader connectionState={connectionState} />
      <div className="app-body">
        <Sidebar activePage={activePage} onSelect={setActivePage} />
        <main className="main-panel">
          {activePage === "home" && (
            <HomePage
              connectionState={connectionState}
              onPair={() => setActivePage("pair")}
              onRelayUrlChange={(relayUrl) => {
                void connectionManager.setRelayUrl(relayUrl);
              }}
              onReconnect={() => {
                void connectionManager.reconnectNow();
              }}
            />
          )}
          {activePage === "pair" && <PairDevicePage />}
          {activePage === "devices" && (
            <DevicesPage
              connectionState={connectionState}
              onReconnect={() => {
                void connectionManager.reconnectNow();
              }}
              onRemoveDevice={(deviceId) => {
                void connectionManager.removeTrustedDevice(deviceId);
              }}
            />
          )}
          {activePage === "share" && (
            <SharePage
              connectionState={connectionState}
              onSendTextShare={(toDeviceId, text) => connectionManager.sendTextShare(toDeviceId, text)}
            />
          )}
          {activePage === "transfers" && (
            <TransfersPage
              connectionState={connectionState}
              onSendFileOffer={(toDeviceId, fileName, mimeType, bytes) =>
                connectionManager.sendFileOffer(toDeviceId, fileName, mimeType, bytes)
              }
              onAcceptFileOffer={(transferId) => connectionManager.acceptFileOffer(transferId)}
              onRejectFileOffer={(transferId) => connectionManager.rejectFileOffer(transferId)}
              onCancelFileTransfer={(transferId) => connectionManager.cancelFileTransfer(transferId)}
            />
          )}
          {activePage === "notifications" && (
            <NotificationFeedPage
              connectionState={connectionState}
              onDismissNotification={(sourceDeviceId, notificationId) => {
                void connectionManager.dismissNotification(sourceDeviceId, notificationId);
              }}
              onReplyNotification={(sourceDeviceId, notificationId, actionId, replyText) => {
                void connectionManager.sendNotificationReply(
                  sourceDeviceId,
                  notificationId,
                  actionId,
                  replyText
                );
              }}
            />
          )}
          {activePage === "settings" && <SettingsPage />}
          {activePage === "debug" && <DebugPage connectionState={connectionState} />}
        </main>
      </div>
    </div>
  );
}
