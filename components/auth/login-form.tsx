"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const router = useRouter();
  const [accessCode, setAccessCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Private data is protected on this workstation.");

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("Checking access.");

    try {
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode }),
      });
      const data = (await response.json()) as { ok?: boolean; message?: string };

      if (!response.ok || data.ok === false) {
        throw new Error(data.message ?? "Login failed.");
      }

      router.replace("/");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-2">
        <Label htmlFor="accessCode">Owner access code</Label>
        <Input
          id="accessCode"
          autoComplete="current-password"
          type="password"
          value={accessCode}
          onChange={(event) => setAccessCode(event.target.value)}
        />
      </div>
      <Button type="submit" disabled={busy || !accessCode}>
        <LockKeyhole className="h-4 w-4" />
        {busy ? "Checking" : "Unlock"}
      </Button>
      <p className="text-sm text-muted-foreground">{message}</p>
    </form>
  );
}
