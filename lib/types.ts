// Matches Rust LiveState (camelCase) and TradeRecord (snake_case)

export interface CurrentMarket {
  seconds_elapsed: number;
  seconds_remaining: number;
  slug: string;
  tick_in_window: number;
}

export interface TradeRecord {
  timestamp: string;
  slug: string;
  side: string;
  entry_price: number;
  size_usdc: number;
  result: string; // "WIN" | "LOSS" | "PENDING" | "TIMEOUT" | "REJECTED"
  pnl_usdc: number;
  reason: string;
  resolved_at?: string | null;
   // Whether on-chain redemption/collection has succeeded for this market.
  redeemed?: boolean;
}

export interface DailyPnlPoint {
  date: string;
  pnl: number;
}

export interface WeeklyPnlPoint {
  weekStart: string;
  pnl: number;
}

export interface PnlCurvePoint {
  ts: string;
  pnl: number;
}

export interface LiveState {
  updatedAt: string;
  uptimeSeconds: number;
  activeSeconds: number;
  pausedSeconds: number;
  totalNoMarketSeconds: number;
  totalRtdsDownSeconds: number;
  /** Hot path latency p50 (ms); updated every 30 min. */
  hotPathP50Ms?: number;
  /** Hot path latency p95 (ms); updated every 30 min. */
  hotPathP95Ms?: number;
  /** Hot path latency p99 (ms); updated every 30 min. */
  hotPathP99Ms?: number;
  botPaused: boolean;
  btcPrice: number | null;
  chainlinkBtcPrice: number | null;
  priceToBeat: number | null;
  rtdsStale: boolean;
  rtdsSecondsSinceUpdate: number | null;
  yesPrice: number;
  noPrice: number;
  btcMove: number | null;
  chainlinkBtcMove: number | null;
  currentMarket: CurrentMarket | null;
  equity: number;
  /** Initial equity when bot started. Chart baseline. */
  initialEquity?: number;
   /** Loss limit as a fraction of window-start equity (e.g. 0.33 = 33% per 8h). */
  dailyLossLimit?: number;
  /** Equity at start of current 8h loss-limit window. */
  startOfDayEquity?: number;
  /** When the current 8h loss-limit window started (ISO8601). */
  lossLimitResetAt?: string | null;
  /** Max loss allowed in this window (33% of window-start equity). */
  lossLimitMaxUsdc?: number;
  /** How much of that limit has been used in this window. */
  lossLimitUsedUsdc?: number;
  /** CLOB USDC spending approval (allowance); refreshed hourly. */
  clobSpendingApprovalUsdc?: number;
  livePnl: number;
  decisionLog: DecisionLogEntry[];
  tradeEvents: unknown[];
  deferredResolutions: unknown[];
  trades: TradeRecord[];
  // Analytics from backend (all optional for backwards compatibility)
  totalTrades?: number;
  openPositions?: number;
  redeemablePositions?: number;
  closedPositions?: number;
  totalInvestedUsdc?: number;
  totalRealizedPnlUsdc?: number;
  totalUnrealizedPnlUsdc?: number;
  totalProfitUsdc?: number;
  totalLossUsdc?: number;
  largestMarketProfitUsdc?: number;
  largestMarketProfitSlug?: string | null;
  largestMarketLossUsdc?: number;
  largestMarketLossSlug?: string | null;
  tradeWinRatePct?: number;
  resolvedWinCount?: number;
  resolvedLossCount?: number;
  totalVolumeUsdc?: number;
  currentExposureUsdc?: number;
  totalRedeemedUsdc?: number;
  unredeemedValueUsdc?: number;
  avgRedemptionLagSecs?: number;
  maxRedemptionLagSecs?: number;
  longestWinStreakTrades?: number;
  longestLossStreakTrades?: number;
  currentWinStreakTrades?: number;
  currentLossStreakTrades?: number;
  avgHoldingTimeSecs?: number;
  minHoldingTimeSecs?: number;
  maxHoldingTimeSecs?: number;
  tradesPerDay?: number;
  tradesPerWeek?: number;
  dailyPnl?: DailyPnlPoint[];
  weeklyPnl?: WeeklyPnlPoint[];
  pnlCurve?: PnlCurvePoint[];
  /** Recent closed positions from Data API (TradeRecord-compatible). */
  analyticsTrades?: TradeRecord[];
}

/** One entry in the bot decision log (take / skip / error). */
export interface DecisionLogEntry {
  ts: string;
  kind: "take" | "skip" | "error";
  reason: string;
  slug?: string;
  side?: string;
  price?: number;
  size_usdc?: number;
}

/** Optional: bot can send equity curve points for chart */
export interface EquityPoint {
  timestamp: string;
  equity: number;
}

export interface LiveStateWithHistory extends LiveState {
  equityHistory?: EquityPoint[];
}
