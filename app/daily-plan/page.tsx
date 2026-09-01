import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, CalendarDays, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { getOptionalAppUser } from "@/lib/auth/session";
import { DEFAULT_UNDERLYINGS } from "@/lib/config/market";

export default async function DailyPlanPage() {
  const user = await getOptionalAppUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
          <div className="flex items-center gap-3">
            <Button asChild variant="outline" size="icon" aria-label="Back to dashboard">
              <Link href="/">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Pre-market workflow</p>
              <h1 className="text-2xl font-semibold tracking-normal">Daily Market Plan</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-medium text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Paper trading only
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-accent" />
                Session Thesis
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="bias">Market bias</Label>
                <Input id="bias" placeholder="Example: Bullish above 25,100; neutral below VWAP" />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="support">Potential support</Label>
                  <Input id="support" placeholder="Levels from previous day, OR, swings" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="resistance">Potential resistance</Label>
                  <Input id="resistance" placeholder="Levels to watch for breakout or rejection" />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="bullish">Bullish scenario</Label>
                <Textarea id="bullish" placeholder="What must happen before a long setup is valid?" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="bearish">Bearish scenario</Label>
                <Textarea id="bearish" placeholder="What must happen before a short setup is valid?" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="invalidation">Invalidation</Label>
                <Textarea id="invalidation" placeholder="What market behavior proves the plan wrong?" />
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Tracked Underlyings</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                {DEFAULT_UNDERLYINGS.map((underlying) => (
                  <div
                    key={underlying.symbol}
                    className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2"
                  >
                    <div>
                      <p className="font-semibold">{underlying.label}</p>
                      <p className="text-xs text-muted-foreground">
                        ATM ± {underlying.atmStrikeWindow} strikes
                      </p>
                    </div>
                    <span className="text-sm font-medium text-muted-foreground">
                      {underlying.strikeInterval} pt interval
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Events And Notes</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                <Textarea placeholder="Important events, expiry risk, personal focus, rules to obey." />
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </main>
  );
}
