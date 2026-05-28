import { generateDevelopmentKeyPair } from "@crossbridge/crypto";
import { writeFileSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const adb = '"C:\\Users\\alpac\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe"';

async function main() {
  console.log("Generating mock Windows client key pair...");
  const keys = await generateDevelopmentKeyPair();
  writeFileSync("scratch/windows_keys.json", JSON.stringify(keys, null, 2));
  console.log("✓ Saved Windows keys to scratch/windows_keys.json");
  console.log(`- Public Key: ${keys.publicKey}`);

  console.log("\nReading Android device identity from emulator...");
  const identityXml = execSync(`${adb} shell run-as dev.crossbridge.android cat shared_prefs/crossbridge_android_identity.xml`).toString();
  
  const deviceIdMatch = identityXml.match(/<string name="deviceId">(.*?)<\/string>/);
  const publicKeyMatch = identityXml.match(/<string name="publicKey">(.*?)<\/string>/);
  
  if (!deviceIdMatch || !publicKeyMatch) {
    throw new Error("Could not find Android deviceId or publicKey in SharedPreferences!");
  }
  
  const androidDeviceId = deviceIdMatch[1];
  const androidPublicKey = publicKeyMatch[1];
  
  console.log("✓ Retrieved Android Identity:");
  console.log(`- Device ID: ${androidDeviceId}`);
  console.log(`- Public Key: ${androidPublicKey}`);
  
  // Write the persistent config
  const config = {
    androidDeviceId,
    androidPublicKey
  };
  writeFileSync("scratch/android_identity.json", JSON.stringify(config, null, 2));

  console.log("\nGenerating crossbridge_trusted_devices.xml...");
  const pairedAt = Date.now();
  // Escape quotes for XML
  const windowsPublicKeyEscaped = keys.publicKey.replaceAll('"', '&quot;');
  
  const xmlContent = `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <string name="trustedDevices">[{&quot;deviceId&quot;:&quot;windows_dev_test_id&quot;,&quot;deviceName&quot;:&quot;Dev Windows PC&quot;,&quot;platform&quot;:&quot;windows&quot;,&quot;publicKey&quot;:&quot;${windowsPublicKeyEscaped}&quot;,&quot;pairedAt&quot;:${pairedAt}}]</string>
</map>
`;

  writeFileSync("scratch/crossbridge_trusted_devices.xml", xmlContent);
  console.log("✓ Wrote scratch/crossbridge_trusted_devices.xml");

  console.log("\nPushing to emulator...");
  execSync(`${adb} push scratch/crossbridge_trusted_devices.xml /data/local/tmp/crossbridge_trusted_devices.xml`);
  execSync(`${adb} shell run-as dev.crossbridge.android cp /data/local/tmp/crossbridge_trusted_devices.xml shared_prefs/crossbridge_trusted_devices.xml`);
  execSync(`${adb} shell run-as dev.crossbridge.android chmod 660 shared_prefs/crossbridge_trusted_devices.xml`);
  console.log("✓ Pushed to emulator private storage!");

  console.log("\nRestarting CrossBridge app...");
  execSync(`${adb} shell am force-stop dev.crossbridge.android`);
  execSync(`${adb} shell am start -n dev.crossbridge.android/.MainActivity`);
  console.log("✓ Restarted app successfully!");
}

main().catch(console.error);
