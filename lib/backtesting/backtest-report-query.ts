import type {
  BacktestReportFilters,
  BacktestReportKind,
  BacktestReportResultFilter,
} from "@/types/backtest-report";

export function parseBacktestReportLimit(value: string | null) {
  if (!value) return undefined;

  const limit = Number(value);

  return Number.isInteger(limit) && limit > 0 ? limit : undefined;
}

export function parseBacktestReportUnderlying(value: string | null): BacktestReportFilters["underlying"] {
  if (value === "NIFTY" || value === "BANKNIFTY" || value === "FINNIFTY") {
    return value;
  }

  return value === "ALL" ? "ALL" : undefined;
}

export function parseBacktestReportKind(value: string | null): BacktestReportKind | "all" | undefined {
  if (value === "single_day" || value === "multi_day" || value === "all") {
    return value;
  }

  return undefined;
}

export function parseBacktestReportResult(value: string | null): BacktestReportResultFilter | undefined {
  if (
    value === "all" ||
    value === "profitable" ||
    value === "losing" ||
    value === "flat"
  ) {
    return value;
  }

  return undefined;
}

export function parseBacktestReportFilters(searchParams: URLSearchParams): BacktestReportFilters {
  return {
    underlying: parseBacktestReportUnderlying(searchParams.get("underlying")),
    kind: parseBacktestReportKind(searchParams.get("kind")),
    result: parseBacktestReportResult(searchParams.get("result")),
  };
}

export function backtestReportQueryString({
  filters,
  limit,
}: {
  filters?: BacktestReportFilters;
  limit?: number;
} = {}) {
  const searchParams = new URLSearchParams();

  if (filters?.underlying && filters.underlying !== "ALL") {
    searchParams.set("underlying", filters.underlying);
  }

  if (filters?.kind && filters.kind !== "all") {
    searchParams.set("kind", filters.kind);
  }

  if (filters?.result && filters.result !== "all") {
    searchParams.set("result", filters.result);
  }

  if (limit) {
    searchParams.set("limit", String(limit));
  }

  return searchParams.toString();
}
