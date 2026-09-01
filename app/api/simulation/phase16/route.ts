import { NextResponse } from "next/server";
import { isAuthenticationRequired } from "@/lib/auth/session";

export async function GET() {
  return NextResponse.json({
    mode: "simulation",
    phase: 16,
    liveOrdersEnabled: false,
    authentication: {
      required: isAuthenticationRequired(),
      loginRoute: "/login",
      sessionApiRoute: "/api/auth/session",
      protectedAreas: ["saved reports", "paper journal", "reviews", "stream controls"],
      status: "ready",
      note: "Owner login protects private data when auth is configured or live mode is enabled.",
    },
  });
}
