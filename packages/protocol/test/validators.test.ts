import { describe, expect, it } from "vitest";
import {
  DeviceIdentitySchema,
  ErrorCode,
  MessageType,
  PairingCompletePayloadSchema,
  PairingConfirmPayloadSchema,
  PairingControlMessageSchema,
  PairingExpiredPayloadSchema,
  PairingJoinPayloadSchema,
  PairingJoinedPayloadSchema,
  PairingQrPayloadSchema,
  PairingSessionCreatePayloadSchema,
  PairingSessionCreatedPayloadSchema,
  TrustedDeviceControlMessageSchema,
  TrustedDeviceHelloPayloadSchema,
  TrustedDeviceOfflinePayloadSchema,
  TrustedDeviceOnlinePayloadSchema,
  TrustedDeviceStatusPayloadSchema,
  TrustedDeviceSchema,
  FileTransferControlMessageSchema,
  assessFileRisk,
  derivePairingCode,
  detectContentType,
  isValidHttpUrl,
  isRiskyFileName,
  parseEncryptedEnvelope,
  parseMessage,
  userMessageForError
} from "../src/index.ts";

const now = 1_779_100_000_000;

describe("protocol validators", () => {
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
  const qrPayload = {
    protocol: "crossbridge-v1" as const,
    pairingSessionId: "pairing_abc123",
    relayUrl: "ws://127.0.0.1:8787/connect",
    pcDeviceId: pcIdentity.deviceId,
    pcDeviceName: pcIdentity.deviceName,
    pcPublicKey: pcIdentity.publicKey,
    pairingToken: "pair_token_abc123",
    expiresAt: now + 120_000
  };

  it("accepts a valid text share message", () => {
    const message = parseMessage({
      version: 1,
      id: "msg_text_001",
      type: MessageType.TEXT_SHARE,
      timestamp: now,
      payload: {
        shareId: "share_text_001",
        fromDeviceId: "pc_xxx",
        toDeviceId: "android_xxx",
        text: "https://example.com",
        contentType: "url",
        createdAt: now
      }
    });

    expect(message.type).toBe(MessageType.TEXT_SHARE);
  });

  it("validates text share payload content rules", () => {
    const basePayload = {
      shareId: "share_text_001",
      fromDeviceId: "pc_xxx",
      toDeviceId: "android_xxx",
      contentType: "text" as const,
      text: "Bridge this note",
      createdAt: now
    };

    expect(parseMessage({
      version: 1,
      id: "msg_text_001",
      type: MessageType.TEXT_SHARE,
      timestamp: now,
      payload: basePayload
    }).payload).toEqual(basePayload);

    expect(() => parseMessage({
      version: 1,
      id: "msg_text_blank",
      type: MessageType.TEXT_SHARE,
      timestamp: now,
      payload: {
        ...basePayload,
        text: "   "
      }
    })).toThrow();

    expect(() => parseMessage({
      version: 1,
      id: "msg_text_too_long",
      type: MessageType.TEXT_SHARE,
      timestamp: now,
      payload: {
        ...basePayload,
        text: "a".repeat(20_001)
      }
    })).toThrow();

    expect(() => parseMessage({
      version: 1,
      id: "msg_url_invalid",
      type: MessageType.TEXT_SHARE,
      timestamp: now,
      payload: {
        ...basePayload,
        contentType: "url",
        text: "ftp://example.com"
      }
    })).toThrow();
  });

  it("detects only valid http and https URLs", () => {
    expect(isValidHttpUrl("https://example.com/path?q=1")).toBe(true);
    expect(isValidHttpUrl("HTTP://example.com")).toBe(true);
    expect(isValidHttpUrl("https://exa mple.com")).toBe(false);
    expect(isValidHttpUrl("ftp://example.com")).toBe(false);
    expect(detectContentType("https://example.com")).toBe("url");
    expect(detectContentType("www.example.com")).toBe("text");
  });

  it("rejects unsupported protocol versions", () => {
    expect(() => parseMessage({
      version: 2,
      id: "msg_text_001",
      type: MessageType.TEXT_SHARE,
      timestamp: now,
      payload: {
        text: "hello",
        contentType: "text",
        shareId: "share_text_001",
        fromDeviceId: "pc_xxx",
        toDeviceId: "android_xxx",
        createdAt: now
      }
    })).toThrow();
  });

  it("accepts relay-visible encrypted envelopes without plaintext fields", () => {
    const envelope = parseEncryptedEnvelope({
      version: 1,
      fromDeviceId: "android_xxx",
      toDeviceId: "pc_xxx",
      messageId: "msg_xxx",
      timestamp: now,
      nonce: Buffer.from("nonce").toString("base64"),
      ciphertext: Buffer.from("encrypted bytes").toString("base64")
    });

    expect(envelope.ciphertext).not.toContain("https://example.com");
  });

  it("flags risky received file names", () => {
    expect(isRiskyFileName("installer.exe")).toBe(true);
    expect(isRiskyFileName("notes.pdf")).toBe(false);
    expect(assessFileRisk("setup.ps1").risky).toBe(true);
    expect(assessFileRisk("photo.jpg").warning).toBeUndefined();
  });

  it("validates notification reply messages and results", () => {
    expect(parseMessage({
      version: 1,
      id: "msg_notification_reply",
      type: MessageType.NOTIFICATION_REPLY,
      timestamp: now,
      payload: {
        notificationId: "notification_1",
        actionId: "action_0",
        replyText: "On my way."
      }
    }).type).toBe(MessageType.NOTIFICATION_REPLY);

    expect(parseMessage({
      version: 1,
      id: "msg_notification_reply_result",
      type: MessageType.NOTIFICATION_REPLY_RESULT,
      timestamp: now,
      payload: {
        notificationId: "notification_1",
        actionId: "action_0",
        replied: false,
        errorCode: ErrorCode.NOTIFICATION_REPLY_UNSUPPORTED,
        message: "Android no longer exposes a reply action for this notification."
      }
    }).payload).toMatchObject({
      actionId: "action_0",
      replied: false
    });

    expect(() => parseMessage({
      version: 1,
      id: "msg_notification_reply_blank",
      type: MessageType.NOTIFICATION_REPLY,
      timestamp: now,
      payload: {
        notificationId: "notification_1",
        actionId: "action_0",
        replyText: "   "
      }
    })).toThrow();
  });

  it("validates encrypted file-transfer control payloads", () => {
    const offerPayload = {
      transferId: "transfer_abc",
      fromDeviceId: "pc_xxx",
      toDeviceId: "android_xxx",
      fileName: "notes.txt",
      fileSize: 12,
      mimeType: "text/plain",
      sha256: "a".repeat(64),
      direction: "WINDOWS_TO_ANDROID" as const,
      createdAt: now
    };

    expect(FileTransferControlMessageSchema.parse({
      type: MessageType.FILE_OFFER,
      payload: offerPayload
    }).payload).toEqual(offerPayload);

    expect(FileTransferControlMessageSchema.parse({
      type: MessageType.FILE_CHUNK,
      payload: {
        transferId: "transfer_abc",
        fromDeviceId: "pc_xxx",
        toDeviceId: "android_xxx",
        chunkIndex: 0,
        totalChunks: 1,
        byteLength: 12,
        chunkHash: "b".repeat(64),
        data: Buffer.from("hello world!").toString("base64")
      }
    }).type).toBe(MessageType.FILE_CHUNK);

    expect(() => FileTransferControlMessageSchema.parse({
      type: MessageType.FILE_COMPLETE,
      payload: {
        transferId: "transfer_abc",
        fromDeviceId: "pc_xxx",
        toDeviceId: "android_xxx",
        sha256: "not-a-sha",
        completedAt: now
      }
    })).toThrow();
  });

  it("keeps VPN messaging clear and relay-positive", () => {
    const messages = Object.values(ErrorCode).map(userMessageForError).join(" ");
    const disallowedSettingsChange = new RegExp(["disable", "vpn"].join("\\s+"), "i");
    const disallowedPowerOff = new RegExp(["turn off", "vpn"].join("\\s+"), "i");

    expect(userMessageForError(ErrorCode.LOCAL_NETWORK_BLOCKED)).toContain("Relay mode");
    expect(messages).not.toMatch(disallowedSettingsChange);
    expect(messages).not.toMatch(disallowedPowerOff);
  });

  it("validates pairing QR payloads", () => {
    expect(PairingQrPayloadSchema.parse(qrPayload)).toEqual(qrPayload);
    expect(() => PairingQrPayloadSchema.parse({
      ...qrPayload,
      relayUrl: "https://relay.example/connect"
    })).toThrow();
  });

  it("validates device identity and trusted device metadata", () => {
    expect(DeviceIdentitySchema.parse(pcIdentity)).toEqual(pcIdentity);
    expect(DeviceIdentitySchema.parse(androidIdentity)).toEqual(androidIdentity);

    const trustedDevice = {
      ...androidIdentity,
      pairedAt: now,
      lastSeenAt: now + 1_000
    };
    expect(TrustedDeviceSchema.parse(trustedDevice)).toEqual(trustedDevice);
  });

  it("validates pairing session create and created payloads", () => {
    expect(PairingSessionCreatePayloadSchema.parse({
      deviceIdentity: pcIdentity
    })).toEqual({ deviceIdentity: pcIdentity });
    expect(PairingSessionCreatedPayloadSchema.parse({
      qrPayload
    })).toEqual({ qrPayload });
    expect(() => PairingSessionCreatePayloadSchema.parse({
      deviceIdentity: androidIdentity
    })).toThrow();
  });

  it("validates pairing join, joined, confirm, complete, and expired payloads", () => {
    const verificationCode = derivePairingCode(
      pcIdentity.publicKey,
      androidIdentity.publicKey,
      qrPayload.pairingSessionId
    );

    expect(PairingJoinPayloadSchema.parse({
      pairingSessionId: qrPayload.pairingSessionId,
      pairingToken: qrPayload.pairingToken,
      deviceIdentity: androidIdentity
    })).toEqual({
      pairingSessionId: qrPayload.pairingSessionId,
      pairingToken: qrPayload.pairingToken,
      deviceIdentity: androidIdentity
    });
    expect(PairingJoinedPayloadSchema.parse({
      pairingSessionId: qrPayload.pairingSessionId,
      pcIdentity,
      androidIdentity,
      verificationCode
    }).verificationCode).toMatch(/^[0-9]{6}$/);
    expect(PairingConfirmPayloadSchema.parse({
      pairingSessionId: qrPayload.pairingSessionId,
      deviceId: pcIdentity.deviceId
    })).toEqual({
      pairingSessionId: qrPayload.pairingSessionId,
      deviceId: pcIdentity.deviceId
    });
    expect(PairingCompletePayloadSchema.parse({
      pairingSessionId: qrPayload.pairingSessionId,
      trustedDevices: [
        { ...pcIdentity, pairedAt: now },
        { ...androidIdentity, pairedAt: now }
      ]
    }).trustedDevices).toHaveLength(2);
    expect(PairingExpiredPayloadSchema.parse({
      pairingSessionId: qrPayload.pairingSessionId,
      expiresAt: qrPayload.expiresAt
    })).toEqual({
      pairingSessionId: qrPayload.pairingSessionId,
      expiresAt: qrPayload.expiresAt
    });
  });

  it("validates bare pairing control messages for relay websocket handling", () => {
    expect(PairingControlMessageSchema.parse({
      type: MessageType.PAIRING_SESSION_CREATE,
      payload: {
        deviceIdentity: pcIdentity
      }
    }).type).toBe(MessageType.PAIRING_SESSION_CREATE);
  });

  it("validates trusted-device presence control messages", () => {
    expect(TrustedDeviceHelloPayloadSchema.parse({
      deviceIdentity: pcIdentity,
      trustedPeerIds: [androidIdentity.deviceId]
    })).toEqual({
      deviceIdentity: pcIdentity,
      trustedPeerIds: [androidIdentity.deviceId]
    });

    expect(TrustedDeviceOnlinePayloadSchema.parse({
      deviceIdentity: androidIdentity,
      connectionMode: "relay",
      timestamp: now
    })).toEqual({
      deviceIdentity: androidIdentity,
      connectionMode: "relay",
      timestamp: now
    });

    expect(TrustedDeviceOfflinePayloadSchema.parse({
      deviceId: androidIdentity.deviceId,
      timestamp: now
    })).toEqual({
      deviceId: androidIdentity.deviceId,
      timestamp: now
    });

    expect(TrustedDeviceStatusPayloadSchema.parse({
      deviceId: androidIdentity.deviceId,
      trusted: true,
      online: false,
      lastSeenAt: now
    })).toEqual({
      deviceId: androidIdentity.deviceId,
      trusted: true,
      online: false,
      lastSeenAt: now
    });

    expect(TrustedDeviceControlMessageSchema.parse({
      type: MessageType.TRUSTED_DEVICE_HELLO,
      payload: {
        deviceIdentity: pcIdentity,
        trustedPeerIds: [androidIdentity.deviceId]
      }
    }).type).toBe(MessageType.TRUSTED_DEVICE_HELLO);

    expect(() => TrustedDeviceOnlinePayloadSchema.parse({
      deviceIdentity: androidIdentity,
      connectionMode: "lan",
      timestamp: now
    })).toThrow();
  });

  it("derives a deterministic 6-digit pairing verification code", () => {
    const first = derivePairingCode(
      pcIdentity.publicKey,
      androidIdentity.publicKey,
      qrPayload.pairingSessionId
    );
    const second = derivePairingCode(
      pcIdentity.publicKey,
      androidIdentity.publicKey,
      qrPayload.pairingSessionId
    );
    const differentAndroid = derivePairingCode(
      pcIdentity.publicKey,
      "YW5vdGhlci1hbmRyb2lkLWtleQ==",
      qrPayload.pairingSessionId
    );

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9]{6}$/);
    expect(differentAndroid).not.toBe(first);
    expect(derivePairingCode(
      "pc_test_public_key",
      "android_test_public_key",
      "pairing_test_session"
    )).toBe("926486");
  });
});
