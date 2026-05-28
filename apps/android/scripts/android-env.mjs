import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

export function resolveAndroidEnvironment(baseEnv = process.env) {
  const env = { ...baseEnv };
  const javaHome = findJavaHome(env);

  if (javaHome) {
    env.JAVA_HOME = javaHome.path;
    env.Path = prependPath(join(javaHome.path, "bin"), env.Path ?? env.PATH);
    env.PATH = env.Path;
  }

  const androidSdk = findAndroidSdk(env);
  if (androidSdk) {
    env.ANDROID_HOME = androidSdk.path;
    env.ANDROID_SDK_ROOT = androidSdk.path;
  }

  const systemGradle = findSystemGradle(env);
  if (systemGradle?.binDir) {
    env.Path = prependPath(systemGradle.binDir, env.Path ?? env.PATH);
    env.PATH = env.Path;
  }

  return {
    env,
    javaHome,
    androidSdk,
    systemGradle
  };
}

export function findSystemGradle(env = process.env) {
  const command = process.platform === "win32" ? "gradle.bat" : "gradle";
  if (commandSucceeds(command, ["--version"], env)) {
    return { command, source: "PATH" };
  }

  for (const candidate of systemGradleCandidates()) {
    if (existsSync(candidate.command) && commandSucceeds(candidate.command, ["--version"], env)) {
      return candidate;
    }
  }

  return undefined;
}

function findJavaHome(env) {
  if (isUsableJavaHome(env.JAVA_HOME)) {
    return { path: env.JAVA_HOME, source: "JAVA_HOME" };
  }

  if (commandSucceeds("java", ["-version"], env)) {
    return undefined;
  }

  for (const candidate of javaHomeCandidates(env)) {
    if (isUsableJavaHome(candidate.path)) {
      return candidate;
    }
  }

  return undefined;
}

function findAndroidSdk(env) {
  for (const [name, value] of [
    ["ANDROID_HOME", env.ANDROID_HOME],
    ["ANDROID_SDK_ROOT", env.ANDROID_SDK_ROOT]
  ]) {
    if (value && existsSync(value)) {
      return { path: value, source: name };
    }
  }

  for (const candidate of androidSdkCandidates(env)) {
    if (existsSync(candidate.path)) {
      return candidate;
    }
  }

  return undefined;
}

function javaHomeCandidates(env) {
  const candidates = [];

  if (process.platform === "win32") {
    candidates.push({
      path: "C:\\Program Files\\Android\\Android Studio\\jbr",
      source: "Android Studio bundled JBR"
    });
  }

  if (process.platform === "darwin") {
    candidates.push({
      path: "/Applications/Android Studio.app/Contents/jbr/Contents/Home",
      source: "Android Studio bundled JBR"
    });
  }

  const home = env.HOME ?? homedir();
  if (home) {
    candidates.push({
      path: join(home, "Library", "Java", "JavaVirtualMachines"),
      source: "user Java installations"
    });
  }

  return candidates;
}

function androidSdkCandidates(env) {
  const candidates = [];

  if (process.platform === "win32") {
    const localAppData = env.LOCALAPPDATA ?? join(env.USERPROFILE ?? homedir(), "AppData", "Local");
    candidates.push({
      path: join(localAppData, "Android", "Sdk"),
      source: "default Android SDK location"
    });
  } else if (process.platform === "darwin") {
    candidates.push({
      path: join(env.HOME ?? homedir(), "Library", "Android", "sdk"),
      source: "default Android SDK location"
    });
  } else {
    candidates.push({
      path: join(env.HOME ?? homedir(), "Android", "Sdk"),
      source: "default Android SDK location"
    });
  }

  return candidates;
}

function systemGradleCandidates() {
  if (process.platform !== "win32") return [];

  return [
    {
      command: "C:\\Gradle\\gradle-8.13\\bin\\gradle.bat",
      binDir: "C:\\Gradle\\gradle-8.13\\bin",
      source: "C:\\Gradle\\gradle-8.13"
    }
  ];
}

function isUsableJavaHome(javaHome) {
  if (!javaHome) return false;
  const javaExecutable = process.platform === "win32" ? "java.exe" : "java";
  return existsSync(join(javaHome, "bin", javaExecutable));
}

function commandSucceeds(command, args, env) {
  const isBatch = process.platform === "win32" && /\.(bat|cmd)$/i.test(command);
  if (isBatch) {
    const commandLine = ["call", quoteCommandForCmd(command), ...args.map(quoteForCmd)].join(" ");
    const result = spawnSync(env.ComSpec ?? process.env.ComSpec ?? "cmd.exe", ["/d", "/c", commandLine], {
      encoding: "utf8",
      env,
      stdio: "ignore",
      windowsVerbatimArguments: true
    });

    return result.status === 0;
  }

  const result = spawnSync(command, args, {
    encoding: "utf8",
    env,
    stdio: "ignore"
  });

  return result.status === 0;
}

function quoteForCmd(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quoteCommandForCmd(value) {
  const command = String(value);
  return /[\\/: ]/.test(command) ? quoteForCmd(command) : command;
}

function prependPath(path, currentPath = "") {
  const parts = currentPath.split(delimiter).filter(Boolean);
  const alreadyPresent = parts.some((part) => part.toLowerCase() === path.toLowerCase());
  return alreadyPresent ? currentPath : [path, ...parts].join(delimiter);
}
