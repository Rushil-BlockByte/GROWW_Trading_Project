import { describe, expect, it } from "vitest";
import {
  createSignedSessionValue,
  verifyOwnerAccessCode,
  verifySignedSessionValue,
} from "../lib/auth/session";

describe("owner authentication sessions", () => {
  it("accepts valid signed owner sessions", () => {
    const value = createSignedSessionValue(
      {
        sub: "authenticated-owner",
        displayName: "Owner",
        role: "owner",
        issuedAt: 1_000,
        expiresAt: 10_000,
      },
      "secret",
    );

    expect(verifySignedSessionValue(value, "secret", 2_000)).toEqual({
      id: "authenticated-owner",
      displayName: "Owner",
      role: "owner",
    });
  });

  it("rejects tampered or expired owner sessions", () => {
    const value = createSignedSessionValue(
      {
        sub: "authenticated-owner",
        displayName: "Owner",
        role: "owner",
        issuedAt: 1_000,
        expiresAt: 10_000,
      },
      "secret",
    );

    expect(verifySignedSessionValue(`${value}x`, "secret", 2_000)).toBeNull();
    expect(verifySignedSessionValue(value, "secret", 12_000)).toBeNull();
    expect(verifySignedSessionValue(value, "wrong-secret", 2_000)).toBeNull();
  });

  it("compares owner access codes without exposing them to client config", () => {
    expect(verifyOwnerAccessCode("code-123", "code-123")).toBe(true);
    expect(verifyOwnerAccessCode("code-123", "code-456")).toBe(false);
    expect(verifyOwnerAccessCode("", "code-456")).toBe(false);
  });
});
