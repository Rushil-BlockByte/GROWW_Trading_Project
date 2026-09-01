import { NextResponse } from "next/server";
import {
  AUTHENTICATION_REQUIRED_MESSAGE,
  requireAppUser,
} from "@/lib/auth/session";

export async function requireAppUserForApi() {
  try {
    return {
      user: await requireAppUser(),
      response: null,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === AUTHENTICATION_REQUIRED_MESSAGE
    ) {
      return {
        user: null,
        response: NextResponse.json(
          {
            ok: false,
            message: AUTHENTICATION_REQUIRED_MESSAGE,
            liveOrdersEnabled: false,
          },
          { status: 401 },
        ),
      };
    }

    throw error;
  }
}
