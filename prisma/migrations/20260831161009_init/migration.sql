-- CreateEnum
CREATE TYPE "MarketDataMode" AS ENUM ('SIMULATION', 'LIVE');

-- CreateEnum
CREATE TYPE "InstrumentKind" AS ENUM ('INDEX', 'FUTURE', 'OPTION_CE', 'OPTION_PE', 'EQUITY', 'VOLATILITY_INDEX');

-- CreateEnum
CREATE TYPE "SignalDirection" AS ENUM ('BULLISH', 'BEARISH', 'NO_TRADE');

-- CreateEnum
CREATE TYPE "SignalQuality" AS ENUM ('NO_SETUP', 'WEAK', 'WATCH', 'STRONG', 'HIGH_QUALITY');

-- CreateEnum
CREATE TYPE "SignalState" AS ENUM ('FORMING', 'CONFIRMED', 'ACTIVE', 'INVALIDATED', 'TARGET_1', 'TARGET_2', 'STOPPED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TradeSide" AS ENUM ('LONG_CALL', 'LONG_PUT');

-- CreateEnum
CREATE TYPE "PaperTradeStatus" AS ENUM ('OPEN', 'CLOSED', 'STOPPED', 'TARGET_1', 'TARGET_2', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BacktestStatus" AS ENUM ('DRAFT', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KiteSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" "MarketDataMode" NOT NULL DEFAULT 'SIMULATION',
    "apiKeyHash" TEXT,
    "accessTokenHash" TEXT,
    "lastAuthenticatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KiteSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Instrument" (
    "id" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "tradingsymbol" TEXT NOT NULL,
    "instrumentToken" INTEGER NOT NULL,
    "name" TEXT,
    "expiry" TIMESTAMP(3),
    "strike" DECIMAL(18,4),
    "instrumentType" TEXT NOT NULL,
    "kind" "InstrumentKind" NOT NULL,
    "segment" TEXT NOT NULL,
    "lotSize" INTEGER NOT NULL,
    "tickSize" DECIMAL(18,6) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Instrument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradingSession" (
    "id" TEXT NOT NULL,
    "tradeDate" TIMESTAMP(3) NOT NULL,
    "marketOpenAt" TIMESTAMP(3) NOT NULL,
    "marketCloseAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketCandle" (
    "id" TEXT NOT NULL,
    "tradingSessionId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "open" DECIMAL(18,6) NOT NULL,
    "high" DECIMAL(18,6) NOT NULL,
    "low" DECIMAL(18,6) NOT NULL,
    "close" DECIMAL(18,6) NOT NULL,
    "volume" BIGINT,
    "openInterest" BIGINT,
    "source" "MarketDataMode" NOT NULL DEFAULT 'SIMULATION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketCandle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptionSnapshot" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "ltp" DECIMAL(18,6) NOT NULL,
    "volume" BIGINT,
    "openInterest" BIGINT,
    "changeInOpenInterest" BIGINT,
    "bid" DECIMAL(18,6),
    "ask" DECIMAL(18,6),
    "spreadPercent" DECIMAL(10,4),
    "baselineType" TEXT,
    "baselineTimestamp" TIMESTAMP(3),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OptionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Strategy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Strategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyConfiguration" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSignal" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "strategyId" TEXT NOT NULL,
    "strategyConfigurationId" TEXT NOT NULL,
    "tradingSessionId" TEXT NOT NULL,
    "underlyingInstrumentId" TEXT,
    "optionInstrumentId" TEXT,
    "strategyName" TEXT NOT NULL,
    "strategyVersion" TEXT NOT NULL,
    "configurationVersion" TEXT NOT NULL,
    "direction" "SignalDirection" NOT NULL,
    "quality" "SignalQuality" NOT NULL,
    "state" "SignalState" NOT NULL DEFAULT 'FORMING',
    "score" INTEGER NOT NULL,
    "underlyingEntry" DECIMAL(18,6),
    "underlyingInvalidation" DECIMAL(18,6),
    "optionEntryLow" DECIMAL(18,6),
    "optionEntryHigh" DECIMAL(18,6),
    "optionStopEstimate" DECIMAL(18,6),
    "targetOne" DECIMAL(18,6),
    "targetTwo" DECIMAL(18,6),
    "riskReward" DECIMAL(10,4),
    "reasons" JSONB NOT NULL,
    "risks" JSONB,
    "immutableSnapshot" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignalEvent" (
    "id" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperTrade" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "signalId" TEXT,
    "tradingSessionId" TEXT,
    "underlying" TEXT NOT NULL,
    "optionSymbol" TEXT NOT NULL,
    "strike" DECIMAL(18,4) NOT NULL,
    "expiry" TIMESTAMP(3) NOT NULL,
    "side" "TradeSide" NOT NULL,
    "entryPrice" DECIMAL(18,6) NOT NULL,
    "stopPrice" DECIMAL(18,6) NOT NULL,
    "targetOne" DECIMAL(18,6),
    "targetTwo" DECIMAL(18,6),
    "quantity" INTEGER NOT NULL,
    "lots" INTEGER NOT NULL,
    "status" "PaperTradeStatus" NOT NULL DEFAULT 'OPEN',
    "score" INTEGER NOT NULL,
    "marketRegime" TEXT NOT NULL,
    "reasons" JSONB NOT NULL,
    "notes" JSONB,
    "realizedPnl" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "unrealizedPnl" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "mae" DECIMAL(18,6),
    "mfe" DECIMAL(18,6),
    "rMultiple" DECIMAL(10,4),
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaperTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperJournalEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paperTradeId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "strategyName" TEXT NOT NULL,
    "strategyVersion" TEXT NOT NULL,
    "underlying" TEXT NOT NULL,
    "signalState" TEXT NOT NULL,
    "bias" TEXT NOT NULL,
    "quality" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "marketRegime" TEXT NOT NULL,
    "optionSymbol" TEXT,
    "optionSide" TEXT,
    "tradeSide" TEXT,
    "strike" DECIMAL(18,4),
    "expiry" TIMESTAMP(3),
    "entryPrice" DECIMAL(18,6),
    "stopPrice" DECIMAL(18,6),
    "targetOne" DECIMAL(18,6),
    "targetTwo" DECIMAL(18,6),
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "lots" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL,
    "reasons" JSONB NOT NULL,
    "risks" JSONB NOT NULL,
    "ruleViolations" JSONB NOT NULL,
    "realizedPnl" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "unrealizedPnl" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "snapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperJournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeEvent" (
    "id" TEXT NOT NULL,
    "paperTradeId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "price" DECIMAL(18,6),
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskConfiguration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "totalCapital" DECIMAL(18,2),
    "tradingCapital" DECIMAL(18,2) NOT NULL,
    "maximumDeployableCapitalPercent" DECIMAL(10,4) NOT NULL,
    "riskPerTradePercent" DECIMAL(10,4) NOT NULL,
    "maximumDailyLossPercent" DECIMAL(10,4) NOT NULL,
    "maximumNumberOfTrades" INTEGER NOT NULL,
    "maximumOpenPositions" INTEGER NOT NULL,
    "minimumRiskReward" DECIMAL(10,4) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyMarketPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tradeDate" TIMESTAMP(3) NOT NULL,
    "underlying" TEXT NOT NULL,
    "bias" TEXT,
    "support" JSONB,
    "resistance" JSONB,
    "bullishScenario" TEXT,
    "bearishScenario" TEXT,
    "invalidation" TEXT,
    "importantEvents" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyMarketPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyPerformance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tradingSessionId" TEXT,
    "tradeDate" TIMESTAMP(3) NOT NULL,
    "totalTrades" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "winRate" DECIMAL(10,4),
    "averageWin" DECIMAL(18,6),
    "averageLoss" DECIMAL(18,6),
    "profitFactor" DECIMAL(10,4),
    "expectancy" DECIMAL(18,6),
    "averageR" DECIMAL(10,4),
    "maximumDrawdown" DECIMAL(18,6),
    "largestWin" DECIMAL(18,6),
    "largestLoss" DECIMAL(18,6),
    "consecutiveWins" INTEGER NOT NULL DEFAULT 0,
    "consecutiveLosses" INTEGER NOT NULL DEFAULT 0,
    "breakdown" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyPerformance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Backtest" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "strategyId" TEXT NOT NULL,
    "strategyConfigurationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "BacktestStatus" NOT NULL DEFAULT 'DRAFT',
    "trainingStart" TIMESTAMP(3),
    "trainingEnd" TIMESTAMP(3),
    "validationStart" TIMESTAMP(3),
    "validationEnd" TIMESTAMP(3),
    "outOfSampleStart" TIMESTAMP(3),
    "outOfSampleEnd" TIMESTAMP(3),
    "assumptions" JSONB NOT NULL,
    "metrics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Backtest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacktestTrade" (
    "id" TEXT NOT NULL,
    "backtestId" TEXT NOT NULL,
    "signalTimestamp" TIMESTAMP(3) NOT NULL,
    "entryTimestamp" TIMESTAMP(3) NOT NULL,
    "exitTimestamp" TIMESTAMP(3),
    "underlying" TEXT NOT NULL,
    "optionSymbol" TEXT NOT NULL,
    "strike" DECIMAL(18,4) NOT NULL,
    "expiry" TIMESTAMP(3) NOT NULL,
    "side" "TradeSide" NOT NULL,
    "entryPrice" DECIMAL(18,6) NOT NULL,
    "exitPrice" DECIMAL(18,6),
    "stopPrice" DECIMAL(18,6) NOT NULL,
    "targetOne" DECIMAL(18,6),
    "targetTwo" DECIMAL(18,6),
    "quantity" INTEGER NOT NULL,
    "slippage" DECIMAL(18,6),
    "transactionCost" DECIMAL(18,6),
    "realizedPnl" DECIMAL(18,6),
    "rMultiple" DECIMAL(10,4),
    "marketRegime" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "outcome" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BacktestTrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "KiteSession_userId_idx" ON "KiteSession"("userId");

-- CreateIndex
CREATE INDEX "KiteSession_mode_idx" ON "KiteSession"("mode");

-- CreateIndex
CREATE INDEX "KiteSession_expiresAt_idx" ON "KiteSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Instrument_instrumentToken_key" ON "Instrument"("instrumentToken");

-- CreateIndex
CREATE INDEX "Instrument_exchange_idx" ON "Instrument"("exchange");

-- CreateIndex
CREATE INDEX "Instrument_tradingsymbol_idx" ON "Instrument"("tradingsymbol");

-- CreateIndex
CREATE INDEX "Instrument_expiry_idx" ON "Instrument"("expiry");

-- CreateIndex
CREATE INDEX "Instrument_strike_idx" ON "Instrument"("strike");

-- CreateIndex
CREATE INDEX "Instrument_instrumentType_idx" ON "Instrument"("instrumentType");

-- CreateIndex
CREATE INDEX "Instrument_instrumentToken_idx" ON "Instrument"("instrumentToken");

-- CreateIndex
CREATE INDEX "Instrument_exchange_expiry_strike_instrumentType_idx" ON "Instrument"("exchange", "expiry", "strike", "instrumentType");

-- CreateIndex
CREATE UNIQUE INDEX "Instrument_exchange_tradingsymbol_key" ON "Instrument"("exchange", "tradingsymbol");

-- CreateIndex
CREATE UNIQUE INDEX "TradingSession_tradeDate_key" ON "TradingSession"("tradeDate");

-- CreateIndex
CREATE INDEX "TradingSession_tradeDate_idx" ON "TradingSession"("tradeDate");

-- CreateIndex
CREATE INDEX "TradingSession_status_idx" ON "TradingSession"("status");

-- CreateIndex
CREATE INDEX "MarketCandle_tradingSessionId_idx" ON "MarketCandle"("tradingSessionId");

-- CreateIndex
CREATE INDEX "MarketCandle_instrumentId_idx" ON "MarketCandle"("instrumentId");

-- CreateIndex
CREATE INDEX "MarketCandle_interval_idx" ON "MarketCandle"("interval");

-- CreateIndex
CREATE INDEX "MarketCandle_timestamp_idx" ON "MarketCandle"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "MarketCandle_instrumentId_interval_timestamp_key" ON "MarketCandle"("instrumentId", "interval", "timestamp");

-- CreateIndex
CREATE INDEX "OptionSnapshot_instrumentId_idx" ON "OptionSnapshot"("instrumentId");

-- CreateIndex
CREATE INDEX "OptionSnapshot_timestamp_idx" ON "OptionSnapshot"("timestamp");

-- CreateIndex
CREATE INDEX "OptionSnapshot_instrumentId_timestamp_idx" ON "OptionSnapshot"("instrumentId", "timestamp");

-- CreateIndex
CREATE INDEX "Strategy_active_idx" ON "Strategy"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Strategy_name_version_key" ON "Strategy"("name", "version");

-- CreateIndex
CREATE INDEX "StrategyConfiguration_strategyId_idx" ON "StrategyConfiguration"("strategyId");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyConfiguration_strategyId_version_key" ON "StrategyConfiguration"("strategyId", "version");

-- CreateIndex
CREATE INDEX "MarketSignal_userId_idx" ON "MarketSignal"("userId");

-- CreateIndex
CREATE INDEX "MarketSignal_strategyId_idx" ON "MarketSignal"("strategyId");

-- CreateIndex
CREATE INDEX "MarketSignal_strategyConfigurationId_idx" ON "MarketSignal"("strategyConfigurationId");

-- CreateIndex
CREATE INDEX "MarketSignal_tradingSessionId_idx" ON "MarketSignal"("tradingSessionId");

-- CreateIndex
CREATE INDEX "MarketSignal_direction_idx" ON "MarketSignal"("direction");

-- CreateIndex
CREATE INDEX "MarketSignal_quality_idx" ON "MarketSignal"("quality");

-- CreateIndex
CREATE INDEX "MarketSignal_state_idx" ON "MarketSignal"("state");

-- CreateIndex
CREATE INDEX "MarketSignal_generatedAt_idx" ON "MarketSignal"("generatedAt");

-- CreateIndex
CREATE INDEX "SignalEvent_signalId_idx" ON "SignalEvent"("signalId");

-- CreateIndex
CREATE INDEX "SignalEvent_eventType_idx" ON "SignalEvent"("eventType");

-- CreateIndex
CREATE INDEX "SignalEvent_createdAt_idx" ON "SignalEvent"("createdAt");

-- CreateIndex
CREATE INDEX "PaperTrade_userId_idx" ON "PaperTrade"("userId");

-- CreateIndex
CREATE INDEX "PaperTrade_signalId_idx" ON "PaperTrade"("signalId");

-- CreateIndex
CREATE INDEX "PaperTrade_tradingSessionId_idx" ON "PaperTrade"("tradingSessionId");

-- CreateIndex
CREATE INDEX "PaperTrade_underlying_idx" ON "PaperTrade"("underlying");

-- CreateIndex
CREATE INDEX "PaperTrade_expiry_idx" ON "PaperTrade"("expiry");

-- CreateIndex
CREATE INDEX "PaperTrade_status_idx" ON "PaperTrade"("status");

-- CreateIndex
CREATE INDEX "PaperTrade_openedAt_idx" ON "PaperTrade"("openedAt");

-- CreateIndex
CREATE INDEX "PaperJournalEntry_userId_idx" ON "PaperJournalEntry"("userId");

-- CreateIndex
CREATE INDEX "PaperJournalEntry_paperTradeId_idx" ON "PaperJournalEntry"("paperTradeId");

-- CreateIndex
CREATE INDEX "PaperJournalEntry_type_idx" ON "PaperJournalEntry"("type");

-- CreateIndex
CREATE INDEX "PaperJournalEntry_status_idx" ON "PaperJournalEntry"("status");

-- CreateIndex
CREATE INDEX "PaperJournalEntry_underlying_idx" ON "PaperJournalEntry"("underlying");

-- CreateIndex
CREATE INDEX "PaperJournalEntry_createdAt_idx" ON "PaperJournalEntry"("createdAt");

-- CreateIndex
CREATE INDEX "TradeEvent_paperTradeId_idx" ON "TradeEvent"("paperTradeId");

-- CreateIndex
CREATE INDEX "TradeEvent_eventType_idx" ON "TradeEvent"("eventType");

-- CreateIndex
CREATE INDEX "TradeEvent_createdAt_idx" ON "TradeEvent"("createdAt");

-- CreateIndex
CREATE INDEX "RiskConfiguration_userId_idx" ON "RiskConfiguration"("userId");

-- CreateIndex
CREATE INDEX "RiskConfiguration_active_idx" ON "RiskConfiguration"("active");

-- CreateIndex
CREATE INDEX "DailyMarketPlan_userId_idx" ON "DailyMarketPlan"("userId");

-- CreateIndex
CREATE INDEX "DailyMarketPlan_tradeDate_idx" ON "DailyMarketPlan"("tradeDate");

-- CreateIndex
CREATE INDEX "DailyMarketPlan_underlying_idx" ON "DailyMarketPlan"("underlying");

-- CreateIndex
CREATE UNIQUE INDEX "DailyMarketPlan_userId_tradeDate_underlying_key" ON "DailyMarketPlan"("userId", "tradeDate", "underlying");

-- CreateIndex
CREATE INDEX "DailyPerformance_userId_idx" ON "DailyPerformance"("userId");

-- CreateIndex
CREATE INDEX "DailyPerformance_tradingSessionId_idx" ON "DailyPerformance"("tradingSessionId");

-- CreateIndex
CREATE INDEX "DailyPerformance_tradeDate_idx" ON "DailyPerformance"("tradeDate");

-- CreateIndex
CREATE UNIQUE INDEX "DailyPerformance_userId_tradeDate_key" ON "DailyPerformance"("userId", "tradeDate");

-- CreateIndex
CREATE INDEX "Backtest_userId_idx" ON "Backtest"("userId");

-- CreateIndex
CREATE INDEX "Backtest_strategyId_idx" ON "Backtest"("strategyId");

-- CreateIndex
CREATE INDEX "Backtest_strategyConfigurationId_idx" ON "Backtest"("strategyConfigurationId");

-- CreateIndex
CREATE INDEX "Backtest_status_idx" ON "Backtest"("status");

-- CreateIndex
CREATE INDEX "BacktestTrade_backtestId_idx" ON "BacktestTrade"("backtestId");

-- CreateIndex
CREATE INDEX "BacktestTrade_signalTimestamp_idx" ON "BacktestTrade"("signalTimestamp");

-- CreateIndex
CREATE INDEX "BacktestTrade_underlying_idx" ON "BacktestTrade"("underlying");

-- CreateIndex
CREATE INDEX "BacktestTrade_expiry_idx" ON "BacktestTrade"("expiry");

-- CreateIndex
CREATE INDEX "BacktestTrade_outcome_idx" ON "BacktestTrade"("outcome");

-- AddForeignKey
ALTER TABLE "KiteSession" ADD CONSTRAINT "KiteSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketCandle" ADD CONSTRAINT "MarketCandle_tradingSessionId_fkey" FOREIGN KEY ("tradingSessionId") REFERENCES "TradingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketCandle" ADD CONSTRAINT "MarketCandle_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionSnapshot" ADD CONSTRAINT "OptionSnapshot_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyConfiguration" ADD CONSTRAINT "StrategyConfiguration_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSignal" ADD CONSTRAINT "MarketSignal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSignal" ADD CONSTRAINT "MarketSignal_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSignal" ADD CONSTRAINT "MarketSignal_strategyConfigurationId_fkey" FOREIGN KEY ("strategyConfigurationId") REFERENCES "StrategyConfiguration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSignal" ADD CONSTRAINT "MarketSignal_tradingSessionId_fkey" FOREIGN KEY ("tradingSessionId") REFERENCES "TradingSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSignal" ADD CONSTRAINT "MarketSignal_underlyingInstrumentId_fkey" FOREIGN KEY ("underlyingInstrumentId") REFERENCES "Instrument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSignal" ADD CONSTRAINT "MarketSignal_optionInstrumentId_fkey" FOREIGN KEY ("optionInstrumentId") REFERENCES "Instrument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalEvent" ADD CONSTRAINT "SignalEvent_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "MarketSignal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperTrade" ADD CONSTRAINT "PaperTrade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperTrade" ADD CONSTRAINT "PaperTrade_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "MarketSignal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperTrade" ADD CONSTRAINT "PaperTrade_tradingSessionId_fkey" FOREIGN KEY ("tradingSessionId") REFERENCES "TradingSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperJournalEntry" ADD CONSTRAINT "PaperJournalEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperJournalEntry" ADD CONSTRAINT "PaperJournalEntry_paperTradeId_fkey" FOREIGN KEY ("paperTradeId") REFERENCES "PaperTrade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeEvent" ADD CONSTRAINT "TradeEvent_paperTradeId_fkey" FOREIGN KEY ("paperTradeId") REFERENCES "PaperTrade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskConfiguration" ADD CONSTRAINT "RiskConfiguration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyMarketPlan" ADD CONSTRAINT "DailyMarketPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPerformance" ADD CONSTRAINT "DailyPerformance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPerformance" ADD CONSTRAINT "DailyPerformance_tradingSessionId_fkey" FOREIGN KEY ("tradingSessionId") REFERENCES "TradingSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Backtest" ADD CONSTRAINT "Backtest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Backtest" ADD CONSTRAINT "Backtest_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Backtest" ADD CONSTRAINT "Backtest_strategyConfigurationId_fkey" FOREIGN KEY ("strategyConfigurationId") REFERENCES "StrategyConfiguration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacktestTrade" ADD CONSTRAINT "BacktestTrade_backtestId_fkey" FOREIGN KEY ("backtestId") REFERENCES "Backtest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
