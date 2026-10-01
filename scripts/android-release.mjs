import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAndroidEnvironment } from "../apps/android/scripts/android-env.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const signingDir = join(homedir(), ".codex", "signing", "crossbridge");
const configPath = join(signingDir, "signing.json");
const keystorePath = join(signingDir, "release.jks");
const { env } = resolveAndroidEnvironment();
mkdirSync(signingDir, { recursive: true });
let config;
if (existsSync(configPath)) config = JSON.parse(readFileSync(configPath, "utf8"));
else {
  if (existsSync(keystorePath)) throw new Error("A signing key already exists without its configuration. Restore signing.json; do not replace the key.");
  config = { password: randomBytes(32).toString("hex"), alias: "crossbridge" };
  const keytool = env.JAVA_HOME ? join(env.JAVA_HOME, "bin", process.platform === "win32" ? "keytool.exe" : "keytool") : "keytool";
  const result = spawnSync(keytool, ["-genkeypair", "-keystore", keystorePath, "-storetype", "JKS", "-alias", config.alias,
    "-keyalg", "RSA", "-keysize", "3072", "-validity", "10000", "-dname", "CN=CrossBridge, OU=App Release, O=CrossBridge",
    "-storepass:env", "CROSSBRIDGE_SIGN_PASSWORD", "-keypass:env", "CROSSBRIDGE_SIGN_PASSWORD", "-noprompt"],
    { env: { ...env, CROSSBRIDGE_SIGN_PASSWORD: config.password }, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Could not create Android signing key: ${result.stderr}`);
  writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  console.log("Created a persistent Android release key outside the repository. Retain the key and signing.json for updates.");
}
if (!existsSync(keystorePath)) throw new Error("The retained Android signing key is missing. Restore it before building.");
if (process.argv.includes("--prepare-only")) process.exit(0);
const result = spawnSync(process.execPath, [join(repo, "apps/android/scripts/run-gradle-task.mjs"), ":app:testDebugUnitTest", ":app:assembleRelease"], {
  cwd: repo, stdio: "inherit", env: { ...env, ANDROID_KEYSTORE_FILE: keystorePath,
    ANDROID_KEYSTORE_PASSWORD: config.password, ANDROID_KEY_ALIAS: config.alias, ANDROID_KEY_PASSWORD: config.password }
});
if (result.status !== 0) process.exit(result.status ?? 1);
const downloads = resolve(repo, "downloads");
mkdirSync(downloads, { recursive: true });
copyFileSync(join(repo, "apps/android/app/build/outputs/apk/release/app-release.apk"), join(downloads, "CrossBridge-Android-0.2.0.apk"));
console.log("Installable signed APK: downloads/CrossBridge-Android-0.2.0.apk");
