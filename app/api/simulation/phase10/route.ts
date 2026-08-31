import { NextResponse } from "next/server";
import {
  DEFAULT_HISTORICAL_OPTION_SPREAD_PERCENT,
  DEFAULT_HISTORICAL_OPTION_STRIKE_WINDOW,
  MAX_HISTORICAL_OPTION_STRIKE_WINDOW,
} from "@/lib/zerodha/option-historical-config";

export async function GET() {
  return NextResponse.json({
    mode: "simulation",
    phase: 10,
    liveOrdersEnabled: false,
    optionHistoricalIngestion: {
      status: "ready",
      endpoint: "/api/kite/historical?includeOptions=true",
      defaultStrikeWindow: DEFAULT_HISTORICAL_OPTION_STRIKE_WINDOW,
      maximumStrikeWindow: MAX_HISTORICAL_OPTION_STRIKE_WINDOW,
      defaultSpreadAssumptionPercent: DEFAULT_HISTORICAL_OPTION_SPREAD_PERCENT,
      note: "Kite supplies option OHLC, volume, and optional OI; historical bid/ask is estimated for replay liquidity checks.",
    },
  });
}
