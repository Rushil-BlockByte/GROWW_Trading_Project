import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cache } from "react";
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  Database,
  ExternalLink,
  ListChecks,
  MessageSquareText,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  getPersistedBacktestDetail,
  type BacktestDetailPersistenceResult,
} from "@/lib/persistence/backtest-store";
import { getOptionalAppUser } from "@/lib/auth/session";
import { explainBacktestReport } from "@/lib/explanations/trading-explanations";
import type {
  BacktestReportDetail,
  BacktestReportDetailTrade,
  BacktestReportKind,
} from "@/types/backtest-report";

export const dynamic = "force-dynamic";

type BacktestReportPageProps = {
  params: Promise<{
    id: string;
  }>;
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

const loadBacktestReport = cache(async (id: string): Promise<BacktestDetailPersistenceResult> => {
  try {
    return await getPersistedBacktestDetail({ id });
  } catch (error) {
    return {
      persistence: {
        configured: true,
        status: "error",
        message: error instanceof Error ? error.message : "Backtest report load failed.",
      },
      report: null,
      liveOrdersEnabled: false,
    };
  }
});

function formatNumber(value: number | string | null) {
  if (value === null) return "Pending";

  return numberFormat.format(Number(value));
}

function formatInr(value: number | string | null) {
  if (value === null) return "Pending";

  return inrFormat.format(Number(value));
}

function formatDateTime(value: string | null) {
  if (!value) return "Pending";

  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

function formatDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function formatReportKind(kind: BacktestReportKind) {
  return kind === "multi_day" ? "Multi-day" : "Single-day";
}

function pnlVariant(value: string | null) {
  const pnl = Number(value ?? 0);

  if (pnl > 0) return "success" as const;
  if (pnl < 0) return "destructive" as const;

  return "muted" as const;
}

function outcomeVariant(outcome: string | null) {
  if (outcome === "WIN") return "success" as const;
  if (outcome === "LOSS") return "destructive" as const;

  return "muted" as const;
}

function explanationVariant(verdict: ReturnType<typeof explainBacktestReport>["verdict"]) {
  if (verdict === "positive") return "success" as const;
  if (verdict === "caution") return "destructive" as const;
  if (verdict === "watch") return "warning" as const;

  return "muted" as const;
}

function reportDescription(report: BacktestReportDetail) {
  return `${formatReportKind(report.record.kind)} ${report.record.underlying} backtest report with ${report.record.trades} paper-only trades.`;
}

export async function generateMetadata({
  params,
}: BacktestReportPageProps): Promise<Metadata> {
  const { id } = await params;
  const user = await getOptionalAppUser();

  if (!user) {
    return {
      title: "Private Backtest Report",
      description: "Owner login is required to view this report.",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  const result = await loadBacktestReport(id);
  const title = result.report
    ? `${result.report.record.name} | Backtest Report`
    : "Backtest Report";
  const description = result.report
    ? reportDescription(result.report)
    : "Read-only backtest report link.";

  return {
    title,
    description,
    robots: {
      index: false,
      follow: false,
    },
    openGraph: {
      title,
      description,
      images: [],
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: [],
    },
  };
}

export default async function BacktestReportPage({ params }: BacktestReportPageProps) {
  const { id } = await params;
  const user = await getOptionalAppUser();

  if (!user) {
    redirect("/login");
  }

  const result = await loadBacktestReport(id);

  if (!result.report) {
    return <UnavailableReport id={id} message={result.persistence.message} />;
  }

  const report = result.report;
  const { assumptions, record, sessions, summary, trades } = report;
  const explanation = explainBacktestReport(report);

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
          <div className="flex min-w-0 items-start gap-3">
            <Button asChild variant="outline" size="icon" aria-label="Back to dashboard">
              <Link href="/">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="min-w-0">
              <p className="text-sm font-medium text-muted-foreground">Backtest report link</p>
              <h1 className="truncate text-2xl font-semibold tracking-normal sm:text-3xl">
                {record.name}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {record.underlying} | {record.dataSource.replaceAll("_", " ")} | Saved{" "}
                {formatDateTime(record.savedAt)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Badge variant={pnlVariant(record.netPnl)}>{formatInr(record.netPnl)}</Badge>
            <Badge variant={record.kind === "multi_day" ? "success" : "outline"}>
              {formatReportKind(record.kind)}
            </Badge>
            <Badge variant="success">
              <ShieldCheck className="h-3.5 w-3.5" />
              Read-only
            </Badge>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                <Metric label="Net P&L" value={formatInr(summary.netPnl)} />
                <Metric label="Gross P&L" value={formatInr(summary.grossPnl)} />
                <Metric label="Costs" value={formatInr(summary.costs)} />
                <Metric label="Trades" value={String(summary.trades)} />
                <Metric label="Win rate" value={`${summary.winRate}%`} />
                <Metric label="Max drawdown" value={formatInr(summary.maxDrawdown)} />
                <Metric label="Expectancy" value={formatInr(summary.expectancy)} />
                <Metric label="Signals" value={String(summary.confirmedSignals)} />
                <Metric label="Skipped" value={String(summary.skippedSignals)} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ListChecks className="h-5 w-5 text-accent" />
                Assumptions
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <Metric label="Status" value={record.status.replaceAll("_", " ")} />
              <Metric label="Slippage" value={assumptions.slippagePercent ?? "Not stored"} />
              <Metric label="Brokerage" value={assumptions.brokeragePerOrder ?? "Not stored"} />
              <Metric label="Live orders" value="Off" />
              {assumptions.warnings.length ? (
                <div className="rounded-md border bg-muted/35 px-3 py-2">
                  <p className="text-xs font-medium uppercase text-muted-foreground">Warnings</p>
                  <ul className="mt-2 grid gap-1 text-muted-foreground">
                    {assumptions.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <CardTitle className="flex items-center gap-2">
                <MessageSquareText className="h-5 w-5 text-accent" />
                Plain-English Explanation
              </CardTitle>
              <Badge variant={explanationVariant(explanation.verdict)}>
                {explanation.verdict.replace("_", " ")}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <div className="grid gap-2 rounded-md border bg-muted/35 p-3 text-sm">
              <p className="font-semibold">{explanation.headline}</p>
              <p className="text-muted-foreground">{explanation.summary}</p>
            </div>
            <ExplanationList label="What Worked" items={explanation.strengths} />
            <ExplanationList label="What To Watch" items={explanation.cautions} />
          </CardContent>
        </Card>

        {sessions.length ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-primary" />
                Sessions
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="grid gap-2 rounded-md border bg-muted/35 px-3 py-2 text-sm md:grid-cols-[1fr_auto_auto_auto]"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{session.label}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(session.date)}</p>
                  </div>
                  <Badge variant={session.trades ? "success" : "muted"}>
                    {session.trades ? `${session.trades} trades` : "No trade"}
                  </Badge>
                  <span className="font-semibold tabular-nums">{formatInr(session.netPnl)}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {session.winRate}% wins
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-accent" />
              Trades
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contract</TableHead>
                    <TableHead>Entry</TableHead>
                    <TableHead>Exit</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead>Outcome</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trades.length ? (
                    trades.map((trade) => <TradeRow key={trade.id} trade={trade} />)
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="h-20 text-center text-sm text-muted-foreground"
                      >
                        No trades were taken in this report.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
          <span>{result.persistence.message}</span>
          <span>{report.equityCurve.length} equity points stored for review.</span>
        </div>
      </div>
    </main>
  );
}

function UnavailableReport({ id, message }: { id: string; message: string }) {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-4 px-4 py-6 sm:px-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-accent" />
              Report Not Available
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="rounded-md border bg-muted/35 px-3 py-2 text-sm">
              <p className="font-semibold">Report ID</p>
              <p className="break-all text-muted-foreground">{id}</p>
            </div>
            <p className="text-sm text-muted-foreground">{message}</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/">
                  <ArrowLeft className="h-4 w-4" />
                  Dashboard
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/api/backtests">
                  <ExternalLink className="h-4 w-4" />
                  Saved Reports
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
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

function ExplanationList({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="grid gap-2 rounded-md border bg-muted/35 p-3 text-sm">
      <p className="font-semibold">{label}</p>
      <ul className="grid gap-1 text-muted-foreground">
        {items.slice(0, 4).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function TradeRow({ trade }: { trade: BacktestReportDetailTrade }) {
  return (
    <TableRow>
      <TableCell className="min-w-56">
        <div className="min-w-0">
          <p className="truncate font-semibold">{trade.optionSymbol}</p>
          <p className="text-xs text-muted-foreground">
            {trade.underlying} | {trade.side.replace("_", " ")} | Strike{" "}
            {formatNumber(trade.strike)}
          </p>
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm">
        <p>{formatInr(trade.entryPrice)}</p>
        <p className="text-xs text-muted-foreground">{formatDateTime(trade.entryTime)}</p>
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm">
        <p>{formatInr(trade.exitPrice)}</p>
        <p className="text-xs text-muted-foreground">{formatDateTime(trade.exitTime)}</p>
      </TableCell>
      <TableCell className="whitespace-nowrap text-right tabular-nums">
        {trade.quantity}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right tabular-nums">
        {trade.score}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">
        <span className={Number(trade.realizedPnl ?? 0) >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}>
          {formatInr(trade.realizedPnl)}
        </span>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <Badge variant={outcomeVariant(trade.outcome)}>{trade.outcome ?? "Flat"}</Badge>
      </TableCell>
    </TableRow>
  );
}
