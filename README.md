# GROWW Options Opportunity Scanner

Personal Indian options analysis platform for read-only scanning and paper trading.

The application is designed to favor data quality, strategy discipline, risk control, and repeatability. It should often say `NO TRADE`.

## Phase 6 Status

Implemented through Phase 6:

- Next.js, TypeScript, Tailwind CSS, and shadcn-style UI foundation
- Prisma schema for PostgreSQL
- Server/client configuration boundary
- Simulation-mode dashboard shell
- Daily market plan route
- Provider interfaces for market data and broker boundaries
- Disabled live order execution provider
- Risk and position-sizing utilities
- Zerodha-style instrument dump parser
- Instrument repository with token, symbol, expiry, and ATM option-universe resolution
- Simulated instrument master for NIFTY, BANKNIFTY, and FINNIFTY
- Simulated normalized tick provider
- In-memory market state with duplicate and stale tick protection
- India-session candle builder for 1-minute, 5-minute, and 15-minute candles
- Simulation API endpoint at `/api/simulation/phase2`
- Official Zerodha Kite Connect TypeScript client
- Read-only Kite WebSocket provider
- Stable subscription manager with mode grouping
- Kite tick normalization into the internal `MarketTick` shape
- Live stream service that loads the NSE instrument master and resolves index instruments from metadata
- Start/stop/status API at `/api/kite/stream`
- Dashboard Zerodha stream health card
- Reconnect state tracking and data-quality gating
- Deterministic indicator engine for session VWAP, EMA 9/20/50, ATR 14, RSI 14, rolling volume, and relative volume
- Opening-range tracking for the first 15 one-minute candles
- Previous-day, opening-range, and swing-level support/resistance context
- Phase 4 simulation context attached to the dashboard snapshot
- Simulation API endpoint at `/api/simulation/phase4`
- Dashboard indicator context panel
- Deterministic option-chain context engine
- CE/PE total OI, OI change, volume, and explicit PE/CE OI ratios
- Max OI and max OI-change strike detection
- OI support and resistance levels from nearby put/call walls
- Contract-level liquidity gating using volume, OI, spread, premium, and volume/OI ratio
- Simulation API endpoint at `/api/simulation/phase5`
- Dashboard option-chain context panel and CE/PE tradable status labels
- Deterministic VWAP breakout strategy evaluator
- 100-point setup score using trend, VWAP, breakout, volume, momentum, option-chain, liquidity, and risk/reward components
- Signal lifecycle mapping for forming, confirmed, and invalidated setups
- Hard gates that keep direction as `NO TRADE` until breakout, liquidity, risk/reward, data quality, and regime checks pass
- Simulation API endpoint at `/api/simulation/phase6`
- Dashboard score-component breakdown and watched level/option context
- Tests for simulation labeling, risk sizing, secret boundaries, order blocking, instruments, ticks, state, candles, subscriptions, and Kite provider behavior

Not implemented yet:

- Paper-trade persistence
- Historical backtesting
- AI explanation layer
- Live order placement

## Architecture

```text
Zerodha Kite WebSocket
  -> Tick normalizer
  -> Data quality engine
  -> In-memory market state
  -> Candle builder
  -> Indicator engine
  -> Strategy engine
  -> Risk engine
  -> Alerts and paper trading
```

Phases 1-6 create the shell, provider contracts, live read-only stream, candle pipeline, indicator context, option-chain liquidity context, and deterministic strategy scoring. Paper-trade persistence comes later.

## Technology

- Frontend: Next.js, TypeScript, Tailwind CSS, shadcn-style components
- Backend: Next.js server routes and provider interfaces
- Database: PostgreSQL with Prisma
- Arithmetic: `decimal.js` for risk and money-sensitive calculations
- Timezone: `Asia/Kolkata`

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy environment placeholders:

   ```bash
   cp .env.example .env
   ```

3. Set `DATABASE_URL` for PostgreSQL.

4. Generate Prisma client:

   ```bash
   npm run db:generate
   ```

5. Run the app:

   ```bash
   npm run dev
   ```

## Environment Variables

```env
KITE_API_KEY=
KITE_API_SECRET=
KITE_ACCESS_TOKEN=
DATABASE_URL=
REDIS_URL=
NEXT_PUBLIC_APP_URL=
NEXT_PUBLIC_MARKET_DATA_MODE=
APP_AUTH_SECRET=
```

Only variables prefixed with `NEXT_PUBLIC_` may be exposed to browser code. `KITE_API_SECRET` must remain server-side.

## Zerodha Setup

Zerodha Kite Connect is planned as the primary market-data provider.

To generate the daily access token:

1. Open the Kite login URL from the developer app flow.
2. Copy the short-lived `request_token` from the redirect URL.
3. Run:

   ```bash
   npm run kite:token -- request_token_here
   ```

The helper exchanges the token server-side and saves `KITE_ACCESS_TOKEN` into `.env`. Do not print or commit the access token.

Phase 3 adds:

- KiteTicker WebSocket connection manager
- Stable subscription manager
- Reconnect and re-subscribe flow
- Stale-data protection

REST APIs should be used for instrument metadata, historical candles, initial snapshots, and recovery. Live prices should come from WebSocket ticks.

Start or inspect the local read-only live stream:

```bash
curl http://localhost:3000/api/kite/stream
curl -X POST http://localhost:3000/api/kite/stream -H "Content-Type: application/json" -d "{\"action\":\"start\"}"
curl -X POST http://localhost:3000/api/kite/stream -H "Content-Type: application/json" -d "{\"action\":\"stop\"}"
```

The dashboard also includes a Zerodha stream card. Starting the stream does not enable live orders. Strategy evaluation is deterministic and read-only.

## Indicator Context

Phase 4 adds the deterministic context layer used by future strategy rules:

- Session VWAP, reset per trading session
- EMA 9, EMA 20, and EMA 50 trend structure
- ATR 14 and RSI 14
- Rolling 20-candle average volume and relative volume
- Opening range high/low from the first 15 one-minute candles
- Nearby support and resistance from previous-day levels, opening range, and swing points

The Phase 4 endpoint is read-only:

```bash
curl http://localhost:3000/api/simulation/phase4
```

These values are displayed as context only. They do not create trade signals or live orders.

## Option-Chain Context

Phase 5 adds the deterministic option-chain layer used by future strategy rules:

- Total CE and PE open interest
- Total CE and PE OI change
- Total CE and PE traded volume
- Explicit PE/CE open-interest ratio
- Explicit PE/CE OI-change ratio
- Max CE/PE OI strikes
- Max CE/PE OI-change strikes
- Put-side OI support levels below spot
- Call-side OI resistance levels above spot
- Contract liquidity status based on volume, OI, bid/ask spread, premium range, and volume/OI ratio

The Phase 5 endpoint is read-only:

```bash
curl http://localhost:3000/api/simulation/phase5
```

Liquidity status does not mean take a trade. It only says whether a contract passes basic market-quality checks.

## Strategy Evaluation

Phase 6 adds the first deterministic scanner:

- Strategy: `VWAP + Trend + Breakout + Volume`
- Version: `1.0.0`
- Score range: `0-100`
- Quality bands: `NO SETUP`, `WEAK`, `WATCH`, `STRONG`, `HIGH QUALITY`
- Direction stays `NO TRADE` unless every hard gate passes
- Live orders remain disabled

The Phase 6 endpoint is read-only:

```bash
curl http://localhost:3000/api/simulation/phase6
```

The score is not a probability of profit. It is an explainable checklist score for the configured setup.

## Database

The Prisma schema includes:

- `User`
- `KiteSession`
- `Instrument`
- `TradingSession`
- `MarketCandle`
- `OptionSnapshot`
- `Strategy`
- `StrategyConfiguration`
- `MarketSignal`
- `SignalEvent`
- `PaperTrade`
- `TradeEvent`
- `RiskConfiguration`
- `DailyMarketPlan`
- `DailyPerformance`
- `Backtest`
- `BacktestTrade`

Live ticks are not intended to be stored in PostgreSQL indefinitely. The default persistence layer stores candles, signals, trades, plans, performance, and selected snapshots.

## Simulation Mode

Simulation mode requires no Zerodha credentials and is clearly labelled as `SIMULATION MODE`.

All simulated alerts and paper trades must remain distinct from live market data. The initial dashboard intentionally defaults to `NO TRADE`.

## Live Mode

Live mode will require:

- `KITE_API_KEY`
- `KITE_API_SECRET`
- `KITE_ACCESS_TOKEN`
- `DATABASE_URL`

Live mode must not start signal generation until WebSocket health and data-quality checks pass.

## Testing

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Tests cover:

- Simulation label safety
- Client/server config boundary
- Position sizing and lot rounding
- Daily loss arithmetic
- Disabled live order execution
- Instrument parsing and subscription behavior
- Candle building and market-state freshness checks
- Kite tick normalization and read-only provider behavior
- Phase 4 indicator calculations and simulation context
- Phase 5 option-chain context and liquidity gating
- Phase 6 deterministic strategy scoring and no-trade gates

## Market Hours

The app uses `Asia/Kolkata`. Intraday signal generation must be restricted to configured exchange session windows in later phases.

## Strategy

The first planned strategy is `VWAP + Trend + Breakout + Volume`. The strategy is deterministic, configurable, and not presented as a proven profitable system.

See [STRATEGY.md](./STRATEGY.md).

## Risk Management

The risk engine controls:

- Trading capital
- Risk per trade
- Maximum daily loss
- Maximum number of trades
- Maximum open positions
- Lot-size rounding
- Minimum risk/reward
- No-trade decisions

See [RISK.md](./RISK.md).

## Troubleshooting

- If the app is not clearly labelled as simulation or live, treat the data as invalid.
- If market data is stale, the expected result is `NO SIGNAL`.
- If option spread is too wide, the expected result is `NO TRADE`.
- If daily loss limit is reached, the expected result is no new trade suggestions.
- If `KITE_API_SECRET` appears in browser code, treat it as a security bug.
