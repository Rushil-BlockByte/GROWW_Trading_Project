import { describe, expect, it } from "vitest";
import { buildDailyIndexJournal } from "../lib/market-journal/daily-index-journal";
import { createInitialMarketSnapshot } from "../lib/simulation/market-snapshot";

describe("daily index journal", () => {
  it("summarizes all tracked indices with next-day preparation notes", () => {
    const journal = buildDailyIndexJournal(createInitialMarketSnapshot());

    expect(journal.indexSummaries.map((summary) => summary.symbol)).toEqual([
      "NIFTY",
      "BANKNIFTY",
      "FINNIFTY",
    ]);
    expect(journal.whatHappened.join(" ")).toContain("Scanner state");
    expect(journal.nextDayPrep.join(" ")).toContain("12-20 option points");
    expect(journal.executionFocus.join(" ")).toContain("Paper-only");
    expect(journal.markdown).toContain("## Next-day prep");
  });
});
