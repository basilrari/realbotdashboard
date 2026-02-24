"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
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
} from "lucide-react";
import { fetchState } from "@/lib/api";
import type { LiveState, TradeRecord, DecisionLogEntry } from "@/lib/types";

const POLL_MS = 5000;

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Build equity curve from trades (cumulative PnL over time) */
function buildEquityCurve(trades: TradeRecord[]): { time: string; equity: number }[] {
  const points: { time: string; equity: number }[] = [{ time: "", equity: 0 }];
  let running = 0;
  for (const t of [...trades].reverse()) {
    running += t.pnl_usdc;
    points.push({ time: t.timestamp, equity: running });
  }
  if (points.length === 1) points[0].time = "Start";
  return points;
}

export default function DashboardPage() {
  const [state, setState] = useState<LiveState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await fetchState();
        if (!cancelled) {
          setState(data);
          setError(null);
          setLastUpdated(new Date());
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to fetch state");
        }
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

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
  const trades = state?.trades ?? [];
  const recentTrades = trades.slice(0, 20);
  const wins = trades.filter((t) => t.result === "WIN").length;
  const losses = trades.filter((t) => t.result === "LOSS").length;
  const totalResolved = wins + losses;
  const winRate = totalResolved > 0 ? (wins / totalResolved) * 100 : 0;
  const equityCurve = buildEquityCurve(trades);

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#e6edf3] font-sans">
      <div className="max-w-6xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-8 h-8 text-[#2dd4bf]" />
            <h1 className="text-xl font-bold text-white">Polymarket Bot Dashboard</h1>
          </div>
          <div className="flex items-center gap-3 text-sm text-[#8b949e]">
            <span className="flex items-center gap-1">
              <RefreshCw className="w-4 h-4" />
              Updated {lastUpdated ? format(lastUpdated, "HH:mm:ss") : "—"}
            </span>
            {state?.botPaused && (
              <span className="flex items-center gap-1 text-amber-400">
                <Pause className="w-4 h-4" /> Paused
              </span>
            )}
          </div>
        </header>

        {/* Live Equity + PnL */}
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="rounded-xl bg-[#161b22] border border-[#30363d] p-5">
            <p className="text-[#8b949e] text-sm mb-1">Live Equity</p>
            <p className="text-3xl font-bold text-white">
              ${(state?.equity ?? 0).toFixed(2)}
            </p>
          </div>
          <div className="rounded-xl bg-[#161b22] border border-[#30363d] p-5">
            <p className="text-[#8b949e] text-sm mb-1">Live PnL</p>
            <p
              className={`text-3xl font-bold ${
                (state?.livePnl ?? 0) >= 0 ? "text-[#2dd4bf]" : "text-[#f87171]"
              }`}
            >
              {(state?.livePnl ?? 0) >= 0 ? "+" : ""}
              ${(state?.livePnl ?? 0).toFixed(2)}
            </p>
          </div>
          <div className="rounded-xl bg-[#161b22] border border-[#30363d] p-5">
            <p className="text-[#8b949e] text-sm mb-1">Win rate · Trades</p>
            <p className="text-2xl font-bold text-white">
              {winRate.toFixed(0)}% <span className="text-[#8b949e] font-normal">· {trades.length}</span>
            </p>
          </div>
        </section>

        {/* Equity Curve */}
        <section className="rounded-xl bg-[#161b22] border border-[#30363d] p-4 mb-6">
          <h2 className="text-sm font-semibold text-[#8b949e] mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[#2dd4bf]" />
            Equity Curve
          </h2>
          <div className="h-64 sm:h-72">
            {equityCurve.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equityCurve} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                  <XAxis
                    dataKey="time"
                    tick={{ fill: "#8b949e", fontSize: 11 }}
                    tickFormatter={(v) => (v ? format(new Date(v), "HH:mm") : v)}
                  />
                  <YAxis
                    tick={{ fill: "#8b949e", fontSize: 11 }}
                    tickFormatter={(v) => `$${v}`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#21262d",
                      border: "1px solid #30363d",
                      borderRadius: "8px",
                    }}
                    labelStyle={{ color: "#e6edf3" }}
                    formatter={(value: number | undefined) => [`$${(value ?? 0).toFixed(2)}`, "Equity"]}
                    labelFormatter={(label) => (label ? format(new Date(label), "PPp") : "Start")}
                  />
                  <Line
                    type="monotone"
                    dataKey="equity"
                    stroke="#2dd4bf"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-[#6e7681] text-sm">
                No trades yet — equity curve will appear here.
              </div>
            )}
          </div>
        </section>

        {/* Current Market + Live prices */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
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
                <a
                  href={`https://polymarket.com/${market.slug}`}
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

          <section className="rounded-xl bg-[#161b22] border border-[#30363d] p-4">
            <h2 className="text-sm font-semibold text-[#8b949e] mb-3">Live prices</h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
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
          <div className="flex flex-wrap gap-4 sm:gap-6 text-sm">
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

        {/* Decision log (why took / skipped / error) */}
        <section className="rounded-xl bg-[#161b22] border border-[#30363d] overflow-hidden mb-6">
          <h2 className="text-sm font-semibold text-[#8b949e] p-4 pb-2 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-[#2dd4bf]" />
            Decision log (take / skip / error)
          </h2>
          <div className="px-4 pb-4 max-h-64 overflow-y-auto">
            {(() => {
              const raw = state?.decisionLog;
              const entries = (Array.isArray(raw) ? raw : []).filter(
                (e): e is DecisionLogEntry =>
                  e != null && typeof e === "object" && "kind" in e && "reason" in e
              );
              const list = [...entries].reverse();
              if (list.length === 0) {
                return (
                  <p className="text-[#6e7681] text-sm py-2">No decisions yet this session.</p>
                );
              }
              return (
                <ul className="space-y-2 text-sm">
                  {list.map((e, i) => (
                    <li
                      key={i}
                      className="flex flex-wrap items-baseline gap-2 py-1.5 border-b border-[#21262d] last:border-0"
                    >
                      <span className="text-[#6e7681] shrink-0">
                        {format(new Date(e.ts), "HH:mm:ss")}
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
              );
            })()}
          </div>
        </section>

        {/* Recent Trades */}
        <section className="rounded-xl bg-[#161b22] border border-[#30363d] overflow-hidden mb-6">
          <h2 className="text-sm font-semibold text-[#8b949e] p-4 pb-0">Recent Trades (last 20)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[#8b949e] border-b border-[#30363d]">
                  <th className="text-left py-3 px-4">Time</th>
                  <th className="text-left py-3 px-4">Side</th>
                  <th className="text-right py-3 px-4">Entry</th>
                  <th className="text-right py-3 px-4">Size</th>
                  <th className="text-left py-3 px-4">Result</th>
                  <th className="text-right py-3 px-4">PnL</th>
                  <th className="text-left py-3 px-4 max-w-[120px] truncate">Reason</th>
                </tr>
              </thead>
              <tbody>
                {recentTrades.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-[#6e7681]">
                      No trades yet.
                    </td>
                  </tr>
                ) : (
                  recentTrades.map((t, i) => (
                    <tr key={i} className="border-b border-[#21262d] hover:bg-[#21262d]/50">
                      <td className="py-2 px-4 text-[#e6edf3] whitespace-nowrap">
                        {format(new Date(t.timestamp), "HH:mm:ss")}
                      </td>
                      <td className="py-2 px-4 font-mono">{t.side}</td>
                      <td className="py-2 px-4 text-right">${t.entry_price.toFixed(2)}</td>
                      <td className="py-2 px-4 text-right">${t.size_usdc.toFixed(2)}</td>
                      <td className="py-2 px-4">
                        <ResultBadge result={t.result} />
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
          Auto-refresh every 5s · Last updated {lastUpdated ? format(lastUpdated, "PPp") : "—"}
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
    <div className="flex justify-between items-center py-1">
      <span className="text-[#8b949e]">{label}</span>
      <span className="text-white font-mono">
        {isBtc ? `$${num.toFixed(2)}` : num.toFixed(4)}
        {isBtc && beat !== 0 && (
          <span className={diff >= 0 ? "text-[#2dd4bf] ml-1" : "text-[#f87171] ml-1"}>
            ({diff >= 0 ? "+" : ""}${diff.toFixed(2)})
          </span>
        )}
      </span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
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
