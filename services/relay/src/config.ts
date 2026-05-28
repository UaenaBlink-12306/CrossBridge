export interface RelayConfig {
  host: string;
  port: number;
  publicRelayUrl?: string;
  maxPayloadBytes: number;
  heartbeatIntervalMs: number;
  sessionTokenMinLength: number;
  pairingSessionTtlMs: number;
  pairingCleanupIntervalMs: number;
}

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  return {
    host: env.CROSSBRIDGE_RELAY_HOST ?? env.HOST ?? "127.0.0.1",
    port: readNumber(env.CROSSBRIDGE_RELAY_PORT ?? env.PORT, 8787),
    publicRelayUrl: env.CROSSBRIDGE_RELAY_PUBLIC_URL,
    maxPayloadBytes: readNumber(env.CROSSBRIDGE_RELAY_MAX_PAYLOAD_BYTES, 2_000_000),
    heartbeatIntervalMs: readNumber(env.CROSSBRIDGE_RELAY_HEARTBEAT_MS, 30_000),
    sessionTokenMinLength: readNumber(env.CROSSBRIDGE_RELAY_TOKEN_MIN_LENGTH, 8),
    pairingSessionTtlMs: readNumber(env.CROSSBRIDGE_PAIRING_TTL_MS, 120_000),
    pairingCleanupIntervalMs: readNumber(env.CROSSBRIDGE_PAIRING_CLEANUP_MS, 30_000)
  };
}
