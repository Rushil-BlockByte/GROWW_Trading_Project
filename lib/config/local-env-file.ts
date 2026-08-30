import fs from "node:fs";
import path from "node:path";

export function updateLocalEnvValue(key: string, value: string, envPath = path.resolve(".env")) {
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const lines = existing.split(/\r?\n/);
  let found = false;
  const updated = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }

    return line;
  });

  if (!found) {
    updated.push(`${key}=${value}`);
  }

  fs.writeFileSync(envPath, `${updated.join("\n").replace(/\n*$/, "")}\n`);
}
