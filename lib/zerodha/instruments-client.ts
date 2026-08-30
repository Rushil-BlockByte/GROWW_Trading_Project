import { parseZerodhaInstrumentDump } from "@/lib/instruments/instrument-master";
import type { InstrumentRecord } from "@/types/instruments";

export type KiteInstrumentDownloadOptions = {
  apiKey: string;
  accessToken: string;
  exchange?: string;
};

export async function downloadKiteInstruments(
  options: KiteInstrumentDownloadOptions,
): Promise<InstrumentRecord[]> {
  const exchangePath = options.exchange ? `/${encodeURIComponent(options.exchange)}` : "";
  const response = await fetch(`https://api.kite.trade/instruments${exchangePath}`, {
    headers: {
      Authorization: `token ${options.apiKey}:${options.accessToken}`,
      "X-Kite-Version": "3",
    },
  });

  if (!response.ok) {
    throw new Error(`Instrument master download failed with ${response.status}.`);
  }

  return parseZerodhaInstrumentDump(await response.text());
}
