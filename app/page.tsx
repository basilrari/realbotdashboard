"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
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
      day: "2-digit",
      month: "short",
    }).format(date);
  }
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

/** Normalise side labels across sources (local trades vs Data API). */
function normalizeSide(raw: string | undefined | null): string {
  if (!raw) return "";
  const s = raw.toUpperCase();
  if (s === "UP") return "YES";
  if (s === "DOWN") return "NO";
  return s;
}

/** Parse timestamp (ISO string or unix seconds) to Date. */
function parseTimestamp(ts: string | number | undefined | null): Date {
  if (ts == null) return new Date(NaN);
  if (typeof ts === "number") return new Date(ts * 1000);
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

/** Format seconds as compact duration: s, m s, h m s, d h, or w d. Fits in UI and mobile. */
function formatDuration(sec: number): string {
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor((sec / 3600) % 24);
  const d = Math.floor(sec / 86400) % 7;
  const w = Math.floor(sec / 604800);
  if (w > 0) {
    return d > 0 ? `${w}w ${d}d` : `${w}w`;
  }
  if (d > 0) {
    return h > 0 ? `${d}d ${h}h` : `${d}d`;
  }
  if (h > 0) {
    const parts = [`${h}h`];
    if (m > 0) parts.push(`${m}m`);
    if (s > 0) parts.push(`${s}s`);
    return parts.join(" ");
  }
  if (m > 0) {
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  return `${s}s`;
}

/** Pretty-print latency in µs using backend ms values (e.g. 4µs, 25µs, 1 200µs). */
function formatLatencyUs(v: number | undefined | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const us = v * 1000; // backend gives ms as f64
  if (us < 0.5) return "<1µs";
  if (us < 10) return `${us.toFixed(2)}µs`;
  if (us < 100) return `${us.toFixed(1)}µs`;
  if (us < 1000) return `${us.toFixed(0)}µs`;
  // For >= 1ms, still show in µs but with a thin space for readability
  if (us < 10_000) return `${(us / 1000).toFixed(2)}ms`;
  if (us < 100_000) return `${(us / 1000).toFixed(1)}ms`;
  return `${(us / 1000).toFixed(0)}ms`;
}

/** Start equity for the chart (111.80 based on initial investment). */
const CHART_START_EQUITY = 111.8;

/** Build chart data from resolved trades only (WIN/LOSS). */
function buildChartData(trades: TradeRecord[]): { data: LineData[]; ath: number } {
  const startEquity = CHART_START_EQUITY;
  const nowSec = Math.floor(Date.now() / 1000);
  const resolved = trades.filter(
    (t) => t.result === "WIN" || t.result === "LOSS"
  );
  const sorted = [...resolved].sort(
    (a, b) => parseTimestamp(a.timestamp).getTime() - parseTimestamp(b.timestamp).getTime()
  );
  const out: LineData[] = [];
  let running = startEquity;
  let ath = startEquity;
  if (sorted.length === 0) {
    out.push({ time: (nowSec - 1) as UTCTimestamp, value: startEquity });
    out.push({ time: nowSec as UTCTimestamp, value: startEquity });
  } else {
    const firstTs = Math.floor(parseTimestamp(sorted[0].timestamp).getTime() / 1000);
    out.push({ time: (firstTs - 1) as UTCTimestamp, value: startEquity });
    for (const t of sorted) {
      const p = Number(t.pnl_usdc);
      if (!Number.isFinite(p)) continue;
      running += p;
      if (running > ath) ath = running;
      const ts = Math.floor(parseTimestamp(t.timestamp).getTime() / 1000);
      if (!Number.isFinite(running) || !Number.isFinite(ts)) continue;
      out.push({ time: ts as UTCTimestamp, value: running });
    }
    if (out[out.length - 1].time !== nowSec) {
      out.push({ time: nowSec as UTCTimestamp, value: running });
    }
  }
  const valid = out.filter((d) => d != null && Number.isFinite(d.value) && d.time != null);
  const seen = new Map<number, LineData>();
  for (const d of valid) {
    seen.set(d.time as number, d);
  }
  const data = [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([, d]) => d);
  const maxVal = data.length ? Math.max(...data.map((d) => d.value as number)) : startEquity;
  return { data, ath: Math.max(ath, maxVal) };
}

const CHART_UPDATE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export type EquityChartHandle = { resetView: () => void };

/** TradingView-style equity chart: scroll (drag) and zoom (mouse wheel). Preserves user position; updates at most every 5 min or when market changes. */
const EquityChart = forwardRef<EquityChartHandle, {
  trades: TradeRecord[];
  updatedAt: string;
  uptimeSeconds: number;
  marketSlug?: string | null;
}>(function EquityChart(
  { trades, updatedAt, uptimeSeconds, marketSlug },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const athSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const lastApplyRef = useRef<number>(0);
  const lastMarketSlugRef = useRef<string | null>(null);
  const firstFitDoneRef = useRef(false);

  useImperativeHandle(ref, () => ({
    resetView() {
      if (chartRef.current) {
        chartRef.current.timeScale().fitContent();
      }
    },
  }), []);

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
      athSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;

    const now = Date.now();
    const slug = marketSlug ?? null;
    const shouldUpdate =
      lastApplyRef.current === 0 ||
      now - lastApplyRef.current >= CHART_UPDATE_INTERVAL_MS ||
      lastMarketSlugRef.current !== slug;

    if (!shouldUpdate) return;

    lastApplyRef.current = now;
    lastMarketSlugRef.current = slug;

    const { data, ath } = buildChartData(trades);
    if (data.length < 2) {
      const fallback = [
        { time: Math.floor(Date.now() / 1000) as UTCTimestamp, value: CHART_START_EQUITY },
        { time: (Math.floor(Date.now() / 1000) + 1) as UTCTimestamp, value: CHART_START_EQUITY },
      ];
      series.setData(fallback);
      if (athSeriesRef.current) {
        athSeriesRef.current.setData([
          { time: fallback[0].time, value: CHART_START_EQUITY },
          { time: fallback[1].time, value: CHART_START_EQUITY },
        ]);
      }
    } else {
      series.setData(data);
      const athData: LineData[] = [
        { time: data[0].time, value: ath },
        { time: data[data.length - 1].time, value: ath },
      ];
      if (!athSeriesRef.current) {
        const athSeries = chart.addSeries(LineSeries, {
          color: "rgba(251, 191, 36, 0.8)",
          lineWidth: 1,
          lineStyle: 2,
          priceFormat: { type: "price", precision: 2, minMove: 0.01 },
        });
        athSeriesRef.current = athSeries as ISeriesApi<"Line">;
      }
      athSeriesRef.current.setData(athData);
    }

    if (!firstFitDoneRef.current) {
      chart.timeScale().fitContent();
      firstFitDoneRef.current = true;
    }
  }, [trades, updatedAt, uptimeSeconds, marketSlug]);

  return <div ref={containerRef} className="w-full h-full min-h-[280px]" />;
});

export default function DashboardPage() {
  const [state, setState] = useState<LiveState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isAutoBurst, setIsAutoBurst] = useState<boolean>(false);
  const [tradesPage, setTradesPage] = useState(0);
  const equityChartRef = useRef<EquityChartHandle>(null);

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
  // Merge both sources: prefer Polymarket/analytics PnL when both exist (Phase 1).
  // Match by slug+side (analytics = one per closed position; local = one per execution).
  const tradesMerged = (() => {
    const bySlugSide = new Map<string, (typeof localTrades)[0]>();
    for (const t of localTrades) {
      const sideNorm = normalizeSide(t.side);
      bySlugSide.set(`${t.slug}\t${sideNorm}`, { ...t, side: sideNorm });
    }
    for (const t of analyticsTrades) {
      const sideNorm = normalizeSide((t as any).side);
      const key = `${(t as any).slug}\t${sideNorm}`;
      bySlugSide.set(key, { ...(t as (typeof localTrades)[0]), side: sideNorm });
    }
    return Array.from(bySlugSide.values());
  })();
  const trades = tradesMerged;
  const displayTrades = [...trades].sort(
    (a, b) => parseTimestamp(b.timestamp).getTime() - parseTimestamp(a.timestamp).getTime()
  );
  const wins = state?.resolvedWinCount ?? localTrades.filter((t) => t.result === "WIN").length;
  const losses = state?.resolvedLossCount ?? localTrades.filter((t) => t.result === "LOSS").length;
  const totalResolved = wins + losses;
  const winRate = totalResolved > 0 ? (wins / totalResolved) * 100 : 0;
  const analyticsWinRate = state?.tradeWinRatePct ?? winRate;

  const fmtUsd = (v: number | undefined | null, digits = 2) =>
    v == null ? "—" : `$${v.toFixed(digits)}`;

  const fmtSecs = (v: number | undefined | null) =>
    v == null ? "—" : formatDuration(v);

  const realizedPnlAllTime = state?.totalRealizedPnlUsdc ?? state?.livePnl ?? 0;
  const otherAdjustments =
    (state?.equity ?? 0) - (CHART_START_EQUITY + realizedPnlAllTime);

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
  const maxDailyLoss = state?.lossLimitMaxUsdc ?? startOfDayEquity * dailyLossLimit;
  const lossLimitUsed = state?.lossLimitUsedUsdc ?? 0;
  const lossLimitResetAt = state?.lossLimitResetAt ?? null;

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#e6edf3] font-sans">
      <div className="max-w-6xl mx-auto px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-8 h-8 text-[#2dd4bf]" />
            <h1 className="text-xl font-bold text-white">Polymarket Bot Dashboard</h1>
          </div>
          <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2 sm:gap-3 text-sm text-[#8b949e]">
            <span className="flex items-center gap-1">
              <RefreshCw className={`w-4 h-4 ${isAutoBurst ? "animate-spin" : ""}`} />
              Updated {lastUpdated ? formatUtc(lastUpdated, "time") : "—"}
            </span>
            {state?.botPaused && (
              <span
                className="inline-flex items-center justify-center rounded-full border border-amber-500/60 bg-amber-500/10 text-amber-400 px-2 py-1"
                title="Bot is paused"
              >
                <Pause className="w-3 h-3" />
              </span>
            )}
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
          </div>
        </header>

        {/* Live Equity + Risk + Win rate */}
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="rounded-xl bg-[#161b22] border border-[#30363d] p-5 transition-transform duration-200 hover:-translate-y-0.5">
            <p className="text-[#8b949e] text-sm mb-1">Live Equity</p>
            <p className="text-3xl font-bold text-white">
              ${(state?.equity ?? 0).toFixed(2)}
            </p>
            <p className="text-xs text-[#6e7681] mt-0.5">
              Start equity:&nbsp;
              <span className="text-white font-mono">${CHART_START_EQUITY.toFixed(2)}</span>
            </p>
            <p className="text-xs text-[#6e7681] mt-0.5">
              Open positions and fees:&nbsp;
              <span
                className={`font-mono ${
                  otherAdjustments >= 0 ? "text-[#2dd4bf]" : "text-[#f87171]"
                }`}
              >
                {otherAdjustments >= 0 ? "+" : "-"}
                {fmtUsd(Math.abs(otherAdjustments))}
              </span>
            </p>
          </div>
          <div
            className="rounded-xl bg-[#161b22] border border-[#30363d] p-5 transition-transform duration-200 hover:-translate-y-0.5"
            title="33% loss limit per 8h UTC window. Shows how much of the cap is used."
          >
            <p className="text-[#8b949e] text-sm mb-1">Risk guard · 33% loss limit</p>
            <p className="text-3xl font-bold text-white">
              {maxDailyLoss > 0 ? `${((lossLimitUsed / maxDailyLoss) * 100).toFixed(1)}%` : "0%"}
            </p>
            <p className="text-xs text-[#6e7681] mt-0.5">
              Used{" "}
              <span className="text-white font-mono">
                {fmtUsd(lossLimitUsed)} / {fmtUsd(maxDailyLoss)}
              </span>
            </p>
          </div>
          <div className="rounded-xl bg-[#161b22] border border-[#30363d] p-5 transition-transform duration-200 hover:-translate-y-0.5">
            <p className="text-[#8b949e] text-sm mb-1">Win rate · Resolved trades</p>
            <p className="text-2xl font-bold text-white">
              {analyticsWinRate.toFixed(0)}%{" "}
              <span className="text-[#8b949e] font-normal">· {totalResolved} trades</span>
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
            <div className="grid grid-cols-4 gap-x-4 gap-y-2 text-sm items-baseline">
              <div className="col-span-2 flex justify-between items-baseline gap-2" title="Individual buy/sell events from API">
                <span className="text-[#8b949e] shrink-0">Trade executions:</span>
                <span className="text-white font-mono tabular-nums">{state?.totalTrades ?? 0}</span>
              </div>
              <div className="col-span-2 flex justify-between items-baseline gap-2">
                <span className="text-[#8b949e] shrink-0">Open positions:</span>
                <span className="text-white font-mono tabular-nums">{state?.openPositions ?? 0}</span>
              </div>
              <div className="col-span-2 flex justify-between items-baseline gap-2">
                <span className="text-[#8b949e] shrink-0">Redeemable:</span>
                <span className="text-white font-mono tabular-nums">{state?.redeemablePositions ?? 0}</span>
              </div>
              <div className="col-span-2 flex justify-between items-baseline gap-2" title="Markets fully closed or redeemed">
                <span className="text-[#8b949e] shrink-0">Closed markets:</span>
                <span className="text-white font-mono tabular-nums">{state?.closedPositions ?? 0}</span>
              </div>
              <div className="col-span-2 flex justify-between items-baseline gap-2">
                <span className="text-[#8b949e] shrink-0">Trades/day:</span>
                <span className="text-white font-mono tabular-nums">{(state?.tradesPerDay ?? 0).toFixed(2)}</span>
              </div>
              <div className="col-span-2 flex justify-between items-baseline gap-2">
                <span className="text-[#8b949e] shrink-0">Trades/week:</span>
                <span className="text-white font-mono tabular-nums">{(state?.tradesPerWeek ?? 0).toFixed(2)}</span>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-[#21262d] space-y-1.5 text-xs text-[#6e7681]">
              <div className="flex justify-between items-baseline gap-2" title="Equity when the current 8h loss window started">
                <span className="shrink-0">Window-start equity (8h)</span>
                <span className="text-white font-mono tabular-nums">{fmtUsd(startOfDayEquity)}</span>
              </div>
              <div className="flex justify-between items-baseline gap-2" title="When the current 8h loss-limit window started">
                <span className="shrink-0">Last reset (UTC)</span>
                <span className="text-white font-mono break-all text-right">
                  {lossLimitResetAt
                    ? `${formatUtc(parseTimestamp(lossLimitResetAt), "date")} ${formatUtc(
                        parseTimestamp(lossLimitResetAt),
                        "time",
                      )}`
                    : "—"}
                </span>
              </div>
              <div className="flex justify-between items-baseline gap-2" title="USDC allowance for CLOB; refreshed hourly">
                <span className="shrink-0">CLOB spending approval</span>
                <span className="text-white font-mono tabular-nums">{fmtUsd(state?.clobSpendingApprovalUsdc)}</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-[#161b22] border border-[#30363d] p-4">
            <h2 className="text-sm font-semibold text-[#8b949e] mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#2dd4bf]" />
              Best & Worst Trades
            </h2>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#8b949e] flex items-center gap-1 shrink-0">
                  <ArrowUpRight className="w-3 h-3 text-[#2dd4bf]" /> Best
                </span>
                <span className="ml-auto text-right text-[#2dd4bf] font-mono shrink-0">
                  {fmtUsd(state?.largestMarketProfitUsdc ?? 0)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#8b949e] flex items-center gap-1 shrink-0">
                  <ArrowDownRight className="w-3 h-3 text-[#f87171]" /> Worst
                </span>
                <span className="ml-auto text-right text-[#f87171] font-mono shrink-0">
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
                <div>
                  Current win streak:{" "}
                  <span className="text-white font-mono">
                    {state?.currentWinStreakTrades ?? 0}
                  </span>{" "}
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

        {/* Bot performance — hot path latency */}
        <section className="rounded-xl bg-[#161b22] border border-[#30363d] p-4 mb-6">
          <h2 className="text-sm font-semibold text-[#8b949e] mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#2dd4bf]" />
            Bot performance
          </h2>
          <p className="text-xs text-[#6e7681] mb-3">
            Hot-path latency from orderbook update to trading decision (lower is better). p50 = median, p95 = 95th percentile, p99 = 99th percentile.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div className="flex items-center justify-between rounded-lg bg-[#0d1117]/60 px-3 py-2">
              <span className="text-white font-mono tabular-nums">
                {formatLatencyUs(state?.hotPathP50Ms)}
              </span>
              <span className="text-[#8b949e] text-xs sm:text-sm">p50 (median)</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-[#0d1117]/60 px-3 py-2">
              <span className="text-white font-mono tabular-nums">
                {formatLatencyUs(state?.hotPathP95Ms)}
              </span>
              <span className="text-[#8b949e] text-xs sm:text-sm">p95</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-[#0d1117]/60 px-3 py-2">
              <span className="text-white font-mono tabular-nums">
                {formatLatencyUs(state?.hotPathP99Ms)}
              </span>
              <span className="text-[#8b949e] text-xs sm:text-sm">p99</span>
            </div>
          </div>
          <p className="text-xs text-[#6e7681] mt-2">
            Latency stats refreshed every 30 min on the bot. Dashboard last updated: {state?.updatedAt ? formatUtc(new Date(state.updatedAt), "datetime") : "—"}
          </p>
        </section>

        {/* Equity Curve — cumulative PnL over time */}
        <section
          className="rounded-xl bg-[#161b22] border border-[#30363d] p-4 mb-6"
          title="Cumulative equity: start + each trade's PnL in order. Uses bot trades or API closed positions."
        >
          <h2 className="text-sm font-semibold text-[#8b949e] mb-3 flex flex-wrap items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[#2dd4bf]" />
            Equity Curve
            <span className="text-xs font-mono text-[#6e7681]">
              Resolved only · Amber line = ATH · Excludes fees paid
            </span>
            <span className="text-xs font-normal text-[#6e7681]">
              Drag to pan · Scroll to zoom
            </span>
            <button
              type="button"
              onClick={() => equityChartRef.current?.resetView()}
              className="ml-auto text-xs px-2 py-1 rounded bg-[#21262d] text-[#8b949e] hover:bg-[#30363d] hover:text-[#e6edf3] border border-[#30363d]"
            >
              Reset chart
            </button>
          </h2>
          <div className="h-64 sm:h-72 min-h-[280px]">
            <EquityChart
              ref={equityChartRef}
              trades={trades}
              updatedAt={state?.updatedAt ?? new Date().toISOString()}
              uptimeSeconds={state?.uptimeSeconds ?? 0}
              marketSlug={state?.currentMarket?.slug}
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
            <div className="flex flex-col gap-3 text-sm min-w-0">
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center gap-3 min-w-0">
                  <span className="text-[#8b949e] shrink-0 w-16">YES</span>
                  <span className="text-white font-mono text-right tabular-nums break-all">
                    {state?.yesPrice != null ? state.yesPrice.toFixed(4) : "—"}
                  </span>
                </div>
                <div className="flex justify-between items-center gap-3 min-w-0">
                  <span className="text-[#8b949e] shrink-0 w-16">NO</span>
                  <span className="text-white font-mono text-right tabular-nums break-all">
                    {state?.noPrice != null ? state.noPrice.toFixed(4) : "—"}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
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
            </div>
          </section>
        </div>

        {/* Uptime stats */}
        <section className="rounded-xl bg-[#161b22] border border-[#30363d] p-4 mb-6">
          <h2 className="text-sm font-semibold text-[#8b949e] mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#2dd4bf]" />
            Uptime
          </h2>
          <div className="grid grid-cols-4 gap-x-4 gap-y-2 text-sm items-baseline">
            <div className="col-span-2 flex justify-between items-baseline gap-2">
              <span className="text-[#8b949e] shrink-0">Total uptime:</span>
              <span className="text-white font-mono tabular-nums">{formatDuration(state?.uptimeSeconds ?? 0)}</span>
            </div>
            <div className="col-span-2 flex justify-between items-baseline gap-2">
              <span className="text-[#8b949e] shrink-0">Paused:</span>
              <span className="text-white font-mono tabular-nums">{formatDuration(state?.pausedSeconds ?? 0)}</span>
            </div>
            <div className="col-span-2 flex justify-between items-baseline gap-2">
              <span className="text-[#8b949e] shrink-0">RTDS stale:</span>
              <span className="text-white font-mono tabular-nums">{formatDuration(state?.totalRtdsDownSeconds ?? 0)}</span>
            </div>
            <div className="col-span-2 flex justify-between items-baseline gap-2">
              <span className="text-[#8b949e] shrink-0">No market:</span>
              <span className="text-white font-mono tabular-nums">{formatDuration(state?.totalNoMarketSeconds ?? 0)}</span>
            </div>
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
              Trades — newest first, UTC
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
          <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-[#8b949e] border-b border-[#30363d]">
                  <th className="text-left py-3 px-3 sm:px-4 w-[190px]">Date & Time (UTC)</th>
                  <th className="text-left py-3 px-3 sm:px-4 w-[70px]">Side</th>
                  <th className="text-right py-3 px-3 sm:px-4 w-[80px]">Entry</th>
                  <th className="text-right py-3 px-3 sm:px-4 w-[90px]">Size</th>
                  <th className="text-left py-3 px-3 sm:px-4 w-[110px]">Result</th>
                  <th className="text-left py-3 px-3 sm:px-4 w-[170px]">Collected</th>
                  <th className="text-right py-3 px-3 sm:px-4 w-[90px]">PnL</th>
                </tr>
              </thead>
              <tbody>
                {paginatedTrades.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-[#6e7681] px-3 sm:px-4">
                      No trades yet.
                    </td>
                  </tr>
                ) : (
                  paginatedTrades.map((t, i) => (
                    <tr key={`${t.timestamp}-${t.slug}-${i}`} className="border-b border-[#21262d] hover:bg-[#21262d]/50">
                      <td className="py-2.5 px-3 sm:px-4 text-[#e6edf3] whitespace-nowrap w-[190px]" title={formatUtc(parseTimestamp(t.timestamp), "datetime")}>
                        {formatUtc(parseTimestamp(t.timestamp), "datetime")}
                      </td>
                      <td className="py-2.5 px-3 sm:px-4 font-mono w-[70px] whitespace-nowrap">
                        {t.side}
                      </td>
                      <td className="py-2.5 px-3 sm:px-4 text-right tabular-nums w-[80px] whitespace-nowrap">
                        ${t.entry_price.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 sm:px-4 text-right tabular-nums w-[90px] whitespace-nowrap">
                        ${t.size_usdc.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 sm:px-4 w-[110px]">
                        <ResultBadge
                          result={
                            t.redeemed && t.result === "PENDING" ? "WAITING" : t.result
                          }
                        />
                      </td>
                      <td className="py-2.5 px-3 sm:px-4 w-[170px]">
                        {t.redeemed && t.result === "PENDING" ? (
                          <span
                            className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-[#2dd4bf]/20 text-[#2dd4bf]"
                            title={`Equity updated from redemption; waiting for Polymarket PnL data (${formatDuration(
                              Math.min(
                                600,
                                Math.max(
                                  0,
                                  Math.floor(
                                    (Date.now() - parseTimestamp(t.timestamp).getTime()) / 1000,
                                  ),
                                ),
                              ),
                            )})`}
                          >
                            Collected
                          </span>
                        ) : t.result === "PENDING" ? (
                          <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-[#6e7681]/20 text-[#8b949e]">
                            Pending
                          </span>
                        ) : t.redeemed ? (
                          <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-[#2dd4bf]/20 text-[#2dd4bf]">
                            Collected
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-[#6e7681]/20 text-[#8b949e]">
                            Not collected
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 sm:px-4 text-right font-medium tabular-nums w-[90px] whitespace-nowrap">
                        {t.result === "PENDING" ? (
                          <span className="text-[#6e7681]">—</span>
                        ) : (
                          <span
                            className={t.pnl_usdc >= 0 ? "text-[#2dd4bf]" : "text-[#f87171]"}
                          >
                            {t.pnl_usdc >= 0 ? "+" : ""}${t.pnl_usdc.toFixed(2)}
                          </span>
                        )}
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
    <div className="flex justify-between items-center gap-3 min-w-0">
      <span className="text-[#8b949e] shrink-0 w-16">{label}</span>
      <span className="text-white font-mono text-right tabular-nums break-all min-w-0">
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
  const upper = result.toUpperCase();
  const style =
    upper === "WIN"
      ? "bg-[#2dd4bf]/20 text-[#2dd4bf]"
      : upper === "LOSS"
        ? "bg-[#f87171]/20 text-[#f87171]"
        : upper === "COLLECTED"
          ? "bg-[#2dd4bf]/20 text-[#2dd4bf]"
          : "bg-[#6e7681]/20 text-[#8b949e]";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${style}`}>
      {upper}
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
