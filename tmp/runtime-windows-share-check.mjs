const { chromium } = require("playwright");

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const appUrl = "http://127.0.0.1:5173";

const pcIdentity = {
  deviceId: "pc_runtime_001",
  deviceName: "Runtime Windows",
  platform: "windows",
  publicKey: "pc_runtime_public_key"
};

const androidDevice = {
  deviceId: "android_runtime_001",
  deviceName: "Runtime Pixel",
  platform: "android",
  publicKey: "android_runtime_public_key",
  pairedAt: 1779326000000
};

const mode = process.argv[2] ?? "windows-to-android";
const text = process.argv[3] ?? "CrossBridge runtime text from Windows";

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true
});
const page = await browser.newPage();

await page.goto(appUrl, { waitUntil: "domcontentloaded" });
await page.evaluate(({ pcIdentity, androidDevice }) => {
  localStorage.setItem("crossbridge.windowsIdentity.v2", JSON.stringify(pcIdentity));
  localStorage.setItem("crossbridge.trustedDevices.v1", JSON.stringify([androidDevice]));
  localStorage.setItem("crossbridge.relayUrl.v1", "ws://127.0.0.1:8787/connect");
}, { pcIdentity, androidDevice });
await page.reload({ waitUntil: "domcontentloaded" });
await page.getByText("Trusted device online").first().waitFor({ timeout: 20_000 });

if (mode === "windows-to-android") {
  await page.getByRole("button", { name: "Share" }).click();
  await page.getByLabel("Text or URL").fill(text);
  await page.getByRole("button", { name: "Send to Android" }).click();
  await page.getByText("Received.").first().waitFor({ timeout: 20_000 });
  console.log(JSON.stringify({ ok: true, mode, text }));
} else if (mode === "wait-for-android") {
  await page.getByRole("button", { name: "Share" }).click();
  await page.getByText(text).first().waitFor({ timeout: 30_000 });
  console.log(JSON.stringify({ ok: true, mode, text }));
} else if (mode === "offline-send") {
  await page.getByRole("button", { name: "Share" }).click();
  await page.getByLabel("Text or URL").fill(text);
  await page.getByText("Relay is disconnected.").first().waitFor({ timeout: 20_000 });
  console.log(JSON.stringify({ ok: true, mode }));
} else {
  throw new Error(`Unknown mode: ${mode}`);
}

await browser.close();
