import { redirect } from "next/navigation";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { LoginForm } from "@/components/auth/login-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getOptionalAppUser, isAuthenticationRequired } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getOptionalAppUser();

  if (user) {
    redirect("/");
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-6">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <CardTitle className="flex items-center gap-2">
                <LockKeyhole className="h-5 w-5 text-primary" />
                Owner Login
              </CardTitle>
              <Badge variant={isAuthenticationRequired() ? "warning" : "muted"}>
                {isAuthenticationRequired() ? "Required" : "Optional"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex items-start gap-3 rounded-md border bg-muted/35 p-3 text-sm">
              <ShieldCheck className="mt-0.5 h-5 w-5 text-accent" />
              <p className="text-muted-foreground">
                Login protects saved reports, reviews, and stream controls when auth is configured.
              </p>
            </div>
            <LoginForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
