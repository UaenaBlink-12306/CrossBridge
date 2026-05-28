import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAndroidEnvironment } from "./android-env.mjs";

const GRADLE_WRAPPER_VERSION = "8.13";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const androidRoot = dirname(scriptsDir);
const androidEnvironment = resolveAndroidEnvironment();
const tasks = process.argv.slice(2);

if (tasks.length === 0) {
  console.error("No Gradle task was provided.");
  console.error("Example: node scripts/run-gradle-task.mjs :app:testDebugUnitTest");
  process.exit(1);
}

function commandForPlatform(command) {
  if (process.platform !== "win32") return command;
  return command === "gradle" ? "gradle.bat" : command;
}

function run(command, args, options = {}) {
  const isBatch = process.platform === "win32" && /\.(bat|cmd)$/i.test(command);
  if (isBatch) {
    const commandLine = ["call", quoteCommandForCmd(command), ...args.map(quoteForCmd)].join(" ");
    return spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/c", commandLine], {
      cwd: androidRoot,
      env: androidEnvironment.env,
      windowsVerbatimArguments: true,
      ...options
    });
  }

  return spawnSync(command, args, {
    cwd: androidRoot,
    env: androidEnvironment.env,
    ...options
  });
}

function quoteForCmd(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quoteCommandForCmd(value) {
  const command = String(value);
  return /[\\/: ]/.test(command) ? quoteForCmd(command) : command;
}

function wrapperCommand() {
  const wrapperName = process.platform === "win32" ? "gradlew.bat" : "gradlew";
  const wrapperPath = join(androidRoot, wrapperName);
  const wrapperJar = join(androidRoot, "gradle", "wrapper", "gradle-wrapper.jar");
  const wrapperProperties = join(androidRoot, "gradle", "wrapper", "gradle-wrapper.properties");

  if (existsSync(wrapperPath) && existsSync(wrapperJar) && existsSync(wrapperProperties)) {
    return { command: wrapperPath, label: `Gradle wrapper (${wrapperName})` };
  }

  return undefined;
}

function installedGradleCommand() {
  const command = androidEnvironment.systemGradle?.command ?? commandForPlatform("gradle");
  const result = run(command, ["--version"], { encoding: "utf8", stdio: "ignore" });
  return result.status === 0 ? { command, label: "system Gradle" } : undefined;
}

const gradle = wrapperCommand() ?? installedGradleCommand();

if (!gradle) {
  console.error("Android Gradle task runner could not find usable Gradle.");
  console.error("");
  console.error("Gradle wrapper: missing or incomplete");
  console.error("System Gradle: missing");
  console.error("");
  console.error("Action:");
  console.error("  1. Install JDK 17+ and Android Studio / Android SDK.");
  console.error("  2. Install Gradle once.");
  console.error("  3. Generate and commit a real wrapper:");
  console.error("     cd apps/android");
  console.error(`     gradle wrapper --gradle-version ${GRADLE_WRAPPER_VERSION}`);
  console.error("");
  console.error("Then rerun one of:");
  console.error("  npm --prefix apps/android run test");
  console.error("  npm --prefix apps/android run build");
  process.exit(1);
}

console.log(`Gradle runner: using ${gradle.label}`);

const result = run(gradle.command, tasks, {
  stdio: "inherit"
});

process.exit(result.status ?? 1);
