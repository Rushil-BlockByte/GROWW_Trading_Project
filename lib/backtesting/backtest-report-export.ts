import type { BacktestReportRecord } from "@/types/backtest-report";

const BACKTEST_REPORT_CSV_COLUMNS: Array<{
  header: string;
  value: (record: BacktestReportRecord) => string | number | boolean | null;
}> = [
  { header: "Run ID", value: (record) => record.id },
  { header: "Name", value: (record) => record.name },
  { header: "Status", value: (record) => record.status },
  { header: "Type", value: (record) => record.kind },
  { header: "Underlying", value: (record) => record.underlying },
  { header: "Data Source", value: (record) => record.dataSource },
  { header: "Started At", value: (record) => record.startedAt },
  { header: "Ended At", value: (record) => record.endedAt },
  { header: "Trades", value: (record) => record.trades },
  { header: "Net P&L", value: (record) => record.netPnl },
  { header: "Win Rate %", value: (record) => record.winRate },
  { header: "Max Drawdown", value: (record) => record.maxDrawdown },
  { header: "Saved At", value: (record) => record.savedAt },
  { header: "Live Orders Enabled", value: (record) => record.liveOrdersEnabled },
];

function csvValue(value: string | number | boolean | null) {
  if (value === null) return "";

  const text = String(value);

  if (!/[",\r\n]/.test(text)) return text;

  return `"${text.replaceAll('"', '""')}"`;
}

export function backtestReportRecordsToCsv(records: BacktestReportRecord[]) {
  const header = BACKTEST_REPORT_CSV_COLUMNS.map((column) => csvValue(column.header)).join(",");
  const rows = records.map((record) =>
    BACKTEST_REPORT_CSV_COLUMNS.map((column) => csvValue(column.value(record))).join(","),
  );

  return [header, ...rows].join("\r\n");
}

export function backtestReportCsvFilename(now = new Date()) {
  const stamp = now.toISOString().slice(0, 10);

  return `groww-backtest-report-${stamp}.csv`;
}
