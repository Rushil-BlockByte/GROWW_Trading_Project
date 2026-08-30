import { describe, expect, it } from "vitest";
import { CandleBuilder } from "../lib/market/candle-builder";
import { floorToKolkataIntervalStart, isInsideKolkataSession } from "../lib/market/session";
import { normalizeSimulatedTick } from "../lib/market/tick-normalization";

describe("candle builder", () => {
  it("aligns candles to the India market session open", () => {
    const start = floorToKolkataIntervalStart(new Date("2026-09-01T03:46:30.000Z"), 5);

    expect(start?.toISOString()).toBe("2026-09-01T03:45:00.000Z");
    expect(isInsideKolkataSession(new Date("2026-09-01T03:40:00.000Z"))).toBe(false);
  });

  it("builds active and completed candles from ticks", () => {
    const builder = new CandleBuilder(["1m"]);
    const tickOne = normalizeSimulatedTick({
      instrumentToken: 256265,
      timestamp: new Date("2026-09-01T03:45:10.000Z"),
      lastPrice: "100",
      lastQuantity: 10,
    });
    const tickTwo = normalizeSimulatedTick({
      instrumentToken: 256265,
      timestamp: new Date("2026-09-01T03:45:40.000Z"),
      lastPrice: "105",
      lastQuantity: 5,
    });
    const tickThree = normalizeSimulatedTick({
      instrumentToken: 256265,
      timestamp: new Date("2026-09-01T03:46:01.000Z"),
      lastPrice: "103",
      lastQuantity: 7,
    });

    builder.applyTick(tickOne);
    const update = builder.applyTick(tickTwo);
    const rollover = builder.applyTick(tickThree);

    expect(update.updated[0]).toMatchObject({
      open: "100.00",
      high: "105.00",
      low: "100.00",
      close: "105.00",
      volume: 15,
      tickCount: 2,
    });
    expect(rollover.completed[0]).toMatchObject({
      startTime: "2026-09-01T03:45:00.000Z",
      isComplete: true,
    });
    expect(builder.getActiveCandles()[0]).toMatchObject({
      startTime: "2026-09-01T03:46:00.000Z",
      close: "103.00",
    });
  });

  it("does not create candles outside market hours", () => {
    const builder = new CandleBuilder(["1m"]);
    const result = builder.applyTick(
      normalizeSimulatedTick({
        instrumentToken: 256265,
        timestamp: new Date("2026-09-01T03:40:00.000Z"),
        lastPrice: "100",
      }),
    );

    expect(result).toEqual({
      updated: [],
      completed: [],
      ignoredReason: "Outside market session.",
    });
  });
});
