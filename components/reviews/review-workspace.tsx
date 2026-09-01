"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  ClipboardCheck,
  RefreshCw,
  Save,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { summarizeBacktestReportRecords } from "@/lib/backtesting/backtest-reporting";
import type { BacktestReportRecord } from "@/types/backtest-report";
import type {
  ReportReviewCadence,
  ReportReviewPersistenceResult,
  ReportReviewRecord,
} from "@/types/report-review";

type BacktestApiResponse = {
  ok?: boolean;
  persistence?: {
    status: "database" | "local_only" | "error";
    message: string;
  };
  backtests?: unknown[];
  message?: string;
};

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function weekStartIsoDate() {
  const date = new Date();
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;

  date.setDate(date.getDate() + offset);

  return date.toISOString().slice(0, 10);
}

function isBacktestReportRecord(value: unknown): value is BacktestReportRecord {
  if (!value || typeof value !== "object") return false;

  const record = value as Partial<BacktestReportRecord>;

  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.netPnl === "string" &&
    typeof record.winRate === "string" &&
    record.liveOrdersEnabled === false
  );
}

function isReportReviewRecord(value: unknown): value is ReportReviewRecord {
  if (!value || typeof value !== "object") return false;

  const review = value as Partial<ReportReviewRecord>;

  return (
    typeof review.id === "string" &&
    (review.cadence === "daily" || review.cadence === "weekly") &&
    typeof review.title === "string" &&
    typeof review.notes === "string" &&
    review.liveOrdersEnabled === false
  );
}

const inrFormat = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

function formatInr(value: string | number) {
  return inrFormat.format(Number(value));
}

function formatDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function pnlVariant(value: string) {
  const pnl = Number(value);

  if (pnl > 0) return "success" as const;
  if (pnl < 0) return "destructive" as const;

  return "muted" as const;
}

export function ReviewWorkspace() {
  const [reports, setReports] = useState<BacktestReportRecord[]>([]);
  const [reviews, setReviews] = useState<ReportReviewRecord[]>([]);
  const [selectedReportIds, setSelectedReportIds] = useState<string[]>([]);
  const [cadence, setCadence] = useState<ReportReviewCadence>("daily");
  const [periodStart, setPeriodStart] = useState(todayIsoDate);
  const [periodEnd, setPeriodEnd] = useState(todayIsoDate);
  const [title, setTitle] = useState("Daily backtest review");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Select reports and save a review note.");

  const selectedReports = useMemo(
    () => reports.filter((report) => selectedReportIds.includes(report.id)),
    [reports, selectedReportIds],
  );
  const comparison = useMemo(
    () => summarizeBacktestReportRecords(selectedReports),
    [selectedReports],
  );

  const load = useCallback(async () => {
    setBusy(true);

    try {
      const [reportResponse, reviewResponse] = await Promise.all([
        fetch("/api/backtests?limit=50", { cache: "no-store" }),
        fetch("/api/report-reviews?limit=10", { cache: "no-store" }),
      ]);
      const reportData = (await reportResponse.json()) as BacktestApiResponse;
      const reviewData = (await reviewResponse.json()) as ReportReviewPersistenceResult & {
        ok?: boolean;
        message?: string;
      };

      if (!reportResponse.ok || reportData.ok === false) {
        throw new Error(reportData.message ?? "Reports could not be loaded.");
      }

      if (!reviewResponse.ok || reviewData.ok === false) {
        throw new Error(reviewData.message ?? "Reviews could not be loaded.");
      }

      const loadedReports = Array.isArray(reportData.backtests)
        ? reportData.backtests.filter(isBacktestReportRecord)
        : [];
      const loadedReviews = Array.isArray(reviewData.reviews)
        ? reviewData.reviews.filter(isReportReviewRecord)
        : [];

      setReports(loadedReports);
      setReviews(loadedReviews);
      setSelectedReportIds((current) =>
        current.length ? current : loadedReports.slice(0, 5).map((report) => report.id),
      );
      setMessage(
        loadedReports.length
          ? "Saved reports are ready for review."
          : "Save a replay first, then come back to review it.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Review workspace could not load.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void load();
    }, 0);

    return () => window.clearTimeout(initialLoad);
  }, [load]);

  const setCadenceMode = (nextCadence: ReportReviewCadence) => {
    setCadence(nextCadence);

    if (nextCadence === "weekly") {
      const start = weekStartIsoDate();

      setPeriodStart(start);
      setPeriodEnd(todayIsoDate());
      setTitle("Weekly backtest review");
      return;
    }

    const today = todayIsoDate();

    setPeriodStart(today);
    setPeriodEnd(today);
    setTitle("Daily backtest review");
  };

  const toggleReport = (reportId: string) => {
    setSelectedReportIds((current) =>
      current.includes(reportId)
        ? current.filter((id) => id !== reportId)
        : [...current, reportId],
    );
  };

  const saveReview = async () => {
    setBusy(true);
    setMessage("Saving review.");

    try {
      const response = await fetch("/api/report-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          review: {
            cadence,
            periodStart,
            periodEnd,
            title,
            notes,
            reportIds: selectedReportIds,
          },
        }),
      });
      const data = (await response.json()) as ReportReviewPersistenceResult & {
        ok?: boolean;
        message?: string;
      };

      if (!response.ok || data.ok === false) {
        throw new Error(data.message ?? data.persistence?.message ?? "Review save failed.");
      }

      setReviews(data.reviews.filter(isReportReviewRecord));
      setMessage("Review saved.");
      setNotes("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Review save failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
          <div className="flex items-start gap-3">
            <Button asChild variant="outline" size="icon" aria-label="Back to dashboard">
              <Link href="/">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Review workflow</p>
              <h1 className="text-2xl font-semibold tracking-normal sm:text-3xl">
                Scheduled Report Reviews
              </h1>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Badge variant="success">
              <ShieldCheck className="h-3.5 w-3.5" />
              Read-only
            </Badge>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void load()}>
              <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-primary" />
                New Review
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={cadence === "daily" ? "default" : "outline"}
                  onClick={() => setCadenceMode("daily")}
                >
                  Daily
                </Button>
                <Button
                  type="button"
                  variant={cadence === "weekly" ? "default" : "outline"}
                  onClick={() => setCadenceMode("weekly")}
                >
                  Weekly
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="periodStart">Start</Label>
                  <Input
                    id="periodStart"
                    type="date"
                    value={periodStart}
                    onChange={(event) => setPeriodStart(event.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="periodEnd">End</Label>
                  <Input
                    id="periodEnd"
                    type="date"
                    value={periodEnd}
                    onChange={(event) => setPeriodEnd(event.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="reviewTitle">Title</Label>
                <Input
                  id="reviewTitle"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="reviewNotes">Notes</Label>
                <Textarea
                  id="reviewNotes"
                  value={notes}
                  placeholder="What improved, what broke rules, and what should change in the next session?"
                  onChange={(event) => setNotes(event.target.value)}
                />
              </div>

              <Button
                type="button"
                disabled={busy || !title.trim() || !notes.trim()}
                onClick={() => void saveReview()}
              >
                <Save className="h-4 w-4" />
                Save Review
              </Button>
              <p className="text-sm text-muted-foreground">{message}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5 text-accent" />
                Report Comparison
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                <Metric label="Reports" value={String(comparison.runCount)} />
                <Metric label="Trades" value={String(comparison.trades)} />
                <Metric label="Net P&L" value={formatInr(comparison.netPnl)} />
                <Metric label="Avg win" value={`${comparison.averageWinRate}%`} />
                <Metric label="Drawdown" value={formatInr(comparison.maxDrawdown)} />
                <Metric label="Winners" value={String(comparison.winningRuns)} />
              </div>

              <div className="grid gap-2">
                {reports.length ? (
                  reports.map((report) => (
                    <label
                      key={report.id}
                      className="grid cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md border bg-muted/35 px-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selectedReportIds.includes(report.id)}
                        onChange={() => toggleReport(report.id)}
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{report.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {report.underlying} | {report.trades} trades
                        </span>
                      </span>
                      <Badge variant={pnlVariant(report.netPnl)}>
                        {formatInr(report.netPnl)}
                      </Badge>
                    </label>
                  ))
                ) : (
                  <div className="rounded-md border bg-muted/35 px-3 py-4 text-sm text-muted-foreground">
                    No saved backtest reports are available yet.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Saved Reviews</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {reviews.length ? (
              reviews.map((review) => (
                <div
                  key={review.id}
                  className="grid gap-2 rounded-md border bg-muted/35 px-3 py-2 text-sm md:grid-cols-[1fr_auto_auto]"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{review.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(review.periodStart)} to {formatDate(review.periodEnd)}
                    </p>
                    <p className="mt-1 line-clamp-2 text-muted-foreground">{review.notes}</p>
                  </div>
                  <Badge variant="outline">{review.cadence}</Badge>
                  <span className="font-semibold tabular-nums">
                    {formatInr(review.comparison.netPnl)}
                  </span>
                </div>
              ))
            ) : (
              <div className="rounded-md border bg-muted/35 px-3 py-4 text-sm text-muted-foreground">
                No saved reviews yet.
              </div>
            )}
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
