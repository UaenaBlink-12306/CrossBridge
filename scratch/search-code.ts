import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function search(dir: string) {
  const files = readdirSync(dir);
  for (const file of files) {
    if (file === "node_modules" || file === ".git" || file === "dist" || file === "build" || file === ".gradle") continue;
    const fullPath = join(dir, file);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      search(fullPath);
    } else if (stat.isFile() && (file.endsWith(".ts") || file.endsWith(".kt") || file.endsWith(".js") || file.endsWith(".json"))) {
      const content = readFileSync(fullPath, "utf8");
      if (content.includes("canonicalKeyParticipants")) {
        console.log(`Found in: ${fullPath}`);
      }
    }
  }
}

search(".");
