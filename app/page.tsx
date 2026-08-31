import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { runSampleVwapBreakoutBacktest } from "@/lib/backtesting/vwap-breakout-backtest";
import { createInitialMarketSnapshot } from "@/lib/simulation/market-snapshot";

export default function Home() {
  return (
    <DashboardShell
      initialBacktestResult={runSampleVwapBreakoutBacktest()}
      initialSnapshot={createInitialMarketSnapshot()}
    />
  );
}
