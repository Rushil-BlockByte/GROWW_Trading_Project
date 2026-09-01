# GROWW Options Opportunity Scanner

Personal Indian options analysis platform for read-only scanning and paper trading.

The application is designed to favor data quality, strategy discipline, risk control, and repeatability. It should often say `NO TRADE`.

## Phase 18 Status

Implemented through Phase 18:

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
- Local browser paper-trade journal persistence
- Save-anytime observation notes tied to the current scanner snapshot
- Guarded paper-trade capture from confirmed strategy setups only
- Paper-trade summary metrics for open trades, notes, rule violations, and P&L
- Deterministic VWAP breakout backtest replay engine
- Next-candle entry simulation with stop/target/session-close exits
- Slippage, brokerage, lot-size, and position-sizing assumptions in replay results
- Simulation API endpoint at `/api/simulation/phase8`
- Dashboard backtest replay summary with net P&L, win rate, costs, and drawdown
- Server-side Kite historical candle adapter
- Read-only historical candle endpoint at `/api/kite/historical`
- Multi-day VWAP breakout replay aggregation
- Simulation API endpoint at `/api/simulation/phase9`
- Dashboard multi-day replay summary with per-session results
- Server-side Kite option historical candle ingestion for ATM CE/PE bands
- Real option-history replay rows with explicit bid/ask spread assumptions
- Simulation API endpoint at `/api/simulation/phase10`
- Dashboard option-history readiness card
- Optional PostgreSQL-backed paper journal persistence
- Optional PostgreSQL-backed backtest run and trade persistence
- Journal sync API endpoint at `/api/paper-journal`
- Backtest save/list API endpoint at `/api/backtests`
- Dashboard journal sync status and replay save controls
- Simulation API endpoint at `/api/simulation/phase11`
- Read-only backtest report summaries with run-type, underlying, and result filters
- Dashboard backtest reports panel with best/worst run comparison and database fallback
- Simulation API endpoint at `/api/simulation/phase12`
- CSV export API endpoint at `/api/backtests/export`
- Dashboard CSV export for filtered backtest report rows
- Simulation API endpoint at `/api/simulation/phase13`
- Read-only saved report detail pages at `/backtests/[id]`
- Saved report detail API endpoint at `/api/backtests/[id]`
- Dashboard link actions for database-backed report rows
- Simulation API endpoint at `/api/simulation/phase14`
- Daily and weekly report review workflow at `/reviews`
- Report review save/list API endpoint at `/api/report-reviews`
- PostgreSQL `ReportReview` persistence with comparison snapshots
- Simulation API endpoint at `/api/simulation/phase15`
- Owner login route at `/login`
- Signed owner session API endpoint at `/api/auth/session`
- Private route and API boundaries for saved reports, reviews, paper journal, Kite historical data, token callback, and stream controls
- Simulation API endpoint at `/api/simulation/phase16`
- Deterministic plain-English scanner and backtest report explanations
- Simulation API endpoint at `/api/simulation/phase17`
- Live-stream safety checks for credentials, Indian market hours, WebSocket state, instrument readiness, underlying resolution, tick freshness, and disabled live orders
- Market-hours gate before starting the Kite WebSocket stream
- Dashboard stream hardening panel with start gate, tick age, and safety-check status
- Simulation API endpoint at `/api/simulation/phase18`
- Tests for simulation labeling, risk sizing, secret boundaries, order blocking, instruments, ticks, state, candles, subscriptions, Kite provider behavior, strategy scoring, paper-journal behavior, persistence mapping, backtest replay behavior, backtest reporting, Kite historical normalization, and Kite option-history replay rows

Not implemented yet:

- External OAuth or hosted multi-user authentication
- Production alerting and backups
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

Phases 1-18 create the shell, provider contracts, live read-only stream, candle pipeline, indicator context, option-chain liquidity context, deterministic strategy scoring, a local paper-trade journal, simulated historical replay, Kite historical candle ingestion, multi-day replay aggregation, real option historical candle ingestion for backtests, optional PostgreSQL persistence for journal entries and replay runs, read-only backtest reports, CSV report export, saved report detail links, report reviews, local owner authentication, deterministic explanations, and live-mode safety gates. Live order placement remains intentionally disabled.

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

   For a local Windows app talking to PostgreSQL in Ubuntu WSL, keep the host as
   `127.0.0.1`, use a generated password, and disable SSL for the local bridge:

   ```env
   DATABASE_URL="postgresql://postgres:CHANGE_ME@127.0.0.1:5432/groww_options_scanner?schema=public&sslmode=disable"
   ```

4. If PostgreSQL is running inside Ubuntu WSL and Windows cannot reach it directly,
   start the local proxy in a separate terminal:

   ```bash
   npm run db:proxy
   ```

5. Apply database migrations:

   ```bash
   npm run db:migrate
   ```

6. Generate Prisma client:

   ```bash
   npm run db:generate
   ```

7. Run the app:

   ```bash
   npm run dev
   ```

## Environment Variables

```env
KITE_API_KEY=
KITE_API_SECRET=
KITE_ACCESS_TOKEN=
DATABASE_URL=
DATABASE_PERSISTENCE_USER_EMAIL=
REDIS_URL=
NEXT_PUBLIC_APP_URL=
NEXT_PUBLIC_MARKET_DATA_MODE=
APP_AUTH_SECRET=
APP_OWNER_ACCESS_CODE=
```

Only variables prefixed with `NEXT_PUBLIC_` may be exposed to browser code. `KITE_API_SECRET` must remain server-side.
When `APP_AUTH_SECRET` is set or live mode is enabled, private pages and APIs require an owner session. `APP_OWNER_ACCESS_CODE` is the local login code; if it is omitted, `APP_AUTH_SECRET` is used as the owner code.

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

Fetch read-only Kite historical candles:

```bash
curl "http://localhost:3000/api/kite/historical?underlying=NIFTY&date=2026-08-31&interval=minute"
```

The historical endpoint uses server-side Kite credentials only and never enables live orders. Passing `instrumentToken` skips instrument-master resolution.

Fetch underlying candles with nearby option historical candles:

```bash
curl "http://localhost:3000/api/kite/historical?underlying=NIFTY&date=2026-08-31&interval=minute&includeOptions=true&strikeWindow=1"
```

`includeOptions=true` downloads the Kite NFO instrument master, resolves the nearest or requested expiry, fetches the ATM CE/PE band, and builds replay-ready option rows. Historical bid/ask depth is not available from Kite candles, so replay liquidity checks use the configured spread assumption, defaulting to `1.00%`.

Add `persist=true` when a historical request also runs a backtest and should save the replay result:

```bash
curl "http://localhost:3000/api/kite/historical?underlying=NIFTY&date=2026-08-31&interval=minute&includeOptions=true&backtest=true&persist=true&previousHigh=25210&previousLow=24980&previousClose=25060"
```

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

## Paper Trade Journal

Phase 7 adds a local browser journal on the dashboard:

- Notes can be saved in any scanner state.
- Paper trades can be captured only when the strategy setup is confirmed, directional, liquid, and paper-only.
- Position size uses the configured risk rules and lot rounding.
- Saved entries stay in the browser under local storage and are not sent to live order execution.

This is intentionally paper-only. It does not place broker orders and it does not bypass the strategy gates.

Phase 11 adds optional database-backed journal sync:

- The browser still saves entries immediately.
- `/api/paper-journal` lists and saves journal entries when `DATABASE_URL` is configured.
- Standalone notes and guarded paper trades both persist.
- Structured paper trades are also linked to the `PaperTrade` table when the entry has trade fields.
- If the database is not reachable, the dashboard keeps working in local-only mode.

## Backtest Replay

Phase 8 adds a deterministic replay engine for the same VWAP breakout strategy:

- Historical candles are evaluated one at a time.
- Signals use only candles available at that point in the replay.
- Entry happens on the next candle after confirmation.
- Exits use stop, target one, or session close.
- Slippage, brokerage, lot size, and position sizing are included.
- Results are read-only and never connected to broker order placement.

The Phase 8 endpoint is read-only:

```bash
curl http://localhost:3000/api/simulation/phase8
```

The current replay uses deterministic sample data. It is a framework for validating strategy mechanics, not evidence of real market profitability.

Phase 9 adds multi-day aggregation:

- Each day is replayed independently.
- Overall P&L, costs, win rate, expectancy, and drawdown are aggregated across sessions.
- Sideways sessions can produce no-trade days.
- Trade IDs are made unique across sessions.

The Phase 9 endpoint is read-only:

```bash
curl http://localhost:3000/api/simulation/phase9
```

Kite historical candles can be fetched through `/api/kite/historical`. Optional replay from that endpoint uses modeled option quotes by default, or real Kite option historical candles when `includeOptions=true` is passed.

Phase 10 adds real option historical candle ingestion:

- `includeOptions=true` fetches nearby CE/PE option candles from Kite.
- `strikeWindow` defaults to `1`, which means ATM plus one strike on each side.
- `strikeWindow` is capped at `3`, which means at most 14 option contracts per request.
- Option OHLC, volume, and optional OI come from Kite historical candles.
- Historical bid/ask is estimated from `spreadAssumptionPercent` because Kite candles do not provide market depth.
- Backtest replay uses real option-history rows when they are included.

The Phase 10 endpoint marker is read-only:

```bash
curl http://localhost:3000/api/simulation/phase10
```

Phase 11 adds replay persistence:

- `/api/backtests` lists saved replay runs.
- `POST /api/backtests` saves a single-day or multi-day replay result.
- Backtest trades are saved under the run and refreshed idempotently on repeated saves.
- The dashboard includes save buttons on the replay cards.
- Live orders remain disabled.

The Phase 11 endpoint marker is read-only:

```bash
curl http://localhost:3000/api/simulation/phase11
```

Phase 12 adds saved replay reports:

- `/api/backtests` accepts optional `underlying`, `kind`, and `result` filters.
- The dashboard includes a `Backtest Reports` panel with run totals, best/worst runs, and a saved-run table.
- The reports panel falls back to current sample replays when PostgreSQL is unavailable or empty.
- Live orders remain disabled.

The Phase 12 endpoint marker is read-only:

```bash
curl http://localhost:3000/api/simulation/phase12
```

Phase 13 adds report export:

- `/api/backtests/export` returns filtered CSV using the same report filters.
- The dashboard export button downloads the current visible report rows.
- Exported rows include report metrics and `liveOrdersEnabled=false`.
- Live orders remain disabled.

The Phase 13 endpoint marker is read-only:

```bash
curl http://localhost:3000/api/simulation/phase13
```

Phase 14 adds saved report links:

- `/backtests/[id]` opens a read-only detail page for a saved database report.
- `/api/backtests/[id]` returns the safe report detail payload for one saved run.
- The dashboard table shows open/copy link actions only for database-backed report rows.
- Sample fallback rows remain labeled as samples and do not pretend to be saved links.
- Live orders remain disabled.

The Phase 14 endpoint marker is read-only:

```bash
curl http://localhost:3000/api/simulation/phase14
```

Phase 15 adds scheduled report reviews:

- `/reviews` provides a daily/weekly review workflow.
- `/api/report-reviews` saves and lists review notes when PostgreSQL is available.
- Each saved review stores selected report IDs and a comparison snapshot.
- Live orders remain disabled.

The Phase 15 endpoint marker is read-only:

```bash
curl http://localhost:3000/api/simulation/phase15
```

Phase 16 adds local owner boundaries:

- `/login` accepts the local owner access code.
- `/api/auth/session` creates, checks, and clears a signed owner session cookie.
- Saved reports, reviews, journal sync, Kite historical data, token callback, and stream controls are protected when auth is configured or live mode is enabled.
- Simulation mode can still run without login when no auth secret is configured.
- Live orders remain disabled.

The Phase 16 endpoint marker is read-only:

```bash
curl http://localhost:3000/api/simulation/phase16
```

Phase 17 adds deterministic explanations:

- The dashboard explains the current scanner state and why `NO TRADE` remains valid.
- Saved report pages explain replay results, strengths, cautions, and next review steps.
- Explanations are generated locally from deterministic fields.
- Live orders remain disabled.

The Phase 17 endpoint marker is read-only:

```bash
curl http://localhost:3000/api/simulation/phase17
```

Phase 18 adds live-mode hardening:

- Kite stream startup is blocked outside the configured Indian equity session.
- Stream status includes market-hours state, tick age, freshness, start gate, and safety checks.
- Signal readiness requires a connected stream, fresh data, open market session, and good data quality.
- Safety checks explicitly confirm live order execution is disabled.

The Phase 18 endpoint marker is read-only:

```bash
curl http://localhost:3000/api/simulation/phase18
```

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
- `PaperJournalEntry`
- `TradeEvent`
- `RiskConfiguration`
- `DailyMarketPlan`
- `DailyPerformance`
- `Backtest`
- `BacktestTrade`
- `ReportReview`

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
- `APP_AUTH_SECRET`
- `APP_OWNER_ACCESS_CODE`

Live mode must not start signal generation until WebSocket health, market-hours, freshness, and data-quality checks pass.

## Testing

Run:

```bash
npm run typecheck
npm run lint
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
- Phase 7 paper-journal notes, guarded paper-trade capture, and P&L summaries
- Phase 8 simulated backtest replay, next-candle entry, gated skips, and P&L summaries
- Phase 9 Kite historical candle normalization and multi-day replay aggregation
- Phase 10 Kite option historical ingestion, row alignment, spread assumptions, and strike-window caps
- Phase 11 persistence mapping for paper journal entries and backtest records
- Phase 12 backtest report records, filters, and summary totals
- Phase 13 report query parsing and CSV export
- Phase 14 report detail records and encoded share paths
- Phase 15 report review validation and comparison snapshots
- Phase 16 signed owner session validation
- Phase 17 deterministic scanner and report explanations
- Phase 18 market-hours and tick-freshness live stream safety gates

## Market Hours

The app uses `Asia/Kolkata`. Live stream startup is gated to the configured Indian equity session, and signal readiness requires fresh ticks during that session.

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
- If Prisma says it cannot reach `127.0.0.1:5432`, confirm PostgreSQL is running and start `npm run db:proxy` when the database is inside Ubuntu WSL.
