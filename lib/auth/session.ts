import { cookies } from "next/headers";
import crypto from "node:crypto";
import { getServerConfig } from "@/lib/config/env";

export type AppUser = {
  id: string;
  displayName: string;
  role: "owner";
};

const SESSION_COOKIE = "groww_scanner_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const AUTHENTICATION_REQUIRED_MESSAGE = "Authentication required.";

type SessionPayload = {
  sub: string;
  displayName: string;
  role: "owner";
  issuedAt: number;
  expiresAt: number;
};

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function isAuthenticationRequired() {
  const config = getServerConfig();

  return config.marketDataMode === "live" || Boolean(config.appAuthSecret);
}

export function createSignedSessionValue(payload: SessionPayload, secret: string) {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload, secret);

  return `${encodedPayload}.${signature}`;
}

export function verifySignedSessionValue(
  value: string | undefined,
  secret: string | undefined,
  now = Date.now(),
): AppUser | null {
  if (!value || !secret) return null;

  const [encodedPayload, signature] = value.split(".");

  if (!encodedPayload || !signature || !safeEqual(signature, sign(encodedPayload, secret))) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as Partial<SessionPayload>;

    if (
      payload.sub !== "authenticated-owner" ||
      payload.role !== "owner" ||
      typeof payload.displayName !== "string" ||
      typeof payload.expiresAt !== "number" ||
      payload.expiresAt <= now
    ) {
      return null;
    }

    return {
      id: payload.sub,
      displayName: payload.displayName,
      role: "owner",
    };
  } catch {
    return null;
  }
}

export function verifyOwnerAccessCode(candidate: string, expected: string | undefined) {
  if (!candidate || !expected) return false;

  return safeEqual(candidate, expected);
}

export async function getOptionalAppUser(): Promise<AppUser | null> {
  const config = getServerConfig();

  if (!isAuthenticationRequired()) {
    return {
      id: "simulation-owner",
      displayName: "Simulation Owner",
      role: "owner",
    };
  }

  const cookieStore = await cookies();
  const sessionValue = cookieStore.get(SESSION_COOKIE)?.value;

  return verifySignedSessionValue(sessionValue, config.appAuthSecret);
}

export async function requireAppUser(): Promise<AppUser> {
  const user = await getOptionalAppUser();

  if (!user) {
    throw new Error(AUTHENTICATION_REQUIRED_MESSAGE);
  }

  return user;
}

export async function createOwnerSession(accessCode: string) {
  const config = getServerConfig();
  const expectedAccessCode = config.appOwnerAccessCode ?? config.appAuthSecret;

  if (!config.appAuthSecret || !verifyOwnerAccessCode(accessCode, expectedAccessCode)) {
    return null;
  }

  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  const user: AppUser = {
    id: "authenticated-owner",
    displayName: "Owner",
    role: "owner",
  };
  const cookieStore = await cookies();

  cookieStore.set(
    SESSION_COOKIE,
    createSignedSessionValue(
      {
        sub: user.id,
        displayName: user.displayName,
        role: user.role,
        issuedAt: now,
        expiresAt,
      },
      config.appAuthSecret,
    ),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: new Date(expiresAt),
    },
  );

  return user;
}

export async function clearOwnerSession() {
  const cookieStore = await cookies();

  cookieStore.delete(SESSION_COOKIE);
}
