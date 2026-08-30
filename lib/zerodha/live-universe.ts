import { DEFAULT_UNDERLYINGS } from "@/lib/config/market";
import type { InstrumentRepository } from "@/lib/instruments/instrument-repository";
import type { InstrumentSubscription } from "@/lib/providers/market-data-provider";
import type { InstrumentRecord } from "@/types/instruments";
import type { UnderlyingSymbol } from "@/types/market";

const INDEX_NAME_MATCHERS: Record<UnderlyingSymbol, RegExp[]> = {
  NIFTY: [/^NIFTY 50$/, /^NIFTY$/],
  BANKNIFTY: [/^NIFTY BANK$/, /^BANKNIFTY$/],
  FINNIFTY: [/^NIFTY FIN SERVICE$/, /^FINNIFTY$/, /^NIFTY FINANCIAL SERVICES$/],
};

export type ResolvedLiveUniverse = {
  subscriptions: InstrumentSubscription[];
  instruments: InstrumentRecord[];
  unresolved: UnderlyingSymbol[];
};

export function resolveIndexInstrument(
  repository: InstrumentRepository,
  symbol: UnderlyingSymbol,
) {
  const matchers = INDEX_NAME_MATCHERS[symbol];

  return repository
    .getAll()
    .find((instrument) => {
      if (instrument.kind !== "INDEX") return false;
      const tradingsymbol = instrument.tradingsymbol.toUpperCase();
      const name = instrument.name?.toUpperCase() ?? "";

      return matchers.some((matcher) => matcher.test(tradingsymbol) || matcher.test(name));
    });
}

export function resolveInitialLiveUniverse(
  repository: InstrumentRepository,
  symbols: UnderlyingSymbol[] = ["NIFTY", "BANKNIFTY", "FINNIFTY"],
): ResolvedLiveUniverse {
  const instruments: InstrumentRecord[] = [];
  const unresolved: UnderlyingSymbol[] = [];

  for (const symbol of symbols) {
    const instrument = resolveIndexInstrument(repository, symbol);

    if (instrument) {
      instruments.push(instrument);
    } else {
      unresolved.push(symbol);
    }
  }

  const subscriptions = instruments.map((instrument) => {
    const config = DEFAULT_UNDERLYINGS.find(
      (underlying) => underlying.symbol === instrument.underlyingSymbol,
    );

    return {
      instrumentToken: instrument.instrumentToken,
      mode: config?.underlyingMode ?? "QUOTE",
    };
  });

  return {
    subscriptions,
    instruments,
    unresolved,
  };
}
