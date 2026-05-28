import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAndroidEnvironment } from "./android-env.mjs";

const REQUIRED_JDK_MAJOR = 17;
const REQUIRED_SDK_PLATFORM = "android-36";
const REQUIRED_BUILD_TOOLS = "35.0.0";
const GRADLE_WRAPPER_VERSION = "8.13";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const androidRoot = dirname(scriptsDir);
const androidEnvironment = resolveAndroidEnvironment();

const criticalFailures = [];
const warnings = [];

function commandForPlatform(command) {
  if (process.platform !== "win32") return command;
  return command === "gradle" ? "gradle.bat" : command;
}

function run(command, args) {
  const isBatch = process.platform === "win32" && /\.(bat|cmd)$/i.test(command);
  if (isBatch) {
    const commandLine = ["call", quoteCommandForCmd(command), ...args.map(quoteForCmd)].join(" ");
    return spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/c", commandLine], {
      encoding: "utf8",
      env: androidEnvironment.env,
      windowsVerbatimArguments: true
    });
  }

  return spawnSync(command, args, {
    encoding: "utf8",
    env: androidEnvironment.env
  });
}

function quoteForCmd(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quoteCommandForCmd(value) {
  const command = String(value);
  return /[\\/: ]/.test(command) ? quoteForCmd(command) : command;
}

function projectPath(...parts) {
  return join(androidRoot, ...parts);
}

function displayPath(path) {
  const value = relative(androidRoot, path).replaceAll("\\", "/");
  return value.length > 0 ? value : ".";
}

function markCritical(message) {
  criticalFailures.push(message);
}

function markWarning(message) {
  warnings.push(message);
}

function parseJavaMajor(versionOutput) {
  const versionMatch = versionOutput.match(/version\s+"([^"]+)"/i);
  if (!versionMatch) return undefined;

  const [first, second] = versionMatch[1].split(".");
  if (first === "1" && second) return Number.parseInt(second, 10);
  return Number.parseInt(first, 10);
}

function parseGradleVersion(versionOutput) {
  const match = versionOutput.match(/Gradle\s+([0-9]+(?:\.[0-9]+)*)/i);
  return match?.[1];
}

function checkProjectFile(label, path) {
  if (existsSync(path)) {
    console.log(`${label}: ok (${displayPath(path)})`);
    return true;
  }

  console.log(`${label}: missing (${displayPath(path)})`);
  console.log("Action: restore the Android Gradle project file before running Android verification.");
  markCritical(`${label} is missing`);
  return false;
}

function wrapperStatus() {
  const files = {
    "Unix wrapper script": projectPath("gradlew"),
    "Windows wrapper script": projectPath("gradlew.bat"),
    "Wrapper JAR": projectPath("gradle", "wrapper", "gradle-wrapper.jar"),
    "Wrapper properties": projectPath("gradle", "wrapper", "gradle-wrapper.properties")
  };

  const missing = Object.entries(files)
    .filter(([, path]) => !existsSync(path))
    .map(([label]) => label);

  if (missing.length === 0) {
    console.log("Gradle wrapper: ok (complete generated wrapper)");
    return { complete: true, usableOnThisPlatform: true };
  }

  const platformScript = process.platform === "win32" ? files["Windows wrapper script"] : files["Unix wrapper script"];
  const usableOnThisPlatform =
    existsSync(platformScript) &&
    existsSync(files["Wrapper JAR"]) &&
    existsSync(files["Wrapper properties"]);

  console.log(`Gradle wrapper: missing or incomplete (${missing.join(", ")})`);
  console.log("Action: install Gradle once, then run:");
  console.log("  cd apps/android");
  console.log(`  gradle wrapper --gradle-version ${GRADLE_WRAPPER_VERSION}`);

  if (!usableOnThisPlatform) {
    markWarning("Gradle wrapper is not usable on this platform");
  }

  return { complete: false, usableOnThisPlatform };
}

console.log("Android build environment doctor");
console.log("");
console.log("Expected:");
console.log(`  JDK: ${REQUIRED_JDK_MAJOR}+`);
console.log(`  Android SDK platform: ${REQUIRED_SDK_PLATFORM}`);
console.log(`  Android SDK build tools: ${REQUIRED_BUILD_TOOLS}`);
console.log(`  Gradle wrapper target: ${GRADLE_WRAPPER_VERSION}`);
console.log("");

checkProjectFile("Android settings file", projectPath("settings.gradle.kts"));
checkProjectFile("Android root build file", projectPath("build.gradle.kts"));
checkProjectFile("Android Gradle properties", projectPath("gradle.properties"));
checkProjectFile("Android app build file", projectPath("app", "build.gradle.kts"));

console.log("");

const javaResult = run("java", ["-version"]);
if (javaResult.status === 0) {
  const javaOutput = `${javaResult.stderr ?? ""}${javaResult.stdout ?? ""}`;
  const javaMajor = parseJavaMajor(javaOutput);
  if (javaMajor && javaMajor >= REQUIRED_JDK_MAJOR) {
    console.log(`Java: ok (${javaMajor})`);
  } else {
    console.log(`Java: unsupported${javaMajor ? ` (${javaMajor})` : ""}`);
    console.log("Action: install JDK 17+ and ensure `java` is on PATH.");
    markCritical("Java is older than JDK 17");
  }
} else {
  console.log("Java: missing");
  console.log("Action: install JDK 17+ and ensure `java` is on PATH.");
  markCritical("Java is missing");
}

const wrapper = wrapperStatus();

const gradleCommand = androidEnvironment.systemGradle?.command ?? commandForPlatform("gradle");
const gradleResult = run(gradleCommand, ["--version"]);
const hasSystemGradle = gradleResult.status === 0;
if (hasSystemGradle) {
  const gradleVersion = parseGradleVersion(`${gradleResult.stdout ?? ""}${gradleResult.stderr ?? ""}`);
  const gradleSource =
    androidEnvironment.systemGradle?.source && androidEnvironment.systemGradle.source !== "PATH"
      ? `, ${androidEnvironment.systemGradle.source}`
      : "";
  console.log(`System Gradle: ok${gradleVersion ? ` (${gradleVersion})` : ""}${gradleSource}`);
} else {
  console.log("System Gradle: missing");
  if (wrapper.usableOnThisPlatform) {
    console.log("Action: no system Gradle is required because the wrapper is usable here.");
  } else {
    console.log("Action: install Gradle once, then generate the wrapper:");
    console.log("  cd apps/android");
    console.log(`  gradle wrapper --gradle-version ${GRADLE_WRAPPER_VERSION}`);
  }
}

if (!wrapper.usableOnThisPlatform && !hasSystemGradle) {
  markCritical("No usable Gradle wrapper or system Gradle was found");
}

const androidSdk = androidEnvironment.androidSdk?.path;
const androidSdkSource = androidEnvironment.androidSdk?.source;
if (!androidSdk) {
  console.log("Android SDK: missing");
  console.log("Action: install Android Studio or set ANDROID_HOME / ANDROID_SDK_ROOT.");
  markCritical("Android SDK environment variable is missing");
} else if (!existsSync(androidSdk)) {
  console.log(`Android SDK: missing path (${androidSdkSource ?? "auto-detected"}=${androidSdk})`);
  console.log("Action: set ANDROID_HOME / ANDROID_SDK_ROOT to the Android SDK directory.");
  markCritical("Android SDK path does not exist");
} else {
  const androidSdkLabel =
    androidSdkSource === "ANDROID_HOME" || androidSdkSource === "ANDROID_SDK_ROOT"
      ? `${androidSdkSource}=${androidSdk}`
      : `${androidSdkSource}: ${androidSdk}`;
  console.log(`Android SDK: ok (${androidSdkLabel})`);

  const platformPath = join(androidSdk, "platforms", REQUIRED_SDK_PLATFORM);
  if (existsSync(platformPath)) {
    console.log(`Android SDK platform ${REQUIRED_SDK_PLATFORM}: ok`);
  } else {
    console.log(`Android SDK platform ${REQUIRED_SDK_PLATFORM}: missing`);
    console.log(`Action: install it with sdkmanager "platforms;${REQUIRED_SDK_PLATFORM}".`);
    markCritical(`Android SDK platform ${REQUIRED_SDK_PLATFORM} is missing`);
  }

  const buildToolsPath = join(androidSdk, "build-tools", REQUIRED_BUILD_TOOLS);
  if (existsSync(buildToolsPath)) {
    console.log(`Android SDK build tools ${REQUIRED_BUILD_TOOLS}: ok`);
  } else {
    console.log(`Android SDK build tools ${REQUIRED_BUILD_TOOLS}: missing`);
    console.log(`Action: install them with sdkmanager "build-tools;${REQUIRED_BUILD_TOOLS}".`);
    markCritical(`Android SDK build tools ${REQUIRED_BUILD_TOOLS} are missing`);
  }
}

console.log("");

if (warnings.length > 0) {
  console.log("Warnings:");
  for (const warning of warnings) console.log(`- ${warning}`);
  console.log("");
}

if (criticalFailures.length > 0) {
  console.log("Android environment: not ready");
  console.log("Critical items:");
  for (const failure of criticalFailures) console.log(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Android environment: ready for JVM tests and debug build.");
}
