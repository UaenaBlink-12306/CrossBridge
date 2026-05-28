import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const windowsWorkspaceRoot = path.join(repoRoot, "apps", "windows");
const tauriBin = path.join(
  repoRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tauri.cmd" : "tauri"
);
const windowsTarget = "x86_64-pc-windows-msvc";
const preferredToolchain = "stable-x86_64-pc-windows-msvc";

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: windowsWorkspaceRoot,
    encoding: "utf8",
    ...options
  });
}

function fail(lines, exitCode = 1) {
  const messages = Array.isArray(lines) ? lines : [lines];
  for (const line of messages) {
    if (line) console.error(line);
  }
  process.exit(exitCode);
}

function findNewestChild(dirPath) {
  if (!fs.existsSync(dirPath)) return null;
  const names = fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
  return names.length > 0 ? path.join(dirPath, names[0]) : null;
}

function ensureRustupTarget() {
  const installedTargets = run("rustup", ["target", "list", "--toolchain", preferredToolchain, "--installed"]);
  if (installedTargets.status !== 0) {
    fail([
      "CrossBridge Windows packaging requires Rust's MSVC toolchain.",
      `Failed to inspect installed targets for ${preferredToolchain}.`,
      (installedTargets.stderr || installedTargets.stdout || "").trim(),
      `Install it with: rustup toolchain install stable-msvc && rustup target add --toolchain ${preferredToolchain} ${windowsTarget}`
    ]);
  }

  const targetNames = installedTargets.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!targetNames.includes(windowsTarget)) {
    fail([
      `CrossBridge Windows packaging uses ${windowsTarget}.`,
      `Rust target ${windowsTarget} is not installed for ${preferredToolchain}.`,
      `Install it with: rustup target add --toolchain ${preferredToolchain} ${windowsTarget}`
    ]);
  }
}

function resolveWindowsSdk() {
  const sdkRoot = path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Windows Kits", "10");
  const includeVersionDir = findNewestChild(path.join(sdkRoot, "Include"));
  const libVersionDir = findNewestChild(path.join(sdkRoot, "Lib"));
  const binVersionDir = findNewestChild(path.join(sdkRoot, "bin"));

  if (!includeVersionDir || !libVersionDir || !binVersionDir) {
    fail([
      "CrossBridge Windows packaging requires the Windows SDK from the Visual Studio C++ workload.",
      `Expected Windows SDK under ${sdkRoot}, but the include/lib/bin layout is incomplete.`,
      "Install or repair Visual Studio with the 'Desktop development with C++' workload."
    ]);
  }

  const rcPath = path.join(binVersionDir, "x64", "rc.exe");
  const ucrtLib = path.join(libVersionDir, "ucrt", "x64");
  const umLib = path.join(libVersionDir, "um", "x64");

  const missing = [rcPath, ucrtLib, umLib].filter((entry) => !fs.existsSync(entry));
  if (missing.length > 0) {
    fail([
      "CrossBridge Windows packaging requires a complete Windows SDK x64 toolchain.",
      ...missing.map((entry) => `Missing: ${entry}`),
      "Repair Visual Studio and ensure the Windows 10/11 SDK is installed."
    ]);
  }

  return {
    root: sdkRoot,
    version: `${path.basename(includeVersionDir)}\\`,
    includeDirs: [
      path.join(includeVersionDir, "ucrt"),
      path.join(includeVersionDir, "shared"),
      path.join(includeVersionDir, "um"),
      path.join(includeVersionDir, "winrt"),
      path.join(includeVersionDir, "cppwinrt")
    ].filter((entry) => fs.existsSync(entry)),
    libDirs: [ucrtLib, umLib],
    binDir: path.join(binVersionDir, "x64")
  };
}

function resolveVisualStudioMsvc() {
  const vswhere = path.join(
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
    "Microsoft Visual Studio",
    "Installer",
    "vswhere.exe"
  );

  if (!fs.existsSync(vswhere)) {
    fail([
      "CrossBridge Windows packaging requires Visual Studio C++ Build Tools.",
      `Could not find vswhere at ${vswhere}.`,
      "Install Visual Studio 2022/2026 with the 'Desktop development with C++' workload."
    ]);
  }

  const result = run(vswhere, ["-latest", "-products", "*", "-format", "json"], { cwd: repoRoot });
  if (result.status !== 0) {
    fail([
      "Failed to inspect the local Visual Studio installation.",
      (result.stderr || result.stdout || "").trim()
    ]);
  }

  const instances = JSON.parse(result.stdout);
  const installPath = instances?.[0]?.installationPath;
  if (!installPath) {
    fail([
      "CrossBridge Windows packaging requires Visual Studio C++ Build Tools.",
      "No Visual Studio installation was found by vswhere."
    ]);
  }

  const msvcVersionDir = findNewestChild(path.join(installPath, "VC", "Tools", "MSVC"));
  const vcvarsall = path.join(installPath, "VC", "Auxiliary", "Build", "vcvarsall.bat");

  if (!msvcVersionDir) {
    fail([
      "CrossBridge Windows packaging requires the Visual Studio MSVC toolchain.",
      `No MSVC toolset was found under ${path.join(installPath, "VC", "Tools", "MSVC")}.`,
      "Install or repair the 'Desktop development with C++' workload."
    ]);
  }

  const pathsToCheck = {
    "VC activation script": vcvarsall,
    "MSVC compiler": path.join(msvcVersionDir, "bin", "Hostx64", "x64", "cl.exe"),
    "MSVC linker": path.join(msvcVersionDir, "bin", "Hostx64", "x64", "link.exe"),
    "MSVC archiver": path.join(msvcVersionDir, "bin", "Hostx64", "x64", "lib.exe"),
    "MSVC headers": path.join(msvcVersionDir, "include"),
    "MSVC x64 libraries": path.join(msvcVersionDir, "lib", "x64")
  };

  const missing = Object.entries(pathsToCheck).filter(([, filePath]) => !fs.existsSync(filePath));
  if (missing.length > 0) {
    fail([
      "CrossBridge Windows packaging requires a complete Visual Studio C++ workload.",
      ...missing.map(([label, filePath]) => `Missing ${label}: ${filePath}`),
      "Open Visual Studio Installer and add or repair 'Desktop development with C++'."
    ]);
  }

  return {
    installPath,
    toolsetPath: msvcVersionDir,
    binDir: path.join(msvcVersionDir, "bin", "Hostx64", "x64"),
    includeDir: path.join(msvcVersionDir, "include"),
    libDir: path.join(msvcVersionDir, "lib", "x64")
  };
}

function buildWindowsCommand() {
  ensureRustupTarget();

  const visualStudio = resolveVisualStudioMsvc();
  const windowsSdk = resolveWindowsSdk();

  const env = {
    ...process.env,
    RUSTUP_TOOLCHAIN: preferredToolchain,
    CARGO_BUILD_TARGET: windowsTarget,
    CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER: "link.exe",
    CC_x86_64_pc_windows_msvc: "cl.exe",
    CXX_x86_64_pc_windows_msvc: "cl.exe",
    AR_x86_64_pc_windows_msvc: "lib.exe",
    VCINSTALLDIR: `${path.join(visualStudio.installPath, "VC")}${path.sep}`,
    VCToolsInstallDir: `${visualStudio.toolsetPath}${path.sep}`,
    VSINSTALLDIR: `${visualStudio.installPath}${path.sep}`,
    VisualStudioVersion: "18.0",
    WindowsSdkDir: `${windowsSdk.root}${path.sep}`,
    WindowsSdkBinPath: `${windowsSdk.binDir}${path.sep}`,
    WindowsSdkVerBinPath: `${windowsSdk.binDir}${path.sep}`,
    WindowsSDKVersion: windowsSdk.version,
    UniversalCRTSdkDir: `${windowsSdk.root}${path.sep}`,
    INCLUDE: [visualStudio.includeDir, ...windowsSdk.includeDirs].join(path.delimiter),
    LIB: [visualStudio.libDir, ...windowsSdk.libDirs].join(path.delimiter),
    PATH: [visualStudio.binDir, windowsSdk.binDir, process.env.PATH ?? ""].join(path.delimiter)
  };

  const forwardedArgs = process.argv.slice(2);
  const tauriArgs = ["build", ...forwardedArgs];
  if (!tauriArgs.includes("--target")) {
    tauriArgs.push("--target", windowsTarget);
  }

  const result = run(tauriBin, tauriArgs, {
    cwd: windowsWorkspaceRoot,
    env,
    stdio: "inherit"
  });

  process.exit(result.status ?? 1);
}

if (process.platform !== "win32") {
  const result = run(tauriBin, ["build", ...process.argv.slice(2)], {
    cwd: windowsWorkspaceRoot,
    stdio: "inherit"
  });
  process.exit(result.status ?? 1);
}

buildWindowsCommand();
