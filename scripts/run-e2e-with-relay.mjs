import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptsDir);
const relayEntry = join(repoRoot, "services", "relay", "dist", "index.js");
const tsxCli = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const verifierEntry = join(repoRoot, "scripts", "e2e-verify.ts");
const relayPort = process.env.CROSSBRIDGE_RELAY_PORT || process.env.PORT || "8787";
const relayHealthUrl = `http://127.0.0.1:${relayPort}/health`;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runProcess(command, args, options = {}) {
  return spawn(command, args, {
    stdio: "inherit",
    ...options
  });
}

async function ensureFileExists(path, message) {
  try {
    await access(path, fsConstants.F_OK);
  } catch {
    throw new Error(message);
  }
}

async function waitForRelay(timeoutMs = 20_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(relayHealthUrl);
      if (response.ok) {
        const body = await response.json();
        if (body?.ok === true) {
          return;
        }
      }
    } catch {
      // The relay is still starting.
    }

    await delay(500);
  }

  throw new Error(`Timed out waiting for relay health at ${relayHealthUrl}.`);
}

async function stopRelay(relayProcess) {
  if (!relayProcess || relayProcess.killed) {
    return;
  }

  relayProcess.kill();

  await Promise.race([
    new Promise((resolve) => relayProcess.once("exit", resolve)),
    delay(5_000)
  ]);

  if (!relayProcess.killed) {
    relayProcess.kill("SIGKILL");
  }
}

async function main() {
  await ensureFileExists(
    relayEntry,
    "Relay build output is missing. Run `npm run build -w @crossbridge/relay` first."
  );
  await ensureFileExists(
    tsxCli,
    "The local tsx CLI is missing. Run `npm install` before `npm run verify:e2e`."
  );

  const relayProcess = runProcess(process.execPath, [relayEntry], {
    cwd: repoRoot,
    env: process.env
  });

  let relayExitedEarly = false;
  relayProcess.once("exit", () => {
    relayExitedEarly = true;
  });

  try {
    await waitForRelay();

    const verifierProcess = runProcess(process.execPath, [tsxCli, verifierEntry], {
      cwd: repoRoot,
      env: process.env
    });

    const exitCode = await new Promise((resolve) => {
      verifierProcess.once("exit", (code) => resolve(code ?? 1));
    });

    process.exitCode = exitCode;
  } catch (error) {
    if (relayExitedEarly) {
      console.error("Relay process exited before the E2E verifier could run.");
    }
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await stopRelay(relayProcess);
  }
}

void main();
