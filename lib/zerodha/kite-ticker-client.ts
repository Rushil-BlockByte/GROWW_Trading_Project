import { KiteTicker } from "kiteconnect";
import type { ZerodhaCredentials, ZerodhaTickerClient } from "@/types/kite";

export function createOfficialKiteTickerClient(
  credentials: ZerodhaCredentials,
): ZerodhaTickerClient {
  return new KiteTicker({
    api_key: credentials.apiKey,
    access_token: credentials.accessToken,
    reconnect: false,
  }) as ZerodhaTickerClient;
}
