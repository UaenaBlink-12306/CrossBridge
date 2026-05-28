import {
  MessageType,
  type DeviceIdentity,
  type PairingCompletePayload,
  type PairingJoinedPayload,
  type PairingQrPayload,
  type PairingSessionCreatedPayload
} from "@crossbridge/protocol";
import { MockPairingClientBase } from "./mockPairingClientBase.js";

export class MockPcPairingClient extends MockPairingClientBase {
  constructor(identity: DeviceIdentity = {
    deviceId: "pc_xxx",
    deviceName: "Adam-PC",
    platform: "windows",
    publicKey: "cGMtcHVibGljLWtleQ=="
  }) {
    super(identity);
  }

  async createPairingSession(): Promise<PairingQrPayload> {
    this.send({
      type: MessageType.PAIRING_SESSION_CREATE,
      payload: {
        deviceIdentity: this.identity
      }
    });

    const message = await this.waitForType<{
      type: MessageType.PAIRING_SESSION_CREATED;
      payload: PairingSessionCreatedPayload;
    }>(MessageType.PAIRING_SESSION_CREATED);
    return message.payload.qrPayload;
  }

  async waitForJoined(): Promise<PairingJoinedPayload> {
    const message = await this.waitForType<{
      type: MessageType.PAIRING_JOINED;
      payload: PairingJoinedPayload;
    }>(MessageType.PAIRING_JOINED);
    return message.payload;
  }

  confirm(pairingSessionId: string): void {
    this.send({
      type: MessageType.PAIRING_CONFIRM,
      payload: {
        pairingSessionId,
        deviceId: this.identity.deviceId
      }
    });
  }

  async waitForComplete(): Promise<PairingCompletePayload> {
    const message = await this.waitForType<{
      type: MessageType.PAIRING_COMPLETE;
      payload: PairingCompletePayload;
    }>(MessageType.PAIRING_COMPLETE);
    this.saveTrustedPeer(message.payload);
    return message.payload;
  }
}
