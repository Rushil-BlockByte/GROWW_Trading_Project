import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const requestToken = process.argv[2];
const envPath = path.resolve(process.cwd(), ".env");

function parseEnv(contents) {
  const env = {};

  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^([^#=\s]+)=(.*)$/);

    if (!match) continue;

    let value = match[2].trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[match[1]] = value;
  }

  return env;
}

function updateAccessToken(contents, accessToken) {
  const lines = contents.split(/\r?\n/);
  let found = false;
  const updated = lines.map((line) => {
    if (line.startsWith("KITE_ACCESS_TOKEN=")) {
      found = true;
      return `KITE_ACCESS_TOKEN=${accessToken}`;
    }

    return line;
  });

  if (!found) {
    updated.push(`KITE_ACCESS_TOKEN=${accessToken}`);
  }

  return `${updated.join("\n").replace(/\n*$/, "")}\n`;
}

async function main() {
  if (!requestToken) {
    throw new Error("Pass the one-time request_token as the first argument.");
  }

  const envContents = fs.readFileSync(envPath, "utf8");
  const env = parseEnv(envContents);

  if (!env.KITE_API_KEY || !env.KITE_API_SECRET) {
    throw new Error("Missing KITE_API_KEY or KITE_API_SECRET in .env.");
  }

  const checksum = crypto
    .createHash("sha256")
    .update(`${env.KITE_API_KEY}${requestToken}${env.KITE_API_SECRET}`)
    .digest("hex");
  const body = new URLSearchParams({
    api_key: env.KITE_API_KEY,
    request_token: requestToken,
    checksum,
  });

  const response = await fetch("https://api.kite.trade/session/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Kite-Version": "3",
    },
    body,
  });
  const payload = await response.json().catch(() => undefined);

  if (!response.ok || payload?.status === "error") {
    throw new Error(payload?.message ?? `Kite token exchange failed with ${response.status}.`);
  }

  const accessToken = payload?.data?.access_token;

  if (!accessToken) {
    throw new Error("Kite response did not include an access_token.");
  }

  fs.writeFileSync(envPath, updateAccessToken(envContents, accessToken));

  console.log(
    JSON.stringify({
      ok: true,
      accessTokenSaved: true,
      userId: payload?.data?.user_id,
      expires: "6 AM next day",
    }),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      message: error.message,
    }),
  );
  process.exit(1);
});
