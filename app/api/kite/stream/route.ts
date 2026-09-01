import { NextRequest, NextResponse } from "next/server";
import { requireAppUserForApi } from "@/lib/auth/api";
import { getLiveKiteStreamService } from "@/lib/zerodha/live-stream-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAppUserForApi();

  if (auth.response) return auth.response;

  return NextResponse.json(getLiveKiteStreamService().getSnapshot());
}

export async function POST(request: NextRequest) {
  const auth = await requireAppUserForApi();

  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { action?: string };
  const service = getLiveKiteStreamService();

  try {
    if (body.action === "stop") {
      return NextResponse.json(await service.stop());
    }

    if (body.action === "start") {
      return NextResponse.json(await service.start());
    }

    return NextResponse.json(
      { ok: false, message: "Unsupported stream action." },
      { status: 400 },
    );
  } catch (error) {
    const snapshot = service.getSnapshot();
    const expectedStartBlock = body.action === "start" && !snapshot.streamStartAllowed;

    return NextResponse.json(
      {
        ok: false,
        blocked: expectedStartBlock,
        message: error instanceof Error ? error.message : "Kite stream action failed.",
        snapshot,
      },
      { status: expectedStartBlock ? 409 : 500 },
    );
  }
}
