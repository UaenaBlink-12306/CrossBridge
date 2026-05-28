import { describe, expect, it } from "vitest";
import { generateDevelopmentKeyPair } from "@crossbridge/crypto";
import { MessageType } from "@crossbridge/protocol";
import {
  createFileAcceptEnvelope,
  createFileCancelEnvelope,
  createFileChunkEnvelope,
  createFileCompleteEnvelope,
  createFileOfferEnvelope,
  createFileProgressEnvelope,
  createFileRejectEnvelope,
  decodeFileTransferEnvelope,
  inferRiskyFileWarning,
  reassembleTransferredFile,
  splitIntoFileChunks
} from "./fileTransferClient.js";

describe("file transfer client helpers", () => {
  it("creates, chunks, and decodes encrypted file offers", async () => {
    const pc = await generateDevelopmentKeyPair();
    const android = await generateDevelopmentKeyPair();
    const bytes = new TextEncoder().encode("CrossBridge file transfer payload");
    const created = await createFileOfferEnvelope({
      fromDeviceId: "pc_1",
      toDeviceId: "android_1",
      fileName: "notes.txt",
      mimeType: "text/plain",
      bytes,
      direction: "WINDOWS_TO_ANDROID",
      chunkSize: 8,
      localPrivateKey: pc.privateKey,
      localPublicKey: pc.publicKey,
      peerPublicKey: android.publicKey,
      now: 2_000
    });

    expect(created.payload.fileSize).toBe(bytes.length);
    expect(created.payload.direction).toBe("WINDOWS_TO_ANDROID");
    expect(created.chunks.length).toBeGreaterThan(1);
    expect(created.envelope.ciphertext).not.toContain("CrossBridge");

    const decoded = await decodeFileTransferEnvelope({
      envelope: created.envelope,
      localDeviceId: "android_1",
      localPrivateKey: android.privateKey,
      localPublicKey: android.publicKey,
      peerPublicKey: pc.publicKey
    });

    expect(decoded?.controlMessage).toEqual({
      type: MessageType.FILE_OFFER,
      payload: created.payload
    });
    expect(reassembleTransferredFile(created.chunks.map((chunk) => chunk.payload), created.payload.sha256))
      .toEqual(bytes);
  });

  it("creates and decodes progress, completion, cancellation, rejection, and acceptance envelopes", async () => {
    const pc = await generateDevelopmentKeyPair();
    const android = await generateDevelopmentKeyPair();
    const baseInput = {
      fromDeviceId: "android_1",
      toDeviceId: "pc_1",
      transferId: "transfer_1",
      localPrivateKey: android.privateKey,
      localPublicKey: android.publicKey,
      peerPublicKey: pc.publicKey,
      now: 3_000
    };

    await expectDecoded(await createFileProgressEnvelope({
      ...baseInput,
      bytesTransferred: 128,
      totalBytes: 512
    }), MessageType.FILE_PROGRESS, pc, android);
    await expectDecoded(await createFileCompleteEnvelope({
      ...baseInput,
      sha256: "a".repeat(64)
    }), MessageType.FILE_COMPLETE, pc, android);
    await expectDecoded(await createFileCancelEnvelope(baseInput), MessageType.FILE_CANCEL, pc, android);
    await expectDecoded(await createFileRejectEnvelope({
      ...baseInput,
      reason: "Recipient declined the file."
    }), MessageType.FILE_REJECT, pc, android);
    await expectDecoded(await createFileAcceptEnvelope(baseInput), MessageType.FILE_ACCEPT, pc, android);
  });

  it("verifies chunk hashes during reassembly", () => {
    const bytes = new TextEncoder().encode("hello world");
    const [chunk] = splitIntoFileChunks("transfer_1", bytes, 64);
    const tampered = {
      ...chunk.payload,
      data: btoa("jello world")
    };

    expect(() => reassembleTransferredFile([tampered])).toThrow(/Chunk 0 SHA-256 did not match/);
  });

  it("flags risky file warnings", () => {
    expect(inferRiskyFileWarning("installer.exe")).toContain("Potentially risky");
    expect(inferRiskyFileWarning("photo.jpg")).toBeUndefined();
  });

  it("creates encrypted chunk envelopes", async () => {
    const pc = await generateDevelopmentKeyPair();
    const android = await generateDevelopmentKeyPair();
    const bytes = new TextEncoder().encode("chunk me");
    const [chunk] = splitIntoFileChunks("transfer_2", bytes, 4);
    const envelope = await createFileChunkEnvelope({
      fromDeviceId: "pc_1",
      toDeviceId: "android_1",
      payload: chunk.payload,
      localPrivateKey: pc.privateKey,
      localPublicKey: pc.publicKey,
      peerPublicKey: android.publicKey,
      now: 4_000
    });

    const decoded = await decodeFileTransferEnvelope({
      envelope,
      localDeviceId: "android_1",
      localPrivateKey: android.privateKey,
      localPublicKey: android.publicKey,
      peerPublicKey: pc.publicKey
    });
    expect(decoded?.controlMessage.type).toBe(MessageType.FILE_CHUNK);
  });
});

async function expectDecoded(
  envelope: unknown,
  type: MessageType,
  recipientKeys: Awaited<ReturnType<typeof generateDevelopmentKeyPair>>,
  senderKeys: Awaited<ReturnType<typeof generateDevelopmentKeyPair>>
) {
  const decoded = await decodeFileTransferEnvelope({
    envelope,
    localDeviceId: "pc_1",
    localPrivateKey: recipientKeys.privateKey,
    localPublicKey: recipientKeys.publicKey,
    peerPublicKey: senderKeys.publicKey
  });
  expect(decoded?.controlMessage.type).toBe(type);
}
