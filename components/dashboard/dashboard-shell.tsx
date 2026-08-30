"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  BookOpenText,
  CalendarDays,
  CandlestickChart,
  CircleDollarSign,
  Database,
  Gauge,
  Layers,
  PauseCircle,
  Power,
  Radio,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  WifiOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getMarketDataModeLabel } from "@/lib/config/market";
import { DEFAULT_RISK_CONFIGURATION } from "@/lib/risk/defaults";
import { calculateDailyLossLimit, calculatePositionSize } from "@/lib/risk/position-sizing";
import { createSimulatedMarketSnapshot } from "@/lib/simulation/market-snapshot";
import type { PriceLevel } from "@/types/indicators";
import type { LiveKiteStreamSnapshot } from "@/lib/zerodha/live-stream-service";
import type { SimulatedMarketSnapshot, SimulatedUnderlying } from "@/types/simulation";

type DashboardShellProps = {
  initialSnapshot: SimulatedMarketSnapshot;
};

const numberFormat = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

const inrFormat = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

function formatNumber(value: number) {
  return numberFormat.format(value);
}

function formatInr(value: number | string) {
  return inrFormat.format(Number(value));
}

function formatSigned(value: number, suffix = "") {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value)}${suffix}`;
}

function formatIndicator(value: string | null, suffix = "") {
  return value ? `${formatNumber(Number(value))}${suffix}` : "Pending";
}

function formatSignedIndicator(value: string | null, suffix = "") {
  if (!value) return "Pending";

  return formatSigned(Number(value), suffix);
}

function regimeVariant(regime: SimulatedUnderlying["regime"]) {
  if (regime.includes("BULLISH")) return "success" as const;
  if (regime.includes("BEARISH")) return "destructive" as const;
  if (regime.includes("VOLATILITY")) return "warning" as const;
  return "muted" as const;
}

function dataQualityVariant(status: SimulatedUnderlying["dataQuality"]) {
  if (status === "GOOD") return "success" as const;
  if (status === "STALE" || status === "INSUFFICIENT_DATA") return "warning" as const;
  return "muted" as const;
}

function emaTrendVariant(trend: SimulatedMarketSnapshot["phase4"]["emaTrend"]) {
  if (trend === "Bullish") return "success" as const;
  if (trend === "Bearish") return "destructive" as const;
  if (trend === "Mixed") return "warning" as const;
  return "muted" as const;
}

export function DashboardShell({ initialSnapshot }: DashboardShellProps) {
  const [step, setStep] = useState(0);
  const [selectedUnderlying, setSelectedUnderlying] = useState<SimulatedUnderlying["symbol"]>("NIFTY");

  useEffect(() => {
    const interval = window.setInterval(() => {
      setStep((currentStep) => currentStep + 1);
    }, 2000);

    return () => window.clearInterval(interval);
  }, []);

  const snapshot = useMemo(
    () => (step === 0 ? initialSnapshot : createSimulatedMarketSnapshot(step)),
    [initialSnapshot, step],
  );

  const mode = getMarketDataModeLabel(snapshot.health.mode);
  const risk = DEFAULT_RISK_CONFIGURATION;
  const positionSize = useMemo(
    () =>
      calculatePositionSize({
        tradingCapital: risk.tradingCapital,
        riskPerTradePercent: risk.riskPerTradePercent,
        entryPrice: "150",
        stopPrice: "140",
        lotSize: 75,
      }),
    [risk.riskPerTradePercent, risk.tradingCapital],
  );
  const dailyLossLimit = calculateDailyLossLimit(
    risk.tradingCapital,
    risk.maximumDailyLossPercent,
  );

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-4 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
          <div>
            <p className="text-sm font-semibold text-primary">GROWW Trading Project</p>
            <h1 className="text-2xl font-semibold tracking-normal sm:text-3xl">
              Indian Options Opportunity Scanner
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={mode.tone}>
              <Radio className="h-3.5 w-3.5" />
              {mode.label}
            </Badge>
            <Badge variant="outline">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              Read-only
            </Badge>
            <Button asChild variant="outline">
              <Link href="/daily-plan">
                <CalendarDays className="h-4 w-4" />
                Daily Plan
              </Link>
            </Button>
          </div>
        </header>

        <section className="grid gap-3 lg:grid-cols-3">
          {snapshot.underlyings.map((underlying) => (
            <MarketCard key={underlying.symbol} underlying={underlying} />
          ))}
        </section>

        <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <IndicatorContextPanel snapshot={snapshot} />
          <OpportunityScanner snapshot={snapshot} />
        </section>

        <section>
          <OptionChain
            snapshot={snapshot}
            selectedUnderlying={selectedUnderlying}
            onSelectUnderlying={setSelectedUnderlying}
          />
        </section>

        <section className="grid gap-4 xl:grid-cols-4">
          <RiskDashboard
            dailyLossLimit={dailyLossLimit}
            positionSize={positionSize}
            risk={risk}
          />
          <Phase2Pipeline snapshot={snapshot} />
          <LiveConnectionPanel />
          <SystemHealth snapshot={snapshot} />
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpenText className="h-5 w-5 text-accent" />
                Paper Trade Journal
              </CardTitle>
              <CardDescription>No open paper trades</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid gap-2 rounded-md border bg-muted/40 p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">Unrealized P&L</span>
                  <span className="tabular-nums">{formatInr(0)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">Realized P&L</span>
                  <span className="tabular-nums">{formatInr(0)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">Rule violations</span>
                  <span className="tabular-nums">0</span>
                </div>
              </div>
              <textarea
                className="min-h-28 rounded-md border bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="What did I see? Did I follow the plan? Emotional state. Lesson."
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-secondary" />
                Signal History
              </CardTitle>
              <CardDescription>Alerts appear only on signal state transitions</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="flex items-start gap-3 rounded-md border bg-muted/40 p-3">
                <PauseCircle className="mt-0.5 h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-semibold">No confirmed signal</p>
                  <p className="text-sm text-muted-foreground">
                    Current state: {snapshot.signal.state}. Paper entry remains disabled.
                  </p>
                </div>
              </div>
              <Button disabled variant="secondary">
                <CircleDollarSign className="h-4 w-4" />
                Take Paper Trade
              </Button>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}

function IndicatorContextPanel({ snapshot }: { snapshot: SimulatedMarketSnapshot }) {
  const indicator = snapshot.phase4;
  const openingRange = indicator.openingRange15;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              Indicator Context
            </CardTitle>
            <CardDescription>
              {indicator.underlying} with {indicator.candleCount} one-minute candles
            </CardDescription>
          </div>
          <Badge variant={emaTrendVariant(indicator.emaTrend)}>{indicator.emaTrend}</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <Metric label="Close" value={formatIndicator(indicator.latestClose)} />
          <Metric label="VWAP" value={formatIndicator(indicator.vwap)} />
          <Metric label="VWAP dist" value={formatSignedIndicator(indicator.vwapDistance)} />
          <Metric label="EMA 9" value={formatIndicator(indicator.ema9)} />
          <Metric label="EMA 20" value={formatIndicator(indicator.ema20)} />
          <Metric label="EMA 50" value={formatIndicator(indicator.ema50)} />
          <Metric label="ATR 14" value={formatIndicator(indicator.atr14)} />
          <Metric label="RSI 14" value={formatIndicator(indicator.rsi14)} />
          <Metric label="Rel volume" value={formatIndicator(indicator.relativeVolume20, "x")} />
        </div>

        <div className="rounded-md border bg-muted/40 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">Opening Range 15</p>
            <Badge variant={openingRange?.complete ? "success" : "warning"}>
              {openingRange?.complete ? "Complete" : "Building"}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <Metric label="High" value={formatIndicator(openingRange?.high ?? null)} />
            <Metric label="Low" value={formatIndicator(openingRange?.low ?? null)} />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <LevelList title="Potential Support" levels={indicator.potentialSupport} />
          <LevelList title="Potential Resistance" levels={indicator.potentialResistance} />
        </div>
      </CardContent>
    </Card>
  );
}

function LevelList({ title, levels }: { title: string; levels: PriceLevel[] }) {
  return (
    <div className="rounded-md border p-3">
      <p className="mb-2 text-sm font-semibold">{title}</p>
      <div className="grid gap-2">
        {levels.length ? (
          levels.map((level) => (
            <div
              key={`${level.source}-${level.label}-${level.value}`}
              className="flex items-center justify-between gap-3 rounded-md border bg-muted/35 px-3 py-2 text-sm"
            >
              <span className="min-w-0 truncate text-muted-foreground">{level.label}</span>
              <span className="font-semibold tabular-nums">{formatIndicator(level.value)}</span>
            </div>
          ))
        ) : (
          <div className="rounded-md border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
            Pending
          </div>
        )}
      </div>
    </div>
  );
}

function LiveConnectionPanel() {
  const [status, setStatus] = useState<LiveKiteStreamSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const response = await fetch("/api/kite/stream", { cache: "no-store" });
    const data = (await response.json()) as LiveKiteStreamSnapshot;
    setStatus(data);
  }, []);

  async function runAction(action: "start" | "stop") {
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch("/api/kite/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await response.json()) as LiveKiteStreamSnapshot & {
        message?: string;
        snapshot?: LiveKiteStreamSnapshot;
      };

      if (!response.ok) {
        setStatus(data.snapshot ?? null);
        setMessage(data.message ?? "Kite stream action failed.");
        return;
      }

      setStatus(data);
    } catch {
      setMessage("Could not reach the local Kite stream service.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const initial = window.setTimeout(() => {
      void loadStatus();
    }, 0);
    const interval = window.setInterval(() => {
      void loadStatus();
    }, 5000);

    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [loadStatus]);

  const canStart = Boolean(status?.configured.apiKey && status.configured.accessToken);
  const connected = Boolean(status?.provider.connected);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Power className="h-5 w-5 text-primary" />
          Zerodha Stream
        </CardTitle>
        <CardDescription>Read-only Kite WebSocket</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={connected ? "success" : status?.provider.reconnecting ? "warning" : "muted"}>
            {connected ? "LIVE" : status?.provider.reconnecting ? "RECONNECTING" : "DISCONNECTED"}
          </Badge>
          <Badge variant={status?.dataQualityGateOpen ? "success" : "warning"}>
            {status?.dataQualityGateOpen ? "Data gate open" : "Data gated"}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <Metric label="Token" value={status?.configured.accessToken ? "Set" : "Missing"} />
          <Metric label="Subscribed" value={String(status?.provider.subscriptionCount ?? 0)} />
          <Metric label="Tracked" value={String(status?.marketState.instrumentsTracked ?? 0)} />
          <Metric label="Rejected" value={String(status?.provider.rejectedSubscriptions ?? 0)} />
        </div>

        <div className="grid gap-2">
          <Button
            type="button"
            disabled={!canStart || busy || connected}
            onClick={() => void runAction("start")}
          >
            <Power className="h-4 w-4" />
            Start Stream
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || !status?.running}
            onClick={() => void runAction("stop")}
          >
            <WifiOff className="h-4 w-4" />
            Stop Stream
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void loadStatus()}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        {status?.subscribedInstruments.length ? (
          <div className="grid gap-1 text-xs text-muted-foreground">
            {status.subscribedInstruments.map((instrument) => (
              <div key={instrument.instrumentToken} className="flex justify-between gap-2">
                <span>{instrument.tradingsymbol}</span>
                <span>{instrument.mode}</span>
              </div>
            ))}
          </div>
        ) : null}

        {message || status?.lastError ? (
          <p className="rounded-md border bg-yellow-50 p-2 text-xs font-medium text-yellow-950">
            {message ?? status?.lastError}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Phase2Pipeline({ snapshot }: { snapshot: SimulatedMarketSnapshot }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          Data Pipeline
        </CardTitle>
        <CardDescription>
          {snapshot.phase2.selectedUnderlying} {snapshot.phase2.selectedExpiry}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Metric label="Instruments" value={formatNumber(snapshot.phase2.instrumentMasterCount)} />
          <Metric label="ATM strike" value={formatNumber(Number(snapshot.phase2.atmStrike))} />
          <Metric label="Option universe" value={formatNumber(snapshot.phase2.optionUniverseCount)} />
          <Metric label="State tracked" value={formatNumber(snapshot.phase2.trackedInstruments)} />
        </div>

        <div className="rounded-md border bg-muted/40 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <CandlestickChart className="h-4 w-4 text-accent" />
              Active candles
            </p>
            <Badge variant={dataQualityVariant(snapshot.phase2.dataQuality)}>
              {snapshot.phase2.dataQuality.replace("_", " ")}
            </Badge>
          </div>
          <div className="grid gap-2">
            {snapshot.phase2.activeCandles.map((candle) => (
              <div
                key={`${candle.instrumentToken}-${candle.interval}`}
                className="grid grid-cols-[44px_1fr_auto] items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs"
              >
                <span className="font-semibold">{candle.interval}</span>
                <span className="text-muted-foreground">
                  O {candle.open} H {candle.high} L {candle.low} C {candle.close}
                </span>
                <span className="tabular-nums">{candle.tickCount} ticks</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-2 text-sm">
          <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
            <span className="text-muted-foreground">Missing contracts</span>
            <span className="font-semibold">{snapshot.phase2.missingContracts}</span>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
            <span className="text-muted-foreground">Completed candles</span>
            <span className="font-semibold">{snapshot.phase2.completedCandleCount}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MarketCard({ underlying }: { underlying: SimulatedUnderlying }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{underlying.label}</CardTitle>
            <CardDescription>{underlying.symbol}</CardDescription>
          </div>
          <Badge variant={regimeVariant(underlying.regime)}>{underlying.regime.replace("_", " ")}</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">LTP</p>
            <p className="text-2xl font-semibold tabular-nums">{formatNumber(underlying.lastPrice)}</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold text-emerald-700">
              {formatSigned(underlying.change)}
            </p>
            <p className="text-muted-foreground">
              {formatSigned(underlying.changePercent, "%")}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <Metric label="VWAP" value={formatNumber(underlying.vwap)} />
          <Metric label="VWAP distance" value={formatSigned(underlying.vwapDistance)} />
          <Metric label="Trend" value={underlying.trend} />
          <Metric label="Rel volume" value={`${underlying.volumeRelative}x`} />
          <Metric label="OI" value={formatNumber(underlying.openInterest)} />
          <Metric label="OI change" value={formatSigned(underlying.oiChange)} />
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <Metric label="Support" value={formatNumber(underlying.support)} />
          <Metric label="Resistance" value={formatNumber(underlying.resistance)} />
        </div>

        <Badge variant={dataQualityVariant(underlying.dataQuality)} className="w-fit">
          <Activity className="h-3.5 w-3.5" />
          Data quality: {underlying.dataQuality.replace("_", " ")}
        </Badge>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/35 px-3 py-2">
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function OpportunityScanner({ snapshot }: { snapshot: SimulatedMarketSnapshot }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="h-5 w-5 text-accent" />
              Opportunity Scanner
            </CardTitle>
            <CardDescription>{snapshot.signal.setupName}</CardDescription>
          </div>
          <Badge variant="muted">{snapshot.signal.direction}</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">Setup score</span>
            <span className="text-lg font-semibold tabular-nums">{snapshot.signal.score}/100</span>
          </div>
          <Progress value={snapshot.signal.score} />
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Quality</span>
            <Badge variant="muted">{snapshot.signal.quality}</Badge>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md border p-3">
            <p className="mb-2 text-sm font-semibold">Reasons</p>
            <ul className="grid gap-2 text-sm text-muted-foreground">
              {snapshot.signal.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-md border p-3">
            <p className="mb-2 text-sm font-semibold">Risks</p>
            <ul className="grid gap-2 text-sm text-muted-foreground">
              {snapshot.signal.risks.map((risk) => (
                <li key={risk}>{risk}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="grid gap-2 rounded-md border bg-muted/40 p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">Suggested option</span>
            <span className="text-muted-foreground">None</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">Entry</span>
            <span className="text-muted-foreground">Waiting for confirmed setup</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">Risk/reward</span>
            <span className="text-muted-foreground">Not valid</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function OptionChain({
  snapshot,
  selectedUnderlying,
  onSelectUnderlying,
}: {
  snapshot: SimulatedMarketSnapshot;
  selectedUnderlying: SimulatedUnderlying["symbol"];
  onSelectUnderlying: (symbol: SimulatedUnderlying["symbol"]) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              Option Chain
            </CardTitle>
            <CardDescription>Nearest expiry simulation</CardDescription>
          </div>
          <div className="flex rounded-md border bg-muted/35 p-1">
            {snapshot.underlyings.map((underlying) => (
              <Button
                key={underlying.symbol}
                type="button"
                size="sm"
                variant={selectedUnderlying === underlying.symbol ? "default" : "ghost"}
                onClick={() => onSelectUnderlying(underlying.symbol)}
              >
                {underlying.symbol}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>CE LTP</TableHead>
              <TableHead>CE OI</TableHead>
              <TableHead>Strike</TableHead>
              <TableHead>PE OI</TableHead>
              <TableHead>PE LTP</TableHead>
              <TableHead>Spread</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {snapshot.optionChain.map((row) => (
              <TableRow key={row.strike} className={row.isAtm ? "bg-secondary/20" : undefined}>
                <TableCell className="font-semibold tabular-nums">{formatInr(row.call.ltp)}</TableCell>
                <TableCell className="tabular-nums">
                  {formatNumber(row.call.openInterest)}
                  <span className="ml-1 text-xs text-emerald-700">
                    {formatSigned(row.call.oiChange)}
                  </span>
                </TableCell>
                <TableCell className="font-semibold tabular-nums">
                  {formatNumber(row.strike)}
                  {row.isAtm ? <Badge className="ml-2" variant="secondary">ATM</Badge> : null}
                </TableCell>
                <TableCell className="tabular-nums">
                  {formatNumber(row.put.openInterest)}
                  <span className="ml-1 text-xs text-emerald-700">
                    {formatSigned(row.put.oiChange)}
                  </span>
                </TableCell>
                <TableCell className="font-semibold tabular-nums">{formatInr(row.put.ltp)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  CE {row.call.spreadPercent}% / PE {row.put.spreadPercent}%
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function RiskDashboard({
  dailyLossLimit,
  positionSize,
  risk,
}: {
  dailyLossLimit: string;
  positionSize: ReturnType<typeof calculatePositionSize>;
  risk: typeof DEFAULT_RISK_CONFIGURATION;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-destructive" />
          Risk Dashboard
        </CardTitle>
        <CardDescription>Daily lock and position sizing</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Metric label="Trading capital" value={formatInr(risk.tradingCapital)} />
          <Metric label="Risk per trade" value={`${risk.riskPerTradePercent}%`} />
          <Metric label="Daily loss limit" value={formatInr(dailyLossLimit)} />
          <Metric label="Max trades" value={String(risk.maximumTradesPerDay)} />
        </div>

        <div className="rounded-md border bg-muted/40 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold">Position size check</p>
              <p className="text-sm text-muted-foreground">Entry 150, stop 140, lot size 75</p>
            </div>
            <Badge variant={positionSize.canTrade ? "success" : "muted"}>
              {positionSize.canTrade ? "TRADE ALLOWED" : "NO TRADE"}
            </Badge>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <Metric label="Maximum risk" value={formatInr(positionSize.maximumRisk)} />
            <Metric label="Quantity" value={String(positionSize.quantity)} />
          </div>
          {positionSize.reason ? (
            <p className="mt-3 text-sm font-medium text-muted-foreground">{positionSize.reason}</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function SystemHealth({ snapshot }: { snapshot: SimulatedMarketSnapshot }) {
  const rows = [
    ["WebSocket", snapshot.health.websocket],
    ["Last tick", `${snapshot.health.lastTickSecondsAgo}s ago`],
    ["Subscriptions", String(snapshot.health.subscriptions)],
    ["Rejected", String(snapshot.health.rejectedSubscriptions)],
    ["Data quality", snapshot.health.dataQuality],
    ["Signal engine", snapshot.health.signalEngine],
    ["Database", snapshot.health.database],
    ["Mode", snapshot.health.mode.toUpperCase()],
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5 text-accent" />
          System Health
        </CardTitle>
        <CardDescription>
          Generated {new Date(snapshot.generatedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-semibold tabular-nums">{value.replace("_", " ")}</span>
            </div>
          ))}
        </div>
        <div className="flex items-start gap-3 rounded-md border bg-yellow-50 p-3 text-sm text-yellow-950">
          <WifiOff className="mt-0.5 h-5 w-5" />
          <div>
            <p className="font-semibold">Live stream disconnected</p>
            <p>Market-data pipeline is not connected.</p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-md border bg-red-50 p-3 text-sm text-red-950">
          <AlertTriangle className="mt-0.5 h-5 w-5" />
          <div>
            <p className="font-semibold">Live order execution disabled</p>
            <p>Read-only signals and paper trades only.</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
