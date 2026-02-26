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
   /** Daily loss limit as a fraction of start-of-day equity (e.g. 0.33 = 33%). */
  dailyLossLimit?: number;
  /** Equity at start of current UTC day. */
  startOfDayEquity?: number;
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
  totalVolumeUsdc?: number;
  currentExposureUsdc?: number;
  totalRedeemedUsdc?: number;
  unredeemedValueUsdc?: number;
  avgRedemptionLagSecs?: number;
  maxRedemptionLagSecs?: number;
  longestWinStreakTrades?: number;
  longestLossStreakTrades?: number;
  avgHoldingTimeSecs?: number;
  maxHoldingTimeSecs?: number;
  tradesPerDay?: number;
  tradesPerWeek?: number;
  dailyPnl?: DailyPnlPoint[];
  weeklyPnl?: WeeklyPnlPoint[];
  pnlCurve?: PnlCurvePoint[];
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
