import { NextRequest, NextResponse } from "next/server";
import { requireAppUserForApi } from "@/lib/auth/api";
import {
  isReportReviewInput,
  listReportReviews,
  persistReportReview,
} from "@/lib/persistence/report-review-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseLimit(value: string | null) {
  if (!value) return undefined;

  const limit = Number(value);

  return Number.isInteger(limit) && limit > 0 ? limit : undefined;
}

export async function GET(request: NextRequest) {
  const auth = await requireAppUserForApi();

  if (auth.response) return auth.response;

  try {
    const result = await listReportReviews({
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
        message: error instanceof Error ? error.message : "Report reviews failed.",
      },
      review: null,
      reviews: [],
      savedCount: 0,
      liveOrdersEnabled: false,
    });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAppUserForApi();

  if (auth.response) return auth.response;

  try {
    const payload = (await request.json()) as { review?: unknown };

    if (!isReportReviewInput(payload.review)) {
      return NextResponse.json(
        {
          ok: false,
          message: "No valid report review was provided.",
          liveOrdersEnabled: false,
        },
        { status: 400 },
      );
    }

    const result = await persistReportReview({
      input: payload.review,
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        persistence: {
          configured: true,
          status: "error",
          message: error instanceof Error ? error.message : "Report review save failed.",
        },
        review: null,
        reviews: [],
        savedCount: 0,
        liveOrdersEnabled: false,
      },
      { status: 503 },
    );
  }
}
