import crypto from "node:crypto";

export type KiteTokenExchangeInput = {
  apiKey: string;
  apiSecret: string;
  requestToken: string;
};

export type KiteTokenExchangeResult = {
  accessToken: string;
  userId?: string;
  loginTime?: string;
};

export async function exchangeKiteRequestToken({
  apiKey,
  apiSecret,
  requestToken,
}: KiteTokenExchangeInput): Promise<KiteTokenExchangeResult> {
  const checksum = crypto
    .createHash("sha256")
    .update(`${apiKey}${requestToken}${apiSecret}`)
    .digest("hex");
  const response = await fetch("https://api.kite.trade/session/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Kite-Version": "3",
    },
    body: new URLSearchParams({
      api_key: apiKey,
      request_token: requestToken,
      checksum,
    }),
  });
  const payload = (await response.json().catch(() => undefined)) as
    | {
        status?: string;
        message?: string;
        data?: {
          access_token?: string;
          user_id?: string;
          login_time?: string;
        };
      }
    | undefined;

  if (!response.ok || payload?.status === "error") {
    throw new Error(payload?.message ?? `Kite token exchange failed with ${response.status}.`);
  }

  if (!payload?.data?.access_token) {
    throw new Error("Kite response did not include an access token.");
  }

  return {
    accessToken: payload.data.access_token,
    userId: payload.data.user_id,
    loginTime: payload.data.login_time,
  };
}
