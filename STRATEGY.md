# Strategy Document

## Purpose

The first strategy is a disciplined setup detector, not a prediction engine.

Strategy name:

```text
VWAP_BREAKOUT
```

Implemented version:

```text
1.0.0
```

## Plain-English Meaning

The system waits for price to show strength or weakness around meaningful levels, then checks whether volume, trend, option-chain context, liquidity, and risk agree.

If the setup is incomplete, the result is `NO TRADE`.

## Technical Inputs

Phase 4 implements the price/volume context inputs. Phase 5 implements option-chain and liquidity context. Phase 6 converts those inputs into deterministic setup scoring.

- Current price
- Session VWAP
- EMA 9
- EMA 20
- EMA 50
- ATR
- RSI
- Relative volume
- Previous day high
- Previous day low
- Previous close
- Opening range high
- Opening range low
- Support and resistance levels
- Option-chain OI and OI change
- Bid/ask spread
- Risk/reward

## Bullish Setup

Conditions:

- Price is above VWAP
- EMA structure is bullish
- Price approaches a resistance level
- Breakout candle closes above resistance
- Relative volume confirms
- Momentum confirms
- Option liquidity is acceptable
- Risk/reward is acceptable
- Market regime is not strongly sideways

## Bearish Setup

The bearish setup mirrors the bullish setup:

- Price is below VWAP
- EMA structure is bearish
- Price approaches support
- Breakdown candle closes below support
- Relative volume confirms
- Momentum confirms
- Option liquidity is acceptable
- Risk/reward is acceptable
- Market regime is not strongly sideways

## VWAP

VWAP resets at the beginning of each trading session.

It must not carry values from a previous session.

Dashboard values:

- Current price
- VWAP
- Distance from VWAP

## Trend

The initial trend check uses EMA structure:

- Bullish: EMA 9 above EMA 20 above EMA 50
- Bearish: EMA 9 below EMA 20 below EMA 50
- Otherwise: mixed or sideways

## Breakout

A breakout is valid only after the candle closes beyond the level. A wick alone is not enough.

The engine must store the exact candle and level that created the signal.

## Volume

Relative volume compares current volume with a configured average. Low-volume moves should not trigger aggressive entries.

Phase 4 uses the current one-minute candle volume divided by the previous 20-candle rolling average.

## Option Chain

The option chain supports, but does not replace, price action.

Metrics:

- Total CE OI
- Total PE OI
- OI Ratio
- Strike-wise OI
- Change in OI
- Volume/OI ratio
- Max OI strikes
- Potential OI support
- Potential OI resistance

Do not call the ratio `PCR` unless its definition is explicit.

Phase 5 calls the headline ratio `PE/CE OI ratio`, calculated as total put open interest divided by total call open interest across the selected option universe.

## Liquidity

Before suggesting an option, the engine checks:

- Volume
- Bid/ask spread
- LTP
- OI
- Market depth when available

Failure result:

```text
NO TRADE
Reason: Poor option liquidity.
```

Phase 5 applies liquidity checks at the contract level. The status is either `TRADABLE` or `NOT_TRADABLE`, but this is only a market-quality gate. It is not a strategy signal.

Phase 6 selects the nearest liquid contract on the setup side as watched context only. For a bullish bias, the watched side is CE. For a bearish bias, the watched side is PE.

## Scoring

The setup score is transparent and deterministic:

| Component | Points |
| --- | ---: |
| Trend | 20 |
| VWAP | 15 |
| Breakout | 20 |
| Volume | 15 |
| Momentum | 10 |
| Option-chain confirmation | 10 |
| Liquidity | 5 |
| Risk/reward | 5 |

This is called `SETUP SCORE`.

It is not a probability of profit.

Phase 6 implements this score in `VWAP + Trend + Breakout + Volume` version `1.0.0`.

## Quality Bands

| Score | Label |
| ---: | --- |
| 0-49 | NO SETUP |
| 50-64 | WEAK |
| 65-74 | WATCH |
| 75-84 | STRONG |
| 85-100 | HIGH QUALITY |

## No-Trade Rules

Return `NO TRADE` or `NO SIGNAL` when:

- Market is sideways
- Setup is incomplete
- Risk/reward is poor
- Volume is low
- Option liquidity is poor
- Spread is wide
- Signals conflict
- Data is stale
- Daily loss limit is reached
- Market is closed
- Expiry risk is high
- Contract is unavailable

Phase 6 keeps direction as `NO TRADE` unless all hard gates pass:

- Data quality is `GOOD`
- Market regime is not `SIDEWAYS` or `HIGH_VOLATILITY`
- A directional bias exists
- Breakout/breakdown is confirmed by close
- Option-chain confirmation does not conflict
- A liquid option contract exists on the setup side
- Risk/reward meets the configured minimum

Phase 7 reuses these same gates before allowing a paper-trade journal capture. Notes can be saved in any state, but paper trades require a confirmed directional setup and a tradable selected contract.

## Signal Lifecycle

Valid states:

- `FORMING`
- `CONFIRMED`
- `ACTIVE`
- `INVALIDATED`
- `TARGET_1`
- `TARGET_2`
- `STOPPED`
- `EXPIRED`

Alerts are generated only on meaningful state transitions.

## Backtesting Rules

The same strategy engine must run against live and historical providers.

Rules:

- No future candles
- No future OI
- No future volume
- No future option price
- Actual option contracts only
- Slippage and transaction costs included
- Lot sizes respected
- Expiry availability respected

Phase 8 implements the first deterministic replay for the VWAP breakout strategy. It evaluates candles sequentially, enters only on the next candle after confirmation, and records skipped signals when risk or liquidity prevents a valid paper-sized trade.
