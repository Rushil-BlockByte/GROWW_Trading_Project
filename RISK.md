# Risk Document

## Principle

This system does not guarantee profits.

The goal is to protect capital, enforce discipline, and make every paper trade reviewable.

## Capital Controls

The app must support:

- Total capital
- Trading capital
- Maximum deployable capital
- Maximum risk per trade
- Maximum daily risk

The full account balance must never be assumed available for trading.

## Risk Per Trade

Example:

```text
Trading capital: INR 50,000
Risk per trade: 1%
Maximum risk: INR 500
```

If the calculated quantity is below one valid lot, the result is:

```text
NO TRADE
Reason: Required position size is below minimum lot size.
```

## Position Sizing

Position size uses:

- Maximum allowable loss
- Entry price
- Stop price
- Risk per unit
- Lot size

Formula:

```text
maximumRisk = tradingCapital * riskPerTradePercent
riskPerUnit = abs(entryPrice - stopPrice)
maximumUnits = floor(maximumRisk / riskPerUnit)
quantity = floor(maximumUnits / lotSize) * lotSize
```

The result must always round down.

## Underlying Invalidation

Stops should come from the underlying setup first.

Example:

```text
Underlying breakout: 25,180
Underlying invalidation: 25,150
```

The option stop is an estimate derived from that invalidation, not a blind percentage discount.

## Daily Loss Lock

If daily loss reaches the configured limit:

```text
DAILY LOSS LIMIT REACHED
```

Expected behavior:

- Stop new trade suggestions
- Allow review of existing signals and trades
- Require deliberate manual reset in simulation mode

## Slippage

Paper trading should be conservative.

The entry price should use the live option price at the moment the user takes the paper trade. It must not backfill a better entry.

Phase 7 paper captures use the watched option price from the current scanner snapshot and apply lot-size rounding through the risk engine. If the risk engine cannot size at least one valid lot, the journal records the rule violation for review.

## Liquidity Risk

Reject contracts with:

- Low volume
- Low OI
- Wide bid/ask spread
- Unreliable quotes
- Missing market depth when depth is required

Poor liquidity result:

```text
NO TRADE
Reason: Poor option liquidity.
```

## Data Failure

If market data becomes stale:

```text
NO SIGNAL
```

If required market data is missing:

```text
NO SIGNAL
Reason: INSUFFICIENT DATA
```

If WebSocket disconnects:

```text
NO SIGNAL
```

Signal generation resumes only after freshness checks pass.

## Expiry Risk

Expiry risk can invalidate otherwise clean setups.

The system should account for:

- Time to expiry
- Contract availability
- Spread behavior
- Liquidity decay
- Sudden premium compression

## Rule Violations

Every paper trade should track:

- Did the setup exist?
- Was risk within limits?
- Was the option liquid?
- Was the plan followed?
- Was the trade taken during an avoid period?

The journal exists to make repeat mistakes visible.

## Backtest Risk Assumptions

Phase 8 replay results include:

- Position sizing from the configured trading capital and risk percent
- Lot-size rounding
- Slippage on entry and exit
- Brokerage on both sides
- Skipped trades when one valid lot cannot be sized

Backtest P&L is a simulation result only. It must not be treated as live execution quality or a profit guarantee.

Phase 9 aggregates risk and P&L across replay sessions while preserving per-day summaries. Real Kite historical candles can feed the underlying side of the replay, but option quotes remain modeled until option-history ingestion is added.
