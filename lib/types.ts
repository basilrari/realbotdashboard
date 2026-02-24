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
  livePnl: number;
  decisionLog: unknown[];
  tradeEvents: unknown[];
  deferredResolutions: unknown[];
  trades: TradeRecord[];
}

/** Optional: bot can send equity curve points for chart */
export interface EquityPoint {
  timestamp: string;
  equity: number;
}

export interface LiveStateWithHistory extends LiveState {
  equityHistory?: EquityPoint[];
}
