import { describe, expect, it } from "vitest";
import { PairingSessionError, PairingSessionManager } from "../src/pairing/pairingSessions.js";

const pcIdentity = {
  deviceId: "pc_xxx",
  deviceName: "Adam-PC",
  platform: "windows" as const,
  publicKey: "cGMtcHVibGljLWtleQ=="
};

const androidIdentity = {
  deviceId: "android_xxx",
  deviceName: "Pixel",
  platform: "android" as const,
  publicKey: "YW5kcm9pZC1wdWJsaWMta2V5"
};

function createManager(ttlMs = 120_000) {
  return new PairingSessionManager({
    ttlMs,
    createSessionId: () => "pairing_session_001",
    createPairingToken: () => "pairing_token_001"
  });
}

describe("pairing session manager", () => {
  it("creates a short-lived relay pairing session", () => {
    const manager = createManager();
    const { session, qrPayload } = manager.createSession(
      pcIdentity,
      "ws://127.0.0.1:8787/connect",
      1_000
    );

    expect(session.status).toBe("WAITING_FOR_ANDROID");
    expect(session.pairingSessionId).toBe("pairing_session_001");
    expect(qrPayload).toMatchObject({
      protocol: "crossbridge-v1",
      pairingSessionId: "pairing_session_001",
      pairingToken: "pairing_token_001",
      pcDeviceId: "pc_xxx",
      pcPublicKey: pcIdentity.publicKey,
      expiresAt: 121_000
    });
  });

  it("rejects a wrong token", () => {
    const manager = createManager();
    const { qrPayload } = manager.createSession(pcIdentity, "ws://relay.test/connect", 1_000);

    expect(() => manager.joinSession(
      qrPayload.pairingSessionId,
      "wrong_token",
      androidIdentity,
      2_000
    )).toThrow(PairingSessionError);
  });

  it("rejects an expired session", () => {
    const manager = createManager(1_000);
    const { qrPayload } = manager.createSession(pcIdentity, "ws://relay.test/connect", 1_000);

    expect(() => manager.joinSession(
      qrPayload.pairingSessionId,
      qrPayload.pairingToken,
      androidIdentity,
      2_001
    )).toThrow(/expired/i);
    expect(manager.get(qrPayload.pairingSessionId)?.status).toBe("EXPIRED");
  });

  it("confirms pairing after both devices accept and produces trusted metadata", () => {
    const manager = createManager();
    const { qrPayload } = manager.createSession(pcIdentity, "ws://relay.test/connect", 1_000);
    const joined = manager.joinSession(
      qrPayload.pairingSessionId,
      qrPayload.pairingToken,
      androidIdentity,
      2_000
    );

    expect(joined.verificationCode).toMatch(/^[0-9]{6}$/);
    expect(manager.confirmPairing(qrPayload.pairingSessionId, pcIdentity.deviceId, 3_000))
      .toEqual({ complete: false, session: joined.session });

    const complete = manager.confirmPairing(
      qrPayload.pairingSessionId,
      androidIdentity.deviceId,
      3_500
    );

    expect(complete.complete).toBe(true);
    if (complete.complete) {
      expect(complete.payload.trustedDevices).toEqual([
        { ...pcIdentity, pairedAt: 3_500 },
        { ...androidIdentity, pairedAt: 3_500 }
      ]);
    }
  });

  it("rejects duplicate completed sessions", () => {
    const manager = createManager();
    const { qrPayload } = manager.createSession(pcIdentity, "ws://relay.test/connect", 1_000);
    manager.joinSession(qrPayload.pairingSessionId, qrPayload.pairingToken, androidIdentity, 2_000);
    manager.confirmPairing(qrPayload.pairingSessionId, pcIdentity.deviceId, 3_000);
    manager.confirmPairing(qrPayload.pairingSessionId, androidIdentity.deviceId, 3_500);

    expect(() => manager.confirmPairing(
      qrPayload.pairingSessionId,
      pcIdentity.deviceId,
      4_000
    )).toThrow(/already completed/i);
  });

  it("cleans expired sessions", () => {
    const manager = createManager(1_000);
    const { qrPayload } = manager.createSession(pcIdentity, "ws://relay.test/connect", 1_000);

    manager.cleanup(2_001);

    expect(manager.get(qrPayload.pairingSessionId)).toBeUndefined();
    expect(manager.size()).toBe(0);
  });
});
