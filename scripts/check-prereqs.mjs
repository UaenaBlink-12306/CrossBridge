import { spawnSync } from "node:child_process";

const checks = [
  { name: "Node.js", command: "node", args: ["--version"], required: true },
  { name: "npm", command: "npm", args: ["--version"], required: true },
  { name: "Java", command: "java", args: ["-version"], required: false },
  { name: "Gradle", command: "gradle", args: ["--version"], required: false },
  { name: "Rust", command: "rustc", args: ["--version"], required: false },
  { name: "Cargo", command: "cargo", args: ["--version"], required: false }
];

function commandForPlatform(command) {
  if (process.platform !== "win32") return command;
  if (command === "npm") return "npm.cmd";
  if (command === "gradle") return "gradle.bat";
  return command;
}

function runCheck(check) {
  if (check.command === "npm" && process.env.npm_execpath) {
    return spawnSync(process.execPath, [process.env.npm_execpath, ...check.args], { encoding: "utf8" });
  }

  return spawnSync(commandForPlatform(check.command), check.args, { encoding: "utf8" });
}

let missingRequired = false;

for (const check of checks) {
  const result = runCheck(check);
  const ok = result.status === 0;
  const status = ok ? "ok" : check.required ? "missing" : "not installed";
  console.log(`${check.name}: ${status}`);

  if (ok) {
    const output = `${result.stdout || result.stderr}`.trim().split("\n")[0];
    if (output) console.log(`  ${output}`);
  }

  if (!ok && check.required) missingRequired = true;
}

if (missingRequired) {
  process.exitCode = 1;
}
