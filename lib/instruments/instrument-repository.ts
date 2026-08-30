import Decimal from "decimal.js";
import type {
  InstrumentRecord,
  InstrumentSearchCriteria,
  OptionUniverseRequest,
  OptionUniverseResult,
} from "@/types/instruments";
import type { UnderlyingSymbol } from "@/types/market";

export class InstrumentRepository {
  private readonly instrumentsByToken = new Map<number, InstrumentRecord>();
  private readonly instrumentsBySymbol = new Map<string, InstrumentRecord>();

  constructor(instruments: InstrumentRecord[]) {
    for (const instrument of instruments) {
      this.instrumentsByToken.set(instrument.instrumentToken, instrument);
      this.instrumentsBySymbol.set(this.symbolKey(instrument.exchange, instrument.tradingsymbol), instrument);
    }
  }

  getAll() {
    return Array.from(this.instrumentsByToken.values());
  }

  findByToken(instrumentToken: number) {
    return this.instrumentsByToken.get(instrumentToken);
  }

  findByTradingsymbol(exchange: string, tradingsymbol: string) {
    return this.instrumentsBySymbol.get(this.symbolKey(exchange, tradingsymbol));
  }

  search(criteria: InstrumentSearchCriteria) {
    return this.getAll().filter((instrument) => {
      if (criteria.exchange && instrument.exchange !== criteria.exchange) return false;
      if (criteria.tradingsymbol && instrument.tradingsymbol !== criteria.tradingsymbol) return false;
      if (
        criteria.instrumentToken !== undefined &&
        instrument.instrumentToken !== criteria.instrumentToken
      ) {
        return false;
      }
      if (criteria.expiry && instrument.expiry !== criteria.expiry) return false;
      if (criteria.strike && instrument.strike !== new Decimal(criteria.strike).toString()) return false;
      if (criteria.instrumentType && instrument.instrumentType !== criteria.instrumentType) return false;
      if (
        criteria.underlyingSymbol &&
        instrument.underlyingSymbol !== criteria.underlyingSymbol
      ) {
        return false;
      }

      return true;
    });
  }

  getExpiries(underlyingSymbol: UnderlyingSymbol, asOf = new Date()) {
    const sessionDate = asOf.toISOString().slice(0, 10);
    const expiries = new Set<string>();

    for (const instrument of this.getAll()) {
      if (
        instrument.underlyingSymbol === underlyingSymbol &&
        (instrument.kind === "OPTION_CE" || instrument.kind === "OPTION_PE") &&
        instrument.expiry &&
        instrument.expiry >= sessionDate
      ) {
        expiries.add(instrument.expiry);
      }
    }

    return Array.from(expiries).sort();
  }

  getNearestExpiry(underlyingSymbol: UnderlyingSymbol, asOf = new Date()) {
    return this.getExpiries(underlyingSymbol, asOf)[0];
  }

  buildAtmOptionUniverse(request: OptionUniverseRequest): OptionUniverseResult {
    const atmStrike = new Decimal(request.underlyingLastPrice)
      .div(request.strikeInterval)
      .toNearest(1)
      .mul(request.strikeInterval);
    const types = request.includeTypes ?? ["CE", "PE"];
    const instruments: InstrumentRecord[] = [];
    const missingContracts: OptionUniverseResult["missingContracts"] = [];

    for (let offset = -request.strikeWindow; offset <= request.strikeWindow; offset += 1) {
      const strike = atmStrike.plus(offset * request.strikeInterval).toString();

      for (const instrumentType of types) {
        const contract = this.search({
          underlyingSymbol: request.underlyingSymbol,
          expiry: request.expiry,
          strike,
          instrumentType,
        })[0];

        if (contract) {
          instruments.push(contract);
        } else {
          missingContracts.push({ strike, instrumentType });
        }
      }
    }

    return {
      atmStrike: atmStrike.toString(),
      expiry: request.expiry,
      instruments,
      missingContracts,
    };
  }

  private symbolKey(exchange: string, tradingsymbol: string) {
    return `${exchange}:${tradingsymbol}`.toUpperCase();
  }
}
