import { spawnSync } from "node:child_process";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Error: No file path provided for signing.");
  process.exit(1);
}

const pfxPath = process.env.TAURI_WIN_SIGNING_PFX_PATH;
const pfxPassword = process.env.TAURI_WIN_SIGNING_PFX_PASSWORD;

if (!pfxPath) {
  console.log(`Code signing certificate not found (TAURI_WIN_SIGNING_PFX_PATH is empty). Skipping signing of: ${filePath}`);
  process.exit(0);
}

console.log(`Code signing certificate found. Signing: ${filePath}`);

const args = [
  "sign",
  "/f", pfxPath,
  "/p", pfxPassword,
  "/fd", "sha256",
  "/tr", "http://timestamp.digicert.com",
  "/td", "sha256",
  filePath
];

// Run signtool
const result = spawnSync("signtool", args, {
  stdio: "inherit",
  shell: true
});

if (result.status !== 0) {
  console.error(`Error: signtool failed with exit code ${result.status}`);
  process.exit(result.status ?? 1);
}

console.log(`Successfully signed: ${filePath}`);
process.exit(0);
