import { NextRequest, NextResponse } from "next/server";
import { getLiveKiteStreamService } from "@/lib/zerodha/live-stream-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getLiveKiteStreamService().getSnapshot());
}

export async function POST(request: NextRequest) {
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
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Kite stream action failed.",
        snapshot: service.getSnapshot(),
      },
      { status: 500 },
    );
  }
}
