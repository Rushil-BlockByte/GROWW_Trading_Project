import { NextRequest, NextResponse } from "next/server";
import { requireAppUserForApi } from "@/lib/auth/api";
import { calculatePaperJournalSummary, isPaperJournalEntry } from "@/lib/paper-trading/journal";
import {
  listPaperJournalEntries,
  persistPaperJournalEntries,
} from "@/lib/persistence/paper-journal-store";
import type { PaperJournalEntry } from "@/types/paper-trading";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseLimit(value: string | null) {
  if (!value) return undefined;

  const limit = Number(value);

  return Number.isInteger(limit) && limit > 0 ? limit : undefined;
}

function entriesFromPayload(payload: unknown): PaperJournalEntry[] {
  if (!payload || typeof payload !== "object") return [];

  const body = payload as { entry?: unknown; entries?: unknown };
  const rawEntries = Array.isArray(body.entries)
    ? body.entries
    : body.entry
      ? [body.entry]
      : [];

  return rawEntries.filter(isPaperJournalEntry);
}

export async function GET(request: NextRequest) {
  const auth = await requireAppUserForApi();

  if (auth.response) return auth.response;

  try {
    const result = await listPaperJournalEntries({
      limit: parseLimit(request.nextUrl.searchParams.get("limit")),
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    return NextResponse.json({
      ok: true,
      persistence: {
        configured: true,
        status: "error",
        message: error instanceof Error ? error.message : "Paper journal load failed.",
      },
      entries: [],
      summary: calculatePaperJournalSummary([]),
      savedCount: 0,
      liveOrdersEnabled: false,
    });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAppUserForApi();

  if (auth.response) return auth.response;

  let entries: PaperJournalEntry[] = [];

  try {
    entries = entriesFromPayload(await request.json());

    if (!entries.length) {
      return NextResponse.json(
        {
          ok: false,
          message: "No valid paper journal entries were provided.",
          liveOrdersEnabled: false,
        },
        { status: 400 },
      );
    }

    const result = await persistPaperJournalEntries({
      entries,
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    return NextResponse.json({
      ok: true,
      persistence: {
        configured: true,
        status: "error",
        message: error instanceof Error ? error.message : "Paper journal save failed.",
      },
      entries,
      summary: calculatePaperJournalSummary(entries),
      savedCount: 0,
      liveOrdersEnabled: false,
    });
  }
}
