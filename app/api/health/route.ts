import { NextResponse } from "next/server";
import { getClientSafeConfig } from "@/lib/config/env";

export async function GET() {
  const config = getClientSafeConfig();

  return NextResponse.json({
    ok: true,
    mode: config.marketDataMode,
    liveOrdersEnabled: false,
    timezone: "Asia/Kolkata",
  });
}
