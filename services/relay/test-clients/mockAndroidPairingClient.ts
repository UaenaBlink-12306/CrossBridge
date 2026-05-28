import {
  MessageType,
  type DeviceIdentity,
  type PairingCompletePayload,
  type PairingJoinedPayload,
  type PairingQrPayload
} from "@crossbridge/protocol";
import { MockPairingClientBase } from "./mockPairingClientBase.js";

export class MockAndroidPairingClient extends MockPairingClientBase {
  constructor(identity: DeviceIdentity = {
    deviceId: "android_xxx",
    deviceName: "Pixel",
    platform: "android",
    publicKey: "YW5kcm9pZC1wdWJsaWMta2V5"
  }) {
    super(identity);
  }

  async joinPairingSession(qrPayload: PairingQrPayload): Promise<PairingJoinedPayload> {
    this.send({
      type: MessageType.PAIRING_JOIN,
      payload: {
        pairingSessionId: qrPayload.pairingSessionId,
        pairingToken: qrPayload.pairingToken,
        deviceIdentity: this.identity
      }
    });

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
