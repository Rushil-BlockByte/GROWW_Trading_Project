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
  indicatorInstruments: Partial<Record<UnderlyingSymbol, InstrumentRecord>>;
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
  const indicatorInstruments: Partial<Record<UnderlyingSymbol, InstrumentRecord>> = {};
  const unresolved = new Set<UnderlyingSymbol>();

  for (const symbol of symbols) {
    const indexInstrument = resolveIndexInstrument(repository, symbol);
    const futureInstrument = repository.getNearestFuture(symbol);

    if (indexInstrument) {
      instruments.push(indexInstrument);
    } else {
      unresolved.add(symbol);
    }

    if (futureInstrument) {
      instruments.push(futureInstrument);
      indicatorInstruments[symbol] = futureInstrument;
    } else if (indexInstrument) {
      indicatorInstruments[symbol] = indexInstrument;
      unresolved.add(symbol);
    }
  }

  const dedupedInstruments = dedupeInstruments(instruments);
  const subscriptions = dedupedInstruments.map((instrument) => {
    const config = DEFAULT_UNDERLYINGS.find(
      (underlying) => underlying.symbol === instrument.underlyingSymbol,
    );

    return {
      instrumentToken: instrument.instrumentToken,
      mode: instrument.kind === "FUTURE" ? "FULL" : config?.underlyingMode ?? "QUOTE",
    };
  });

  return {
    subscriptions,
    instruments: dedupedInstruments,
    indicatorInstruments,
    unresolved: Array.from(unresolved),
  };
}

function dedupeInstruments(instruments: InstrumentRecord[]) {
  return Array.from(
    new Map(instruments.map((instrument) => [instrument.instrumentToken, instrument])).values(),
  );
}
