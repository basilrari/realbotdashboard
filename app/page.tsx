"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  TrendingUp,
  Activity,
  ExternalLink,
  Clock,
  Pause,
  WifiOff,
  BarChart3,
  RefreshCw,
  AlertCircle,
  MessageSquare,
  PieChart,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import {
  createChart,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type UTCTimestamp,
} from "lightweight-charts";
import { fetchState } from "@/lib/api";
import type { LiveState, TradeRecord, DecisionLogEntry } from "@/lib/types";

const AUTO_BURST_SECONDS = 30;
const AUTO_BURST_INTERVAL_MS = 1000;

/** Format date/time in UTC (matches Bitcoin market). */
function formatUtc(date: Date, style: "time" | "datetime" | "date"): string {
  if (style === "time") {
    return date.toISOString().slice(11, 19);
  }
  if (style === "date") {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      dateStyle: "short",
    }).format(date);
  }
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

/** Parse timestamp (ISO string or unix seconds) to Date. */
function parseTimestamp(ts: string | number | undefined | null): Date {
  if (ts == null) return new Date(NaN);
  if (typeof ts === "number") return new Date(ts * 1000);
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Build chart data with UTCTimestamp (unix seconds) for lightweight-charts. Uses full history. */
function buildChartData(
  trades: TradeRecord[],
  stateEquity: number,
  livePnl: number,
  initialEquity: number | undefined,
  updatedAt: string,
  uptimeSeconds: number
): LineData[] {
  const eq = Number(stateEquity);
  const pnl = Number(livePnl);
  const init = initialEquity != null && initialEquity > 0 ? Number(initialEquity) : Math.max(0, eq - pnl);
  const startEquity = Number.isFinite(init) ? init : 0;
  const nowSec = Math.floor(Date.now() / 1000);
  const updatedSec = Math.floor(new Date(updatedAt || 0).getTime() / 1000);
  const startSec = Math.max(updatedSec - uptimeSeconds, updatedSec - 86400 * 365);
  const out: LineData[] = [{ time: startSec as UTCTimestamp, value: startEquity }];
  const sorted = [...trades].sort(
    (a, b) => parseTimestamp(a.timestamp).getTime() - parseTimestamp(b.timestamp).getTime()
  );
  let running = startEquity;
  for (const t of sorted) {
    const p = Number(t.pnl_usdc);
    if (!Number.isFinite(p)) continue;
    running += p;
    const ts = Math.floor(parseTimestamp(t.timestamp).getTime() / 1000);
    if (!Number.isFinite(running) || !Number.isFinite(ts)) continue;
    out.push({ time: ts as UTCTimestamp, value: running });
  }
  if (Number.isFinite(eq)) {
    out.push({ time: nowSec as UTCTimestamp, value: eq });
  }
  const valid = out.filter((d) => d != null && Number.isFinite(d.value) && d.time != null);
  // Dedupe by time (keep last) to avoid lightweight-charts "Value is null"
  const seen = new Map<number, LineData>();
  for (const d of valid) {
    seen.set(d.time as number, d);
  }
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([, d]) => d);
}

/** TradingView-style equity chart: scroll (drag) and zoom (mouse wheel). Uses full history. */
function EquityChart({
  trades,
  stateEquity,
  livePnl,
  initialEquity,
  updatedAt,
  uptimeSeconds,
}: {
  trades: TradeRecord[];
  stateEquity: number;
  livePnl: number;
  initialEquity?: number;
  updatedAt: string;
  uptimeSeconds: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "#161b22" },
        textColor: "#8b949e",
        fontFamily: "inherit",
      },
      grid: {
        vertLines: { color: "#21262d" },
        horzLines: { color: "#21262d" },
      },
      rightPriceScale: {
        borderColor: "#30363d",
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: "#30363d",
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
      },
    });
    const series = chart.addSeries(LineSeries, {
      color: "#2dd4bf",
      lineWidth: 2,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    chartRef.current = chart;
    seriesRef.current = series as ISeriesApi<"Line">;

    const resize = () => chart.applyOptions({ width: containerRef.current?.offsetWidth ?? 0 });
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const data = buildChartData(
      trades,
      stateEquity,
      livePnl,
      initialEquity,
      updatedAt,
      uptimeSeconds
    );
    if (data.length < 2) {
      const fallback = [
        { time: Math.floor(Date.now() / 1000) as UTCTimestamp, value: stateEquity || 0 },
        { time: (Math.floor(Date.now() / 1000) + 1) as UTCTimestamp, value: stateEquity || 0 },
      ];
      series.setData(fallback);
    } else {
      series.setData(data);
    }
    chartRef.current?.timeScale().fitContent();
  }, [trades, stateEquity, livePnl, initialEquity, updatedAt, uptimeSeconds]);

  return <div ref={containerRef} className="w-full h-full min-h-[280px]" />;
}

export default function DashboardPage() {
  const [state, setState] = useState<LiveState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isAutoBurst, setIsAutoBurst] = useState<boolean>(false);
  const [tradesPage, setTradesPage] = useState(0);

  const load = useCallback(async () => {
    try {
      const data = await fetchState();
      setState(data);
      setError(null);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch state");
    }
  }, []);

  // Initial fetch and start 1s burst for 30s on mount
  useEffect(() => {
    void (async () => {
      await load();
      setIsAutoBurst(true);
    })();
  }, [load]);

  // Auto-burst: refresh every second for AUTO_BURST_SECONDS, then pause
  useEffect(() => {
    if (!isAutoBurst) return;
    let cancelled = false;
    let ticks = 0;

    const tick = async () => {
      if (cancelled) return;
      await load();
    };

    // First immediate refresh in this burst
    void tick();

    const id = setInterval(async () => {
      if (cancelled) return;
      ticks += 1;
      if (ticks >= AUTO_BURST_SECONDS) {
        clearInterval(id);
        setIsAutoBurst(false);
        return;
      }
      await load();
    }, AUTO_BURST_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isAutoBurst, load]);

  if (error && !state) {
    return (
      <div className="min-h-screen bg-[#0d1117] text-[#e6edf3] flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-amber-400 mx-auto mb-3" />
          <h1 className="text-xl font-semibold text-amber-400 mb-2">Cannot reach bot</h1>
          <p className="text-[#8b949e] mb-4">{error}</p>
          <p className="text-sm text-[#6e7681]">
            Set <code className="bg-[#21262d] px-1 rounded">NEXT_PUBLIC_BOT_URL</code> to your
            bot&apos;s /state endpoint (e.g. http://your-server:8080/state).
          </p>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="min-h-screen bg-[#0d1117] text-[#e6edf3] flex items-center justify-center p-4">
        <div className="text-center">
          <RefreshCw className="w-10 h-10 text-[#2dd4bf] mx-auto mb-3 animate-pulse" />
          <p className="text-[#8b949e]">Loading bot state…</p>
        </div>
      </div>
    );
  }

  const market = state?.currentMarket ?? null;
  const priceToBeat = state?.priceToBeat ?? null;
  const localTrades = state?.trades ?? [];
  const analyticsTrades = state?.analyticsTrades ?? [];
  const trades = localTrades.length > 0 ? localTrades : analyticsTrades;
  const displayTrades = [...trades].sort(
    (a, b) => parseTimestamp(b.timestamp).getTime() - parseTimestamp(a.timestamp).getTime()
  );
  const wins = state?.resolvedWinCount ?? localTrades.filter((t) => t.result === "WIN").length;
  const losses = state?.resolvedLossCount ?? localTrades.filter((t) => t.result === "LOSS").length;
  const totalResolved = wins + losses;
  const livePnlFromTrades = localTrades.reduce((sum, t) => sum + (t.pnl_usdc ?? 0), 0);
  const winRate = totalResolved > 0 ? (wins / totalResolved) * 100 : 0;
  const analyticsWinRate = state?.tradeWinRatePct ?? winRate;

  const fmtUsd = (v: number | undefined | null, digits = 2) =>
    v == null ? "—" : `$${v.toFixed(digits)}`;

  const fmtSecs = (v: number | undefined | null) =>
    v == null ? "—" : formatDuration(v);

  const TRADES_PER_PAGE = 10;
  const totalPages = Math.max(1, Math.ceil(displayTrades.length / TRADES_PER_PAGE));
  const safePage = Math.min(tradesPage, totalPages - 1);
  const paginatedTrades = displayTrades.slice(
    safePage * TRADES_PER_PAGE,
    (safePage + 1) * TRADES_PER_PAGE
  );

  const startOfDayEquity =
    state?.startOfDayEquity ?? state?.initialEquity ?? state?.equity ?? 0;
  const dailyLossLimit = state?.dailyLossLimit ?? 0;
  const maxDailyLoss = startOfDayEquity * dailyLossLimit;

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#e6edf3] font-sans">
      <div className="max-w-6xl mx-auto px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-8 h-8 text-[#2dd4bf]" />
            <h1 className="text-xl font-bold text-white">Polymarket Bot Dashboard</h1>
          </div>
          <div className="flex items-center gap-3 text-sm text-[#8b949e]">
            <span className="flex items-center gap-1">
              <RefreshCw className={`w-4 h-4 ${isAutoBurst ? "animate-spin" : ""}`} />
              Updated {lastUpdated ? formatUtc(lastUpdated, "time") : "—"}
            </span>
            <button
              type="button"
              onClick={() => setIsAutoBurst(true)}
              disabled={isAutoBurst}
              className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                isAutoBurst
                  ? "border-[#30363d] text-[#6e7681] cursor-default"
                  : "border-[#30363d] text-[#e6edf3] hover:bg-[#21262d]"
              }`}
            >
              <RefreshCw className="w-3 h-3" />
              {isAutoBurst ? "Auto refresh (1s · 30s)" : "Refresh (1s · 30s)"}
            </button>
            {state?.botPaused && (
              <span className="flex items-center gap-1 text-amber-400">
                <Pause className="w-4 h-4" /> Paused
              </span>
            )}
          </div>
        </header>

        {/* Live Equity + PnL */}
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="rounded-xl bg-[#161b22] border border-[#30363d] p-5 transition-transform duration-200 hover:-translate-y-0.5">
            <p className="text-[#8b949e] text-sm mb-1">Live Equity</p>
            <p className="text-3xl font-bold text-white">
              ${(state?.equity ?? 0).toFixed(2)}
            </p>
          </div>
          <div
            className="rounded-xl bg-[#161b22] border border-[#30363d] p-5 transition-transform duration-200 hover:-translate-y-0.5"
            title="Sum of PnL from bot's local trades (this session). Use Total PnL (realized) for all-time."
          >
            <p className="text-[#8b949e] text-sm mb-1">Live PnL (session)</p>
            <p
              className={`text-3xl font-bold ${
                livePnlFromTrades >= 0 ? "text-[#2dd4bf]" : "text-[#f87171]"
              }`}
            >
              {livePnlFromTrades >= 0 ? "+" : ""}
              ${livePnlFromTrades.toFixed(2)}
            </p>
            <p className="text-xs text-[#6e7681] mt-0.5">Bot trades this session</p>
          </div>
          <div className="rounded-xl bg-[#161b22] border border-[#30363d] p-5 transition-transform duration-200 hover:-translate-y-0.5">
            <p className="text-[#8b949e] text-sm mb-1">Win rate · Resolved</p>
            <p className="text-2xl font-bold text-white">
              {analyticsWinRate.toFixed(0)}%{" "}
              <span className="text-[#8b949e] font-normal">· {totalResolved} markets</span>
            </p>
            <p className="text-xs text-[#6e7681] mt-0.5">
              {wins} wins · {losses} losses
            </p>
          </div>
        </section>

        {/* Analytics overview */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <AnalyticsCard
            label="Total PnL (realized)"
            value={fmtUsd(state?.totalRealizedPnlUsdc ?? state?.livePnl ?? 0)}
            trend={state?.totalRealizedPnlUsdc ?? state?.livePnl ?? 0}
            title="Profit/loss from closed markets (all-time)"
          />
          <AnalyticsCard
            label="Unrealized PnL"
            value={fmtUsd(state?.totalUnrealizedPnlUsdc ?? 0)}
            trend={state?.totalUnrealizedPnlUsdc ?? 0}
            title="PnL from open positions; locked in when market resolves"
          />
          <AnalyticsCard
            label="Total Volume"
            value={fmtUsd(state?.totalVolumeUsdc ?? 0, 0)}
          />
          <AnalyticsCard
            label="Current Exposure"
            value={fmtUsd(state?.currentExposureUsdc ?? 0)}
          />
        </section>

        {/* Positions / trades / streaks */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          <div className="rounded-xl bg-[#161b22] border border-[#30363d] p-4 min-w-0">
            <h2 className="text-sm font-semibold text-[#8b949e] mb-3 flex items-center gap-2">
              <PieChart className="w-4 h-4 text-[#2dd4bf]" />
              Positions & Trades
            </h2>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Stat label="Trade executions" value={String(state?.totalTrades ?? 0)} title="Individual buy/sell events from API" />
              <Stat label="Open positions" value={String(state?.openPositions ?? 0)} />
              <Stat label="Redeemable" value={String(state?.redeemablePositions ?? 0)} />
              <Stat label="Closed markets" value={String(state?.closedPositions ?? 0)} title="Markets fully closed or redeemed" />
              <Stat label="Trades/day" value={(state?.tradesPerDay ?? 0).toFixed(2)} />
              <Stat label="Trades/week" value={(state?.tradesPerWeek ?? 0).toFixed(2)} />
            </div>
            <div className="mt-3 pt-3 border-t border-[#21262d] space-y-1.5 text-xs text-[#6e7681]">
              <div className="flex justify-between">
                <span>Start-of-day equity</span>
                <span className="text-white font-mono">
                  {fmtUsd(startOfDayEquity)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>
                  Max daily loss ({(dailyLossLimit * 100).toFixed(0)}
                  %)
                </span>
                <span className="text-white font-mono">
                  {fmtUsd(maxDailyLoss)}
                </span>
              </div>
              <div className="flex justify-between" title="USDC allowance for CLOB; refreshed hourly">
                <span>CLOB spending approval</span>
                <span className="text-white font-mono">
                  {fmtUsd(state?.clobSpendingApprovalUsdc)}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-[#161b22] border border-[#30363d] p-4">
            <h2 className="text-sm font-semibold text-[#8b949e] mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#2dd4bf]" />
              Best & Worst Markets
            </h2>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#8b949e] flex items-center gap-1 shrink-0">
                  <ArrowUpRight className="w-3 h-3 text-[#2dd4bf]" /> Best
                </span>
                <span className="text-right text-white font-mono truncate min-w-0" title={state?.largestMarketProfitSlug ?? undefined}>
                  {state?.largestMarketProfitSlug ?? "—"}
                </span>
                <span className="text-right text-[#2dd4bf] font-mono shrink-0">
                  {fmtUsd(state?.largestMarketProfitUsdc ?? 0)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#8b949e] flex items-center gap-1 shrink-0">
                  <ArrowDownRight className="w-3 h-3 text-[#f87171]" /> Worst
                </span>
                <span className="text-right text-white font-mono truncate min-w-0" title={state?.largestMarketLossSlug ?? undefined}>
                  {state?.largestMarketLossSlug ?? "—"}
                </span>
                <span className="text-right text-[#f87171] font-mono shrink-0">
                  {fmtUsd(state?.largestMarketLossUsdc ?? 0)}
                </span>
              </div>
              <div className="mt-2 space-y-1 text-xs text-[#6e7681]">
                <div>
                  Longest win streak:{" "}
                  <span className="text-white font-mono">{state?.longestWinStreakTrades ?? 0}</span>{" "}
                  trades
                </div>
                <div>
                  Longest loss streak:{" "}
                  <span className="text-white font-mono">{state?.longestLossStreakTrades ?? 0}</span>{" "}
                  trades
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-[#161b22] border border-[#30363d] p-4">
            <h2 className="text-sm font-semibold text-[#8b949e] mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#2dd4bf]" />
              Redemption & Flow
            </h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[#8b949e]">Total redeemed</span>
                <span className="text-white font-mono">
                  {fmtUsd(state?.totalRedeemedUsdc ?? 0, 2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8b949e]">Unredeemed value</span>
                <span className="text-white font-mono">
                  {fmtUsd(state?.unredeemedValueUsdc ?? 0, 2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8b949e]">Avg redemption lag</span>
                <span className="text-white font-mono">
                  {fmtSecs(state?.avgRedemptionLagSecs)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8b949e]">Max redemption lag</span>
                <span className="text-white font-mono">
                  {fmtSecs(state?.maxRedemptionLagSecs)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8b949e]">Holding time min</span>
                <span className="text-white font-mono">
                  {fmtSecs(state?.minHoldingTimeSecs)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8b949e]">Holding time max</span>
                <span className="text-white font-mono">
                  {fmtSecs(state?.maxHoldingTimeSecs)}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Equity Curve — cumulative PnL over time */}
        <section
          className="rounded-xl bg-[#161b22] border border-[#30363d] p-4 mb-6"
          title="Cumulative equity: start + each trade's PnL in order. Uses bot trades or API closed positions."
        >
          <h2 className="text-sm font-semibold text-[#8b949e] mb-3 flex flex-wrap items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[#2dd4bf]" />
            Equity Curve
            {state?.initialEquity != null && state.initialEquity > 0 && (
              <span className="text-xs font-mono text-[#6e7681]">
                Starting: ${state.initialEquity.toFixed(2)}
              </span>
            )}
            <span className="text-xs font-normal text-[#6e7681]">
              Drag to pan · Scroll to zoom · Full history
            </span>
          </h2>
          <div className="h-64 sm:h-72 min-h-[280px]">
            <EquityChart
              trades={trades}
              stateEquity={state?.equity ?? 0}
              livePnl={
                localTrades.length > 0
                  ? (state?.livePnl ?? 0)
                  : (state?.totalRealizedPnlUsdc ?? state?.livePnl ?? 0)
              }
              initialEquity={state?.initialEquity}
              updatedAt={state?.updatedAt ?? new Date().toISOString()}
              uptimeSeconds={state?.uptimeSeconds ?? 0}
            />
          </div>
        </section>

        {/* Current Market + Live prices */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6">
          <section className="rounded-xl bg-[#161b22] border border-[#30363d] p-4">
            <h2 className="text-sm font-semibold text-[#8b949e] mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#2dd4bf]" />
              Current Market
            </h2>
            {market ? (
              <div className="space-y-2">
                <p className="text-white font-mono text-sm break-all">{market.slug}</p>
                <p className="text-[#8b949e] text-sm">
                  {market.seconds_elapsed}s elapsed · {market.seconds_remaining}s left
                </p>
                {priceToBeat != null && priceToBeat > 0 && (
                  <p className="text-sm">
                    <span className="text-[#8b949e]">Price to beat: </span>
                    <span className="text-white font-mono font-medium">${priceToBeat.toFixed(2)}</span>
                  </p>
                )}
                <a
                  href={`https://polymarket.com/event/${market.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[#2dd4bf] hover:underline text-sm"
                >
                  Open on Polymarket <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            ) : (
              <p className="text-[#6e7681] text-sm">No active market.</p>
            )}
          </section>

          <section className="rounded-xl bg-[#161b22] border border-[#30363d] p-4 min-w-0">
            <h2 className="text-sm font-semibold text-[#8b949e] mb-3">Live prices</h2>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 text-sm">
              <PriceRow label="YES" value={state?.yesPrice} priceToBeat={priceToBeat} />
              <PriceRow label="NO" value={state?.noPrice} priceToBeat={priceToBeat} />
              <PriceRow
                label="Chainlink"
                value={state?.chainlinkBtcPrice}
                priceToBeat={priceToBeat}
                isBtc
              />
              <PriceRow
                label="Binance"
                value={state?.btcPrice}
                priceToBeat={priceToBeat}
                isBtc
              />
            </div>
          </section>
        </div>

        {/* Uptime stats */}
        <section className="rounded-xl bg-[#161b22] border border-[#30363d] p-4 mb-6">
          <h2 className="text-sm font-semibold text-[#8b949e] mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#2dd4bf]" />
            Uptime
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 text-sm">
            <Stat label="Total uptime" value={formatDuration(state?.uptimeSeconds ?? 0)} />
            <Stat label="Paused" value={formatDuration(state?.pausedSeconds ?? 0)} />
            <Stat label="RTDS stale" value={formatDuration(state?.totalRtdsDownSeconds ?? 0)} />
            <Stat label="No market" value={formatDuration(state?.totalNoMarketSeconds ?? 0)} />
          </div>
          {state?.rtdsStale && (
            <p className="mt-2 flex items-center gap-1 text-amber-400 text-sm">
              <WifiOff className="w-4 h-4" /> RTDS currently stale
            </p>
          )}
        </section>

        {/* Decision log (Take / Skip / Error) */}
        <section className="rounded-xl bg-[#161b22] border border-[#30363d] overflow-hidden mb-6">
          <h2 className="text-sm font-semibold text-[#8b949e] p-4 pb-2 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-[#2dd4bf]" />
            Decision log
          </h2>
          <div className="px-4 pb-4 max-h-80 overflow-y-auto">
            {(() => {
              const raw = state?.decisionLog;
              const entries = (Array.isArray(raw) ? raw : []).filter(
                (e): e is DecisionLogEntry =>
                  e != null && typeof e === "object" && "kind" in e && "reason" in e
              );
              const takes = entries.filter((e) => e.kind === "take");
              const skips = entries.filter((e) => e.kind === "skip");
              const errors = entries.filter((e) => e.kind === "error");
              const total = takes.length + skips.length + errors.length;
              if (total === 0) {
                return (
                  <p className="text-[#6e7681] text-sm py-2">No decisions yet this session.</p>
                );
              }
              const byTsDesc = (a: DecisionLogEntry, b: DecisionLogEntry) =>
                parseTimestamp(b.ts).getTime() - parseTimestamp(a.ts).getTime();
              return (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="min-w-0">
                    <DecisionEntryList items={[...takes].sort(byTsDesc)} title="Take" />
                  </div>
                  <div className="min-w-0">
                    <DecisionEntryList items={[...skips].sort(byTsDesc)} title="Skip" />
                  </div>
                  <div className="min-w-0">
                    <DecisionEntryList items={[...errors].sort(byTsDesc)} title="Error" />
                  </div>
                </div>
              );
            })()}
          </div>
        </section>

        {/* Trades */}
        <section className="rounded-xl bg-[#161b22] border border-[#30363d] overflow-hidden mb-6">
          <div className="flex flex-wrap items-center justify-between gap-2 p-4 pb-2">
            <h2 className="text-sm font-semibold text-[#8b949e]">
              {localTrades.length > 0 ? "Bot trades" : "Closed markets (from API)"} — newest first, UTC
            </h2>
            {displayTrades.length > TRADES_PER_PAGE && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[#6e7681]">
                  Page {safePage + 1} of {totalPages} ({displayTrades.length} total)
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setTradesPage((p) => Math.max(0, p - 1))}
                    disabled={safePage === 0}
                    className="px-2 py-1 rounded border border-[#30363d] bg-[#21262d] text-[#e6edf3] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#30363d]"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    onClick={() => setTradesPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={safePage >= totalPages - 1}
                    className="px-2 py-1 rounded border border-[#30363d] bg-[#21262d] text-[#e6edf3] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#30363d]"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-[#8b949e] border-b border-[#30363d]">
                  <th className="text-left py-3 px-4">Date & Time (UTC)</th>
                  <th className="text-left py-3 px-4">Market</th>
                  <th className="text-left py-3 px-4">Side</th>
                  <th className="text-right py-3 px-4">Entry</th>
                  <th className="text-right py-3 px-4">Size</th>
                  <th className="text-left py-3 px-4">Result</th>
                  <th className="text-left py-3 px-4">Collected</th>
                  <th className="text-right py-3 px-4">PnL</th>
                  <th className="text-left py-3 px-4 max-w-[120px] truncate">Reason</th>
                </tr>
              </thead>
              <tbody>
                {paginatedTrades.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-[#6e7681]">
                      No trades yet.
                    </td>
                  </tr>
                ) : (
                  paginatedTrades.map((t, i) => (
                    <tr key={`${t.timestamp}-${t.slug}-${i}`} className="border-b border-[#21262d] hover:bg-[#21262d]/50">
                      <td className="py-2 px-4 text-[#e6edf3] whitespace-nowrap" title={formatUtc(parseTimestamp(t.timestamp), "datetime")}>
                        {formatUtc(parseTimestamp(t.timestamp), "datetime")}
                      </td>
                      <td className="py-2 px-4 font-mono text-sm truncate max-w-[140px]" title={t.slug}>
                        {t.slug}
                      </td>
                      <td className="py-2 px-4 font-mono">{t.side}</td>
                      <td className="py-2 px-4 text-right">${t.entry_price.toFixed(2)}</td>
                      <td className="py-2 px-4 text-right">${t.size_usdc.toFixed(2)}</td>
                      <td className="py-2 px-4">
                        <ResultBadge result={t.result} />
                      </td>
                      <td className="py-2 px-4">
                        {t.redeemed ? (
                          <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-[#2dd4bf]/20 text-[#2dd4bf]">
                            Collected
                          </span>
                        ) : t.result === "PENDING" ? (
                          <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-[#6e7681]/20 text-[#8b949e]">
                            Pending
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-[#6e7681]/20 text-[#8b949e]">
                            Not collected
                          </span>
                        )}
                      </td>
                      <td
                        className={`py-2 px-4 text-right font-medium ${
                          t.pnl_usdc >= 0 ? "text-[#2dd4bf]" : "text-[#f87171]"
                        }`}
                      >
                        {t.pnl_usdc >= 0 ? "+" : ""}${t.pnl_usdc.toFixed(2)}
                      </td>
                      <td className="py-2 px-4 text-[#8b949e] max-w-[120px] truncate" title={t.reason}>
                        {t.reason || "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <p className="text-center text-[#6e7681] text-xs">
          Auto-refresh in bursts (1s × 30s) · Last updated {lastUpdated ? formatUtc(lastUpdated, "datetime") : "—"}
        </p>
      </div>
    </div>
  );
}

function PriceRow({
  label,
  value,
  priceToBeat,
  isBtc,
}: {
  label: string;
  value: number | undefined | null;
  priceToBeat: number | null;
  isBtc?: boolean;
}) {
  const num = value ?? 0;
  const beat = priceToBeat ?? 0;
  const diff = isBtc && beat ? num - beat : 0;
  return (
    <div className="flex justify-between items-center py-1.5 sm:py-2 gap-2 min-w-0">
      <span className="text-[#8b949e] shrink-0">{label}</span>
      <span className="text-white font-mono text-right break-all min-w-0">
        {isBtc ? `$${num.toFixed(2)}` : num.toFixed(4)}
        {isBtc && beat !== 0 && (
          <span className={`ml-1 shrink-0 ${diff >= 0 ? "text-[#2dd4bf]" : "text-[#f87171]"}`}>
            ({diff >= 0 ? "+" : ""}${diff.toFixed(2)})
          </span>
        )}
      </span>
    </div>
  );
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div title={title}>
      <span className="text-[#8b949e]">{label}: </span>
      <span className="text-white font-mono">{value}</span>
    </div>
  );
}

function ResultBadge({ result }: { result: string }) {
  const style =
    result === "WIN"
      ? "bg-[#2dd4bf]/20 text-[#2dd4bf]"
      : result === "LOSS"
        ? "bg-[#f87171]/20 text-[#f87171]"
        : "bg-[#6e7681]/20 text-[#8b949e]";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${style}`}>
      {result}
    </span>
  );
}

function DecisionKindBadge({ kind }: { kind: "take" | "skip" | "error" }) {
  const style =
    kind === "take"
      ? "bg-[#2dd4bf]/20 text-[#2dd4bf]"
      : kind === "skip"
        ? "bg-amber-500/20 text-amber-400"
        : "bg-[#f87171]/20 text-[#f87171]";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium shrink-0 ${style}`}>
      {kind.toUpperCase()}
    </span>
  );
}

function AnalyticsCard({
  label,
  value,
  trend,
  title,
}: {
  label: string;
  value: string;
  trend?: number;
  title?: string;
}) {
  const isPositive = trend != null && trend >= 0;
  const trendIcon =
    trend == null ? null : isPositive ? (
      <ArrowUpRight className="w-3 h-3 text-[#2dd4bf]" />
    ) : (
      <ArrowDownRight className="w-3 h-3 text-[#f87171]" />
    );
  return (
    <div
      className="rounded-xl bg-[#161b22] border border-[#30363d] p-4 transition-transform duration-200 hover:-translate-y-0.5"
      title={title}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-[#8b949e]">{label}</span>
        {trendIcon}
      </div>
      <p className="mt-2 text-xl font-semibold text-white">{value}</p>
    </div>
  );
}

function DecisionEntryList({
  items,
  title,
}: {
  items: DecisionLogEntry[];
  title: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-4 last:mb-0">
      <h3 className="text-xs font-medium text-[#6e7681] uppercase tracking-wider mb-2">
        {title} ({items.length})
      </h3>
      <ul className="space-y-1.5 text-sm">
        {items.map((e, i) => (
          <li
            key={`${e.ts}-${i}`}
            className="flex flex-wrap items-baseline gap-2 py-1.5 border-b border-[#21262d] last:border-0"
          >
            <span className="text-[#6e7681] shrink-0" title={formatUtc(parseTimestamp(e.ts), "datetime")}>
              {formatUtc(parseTimestamp(e.ts), "datetime")}
            </span>
            <DecisionKindBadge kind={e.kind} />
            <span className="text-[#e6edf3]">{e.reason}</span>
            {e.side != null && (
              <span className="text-[#8b949e] font-mono text-xs">
                {e.side}
                {e.price != null && ` @ ${e.price.toFixed(2)}`}
                {e.size_usdc != null && ` · $${e.size_usdc.toFixed(2)}`}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
