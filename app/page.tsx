import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getServerConfig } from "@/lib/config/env";
import { getOptionalAppUser } from "@/lib/auth/session";
import {
  runSampleMultiDayVwapBreakoutBacktest,
  runSampleVwapBreakoutBacktest,
} from "@/lib/backtesting/vwap-breakout-backtest";

export default async function Home() {
  const user = await getOptionalAppUser();

  if (!user) {
    redirect("/login");
  }

  const { marketDataMode } = getServerConfig();
  const isLive = marketDataMode === "live";

  return (
    <DashboardShell
      marketDataMode={marketDataMode}
      initialBacktestResult={isLive ? null : runSampleVwapBreakoutBacktest()}
      initialMultiDayBacktestResult={isLive ? null : runSampleMultiDayVwapBreakoutBacktest()}
    />
  );
}
