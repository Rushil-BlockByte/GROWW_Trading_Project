import { NextResponse } from "next/server";
import {
  clearOwnerSession,
  createOwnerSession,
  getOptionalAppUser,
  isAuthenticationRequired,
} from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getOptionalAppUser();

  return NextResponse.json({
    ok: true,
    authenticated: Boolean(user),
    required: isAuthenticationRequired(),
    user,
    liveOrdersEnabled: false,
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { accessCode?: string };
  const user = await createOwnerSession(body.accessCode ?? "");

  if (!user) {
    return NextResponse.json(
      {
        ok: false,
        authenticated: false,
        required: isAuthenticationRequired(),
        message: "Owner access code was not accepted.",
        liveOrdersEnabled: false,
      },
      { status: 401 },
    );
  }

  return NextResponse.json({
    ok: true,
    authenticated: true,
    required: true,
    user,
    liveOrdersEnabled: false,
  });
}

export async function DELETE() {
  await clearOwnerSession();

  return NextResponse.json({
    ok: true,
    authenticated: false,
    required: isAuthenticationRequired(),
    liveOrdersEnabled: false,
  });
}
