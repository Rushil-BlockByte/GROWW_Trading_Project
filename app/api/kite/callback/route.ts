import { NextRequest } from "next/server";
import { getServerConfig } from "@/lib/config/env";
import { updateLocalEnvValue } from "@/lib/config/local-env-file";
import { exchangeKiteRequestToken } from "@/lib/zerodha/token-exchange";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function html(body: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Zerodha Connection</title></head><body style="font-family:system-ui;padding:32px;line-height:1.5">${body}<p><a href="/">Return to dashboard</a></p></body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    },
  );
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function GET(request: NextRequest) {
  const requestToken = request.nextUrl.searchParams.get("request_token");
  const status = request.nextUrl.searchParams.get("status");
  const config = getServerConfig();

  if (status && status !== "success") {
    return html("<h1>Zerodha login was not successful.</h1>", 400);
  }

  if (!requestToken) {
    return html("<h1>Missing request token.</h1>", 400);
  }

  if (!config.kiteApiKey || !config.kiteApiSecret) {
    return html("<h1>Kite API key or secret is missing in the local environment.</h1>", 500);
  }

  try {
    const session = await exchangeKiteRequestToken({
      apiKey: config.kiteApiKey,
      apiSecret: config.kiteApiSecret,
      requestToken,
    });

    updateLocalEnvValue("KITE_ACCESS_TOKEN", session.accessToken);

    return html(
      `<h1>Zerodha connected.</h1><p>Access token saved locally for user ${escapeHtml(session.userId ?? "unknown")}.</p><p>Live order execution remains disabled.</p>`,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not exchange the Zerodha request token.";

    return html(`<h1>Zerodha token exchange failed.</h1><p>${escapeHtml(message)}</p>`, 400);
  }
}
