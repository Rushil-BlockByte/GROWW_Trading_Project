import { describe, expect, it } from "vitest";
import { InstrumentRepository } from "../lib/instruments/instrument-repository";
import { parseZerodhaInstrumentDump } from "../lib/instruments/instrument-master";
import { createSimulatedInstrumentMaster } from "../lib/instruments/simulated-instruments";

const SAMPLE_DUMP = `instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange
256265,1001,NIFTY,NIFTY 50,0,,0,0.05,0,EQ,NSE-INDICES,NSE
100001,2001,NIFTY26SEP25150CE,NIFTY,0,2026-09-03,25150,0.05,75,CE,NFO-OPT,NFO
100002,2002,NIFTY26SEP25150PE,NIFTY,0,2026-09-03,25150,0.05,75,PE,NFO-OPT,NFO
100003,2003,NIFTY26SEP25200CE,NIFTY,0,2026-09-03,25200,0.05,75,CE,NFO-OPT,NFO
100004,2004,NIFTY26SEP25200PE,NIFTY,0,2026-09-03,25200,0.05,75,PE,NFO-OPT,NFO
100005,2005,NIFTY26SEP25250CE,NIFTY,0,2026-09-03,25250,0.05,75,CE,NFO-OPT,NFO
100006,2006,NIFTY26SEP25250PE,NIFTY,0,2026-09-03,25250,0.05,75,PE,NFO-OPT,NFO`;

describe("instrument master", () => {
  it("parses Zerodha-style instrument dump rows into normalized records", () => {
    const instruments = parseZerodhaInstrumentDump(SAMPLE_DUMP);
    const repository = new InstrumentRepository(instruments);

    expect(repository.findByToken(256265)?.kind).toBe("INDEX");
    expect(repository.findByToken(100001)?.kind).toBe("OPTION_CE");
    expect(repository.findByTradingsymbol("NFO", "NIFTY26SEP25200PE")?.instrumentType).toBe("PE");
  });

  it("resolves an ATM-centered option universe from metadata", () => {
    const instruments = parseZerodhaInstrumentDump(SAMPLE_DUMP);
    const repository = new InstrumentRepository(instruments);
    const universe = repository.buildAtmOptionUniverse({
      underlyingSymbol: "NIFTY",
      underlyingLastPrice: "25182",
      expiry: "2026-09-03",
      strikeInterval: 50,
      strikeWindow: 1,
    });

    expect(universe.atmStrike).toBe("25200");
    expect(universe.instruments).toHaveLength(6);
    expect(universe.missingContracts).toHaveLength(0);
  });

  it("keeps the simulated seed universe configurable around ATM", () => {
    const repository = new InstrumentRepository(createSimulatedInstrumentMaster());
    const expiry = repository.getNearestExpiry("NIFTY", new Date("2026-09-01T03:45:00.000Z"));
    const universe = repository.buildAtmOptionUniverse({
      underlyingSymbol: "NIFTY",
      underlyingLastPrice: "25180",
      expiry: expiry ?? "",
      strikeInterval: 50,
      strikeWindow: 10,
    });

    expect(expiry).toBe("2026-09-03");
    expect(universe.instruments).toHaveLength(42);
    expect(universe.missingContracts).toHaveLength(0);
  });
});
