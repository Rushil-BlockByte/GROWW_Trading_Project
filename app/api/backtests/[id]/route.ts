import { NextResponse } from "next/server";
import { getPersistedBacktestDetail } from "@/lib/persistence/backtest-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BacktestDetailRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, { params }: BacktestDetailRouteContext) {
  try {
    const { id } = await params;
    const result = await getPersistedBacktestDetail({ id });

    return NextResponse.json(
      {
        ok: Boolean(result.report),
        ...result,
      },
      { status: result.report || result.persistence.status === "local_only" ? 200 : 404 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backtest report load failed.";

    return NextResponse.json(
      {
        ok: false,
        persistence: {
          configured: true,
          status: "error",
          message,
        },
        report: null,
        liveOrdersEnabled: false,
      },
      { status: 503 },
    );
  }
}
