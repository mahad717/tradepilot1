"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChartPanel } from "./chart-panel";
import { AnalysisPanel } from "./analysis-panel";
import { SignalsTab, type SavedSignalRow } from "./signals-tab";
import { BacktestTab } from "./backtest-tab";
import { SmtTab } from "./smt-tab";
import { useAuth } from "./auth-provider";
import { fmtPrice, fmtPct } from "./format";
import type { Candle, DataSource, IntervalKey, SymbolKey } from "@/lib/market/types";
import type { AnalysisSnapshot, Trend } from "@/lib/ict/types";

const SYMBOL_TABS: { key: SymbolKey; label: string }[] = [
  { key: "XAUUSD", label: "XAUUSD" },
  { key: "XAGUSD", label: "XAGUSD" },
];

const INTERVAL_TABS: { key: IntervalKey; label: string }[] = [
  { key: "5min", label: "5m" },
  { key: "15min", label: "15m" },
  { key: "1h", label: "1H" },
  { key: "4h", label: "4H" },
  { key: "1day", label: "1D" },
];

const TABS = [
  { id: "terminal", label: "Terminal" },
  { id: "signals", label: "Signals" },
  { id: "backtest", label: "Backtesting" },
  { id: "smt", label: "SMT divergence" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const trendColor: Record<Trend, string> = {
  BULLISH: "text-emerald-400",
  BEARISH: "text-red-400",
  NEUTRAL: "text-muted-foreground",
};

interface QuoteLite {
  price: number;
  percentChange: number;
}

export function Terminal() {
  const { accessToken, user, loading: authLoading } = useAuth();
  const [symbol, setSymbol] = useState<SymbolKey>("XAUUSD");
  const [interval, setIntervalKey] = useState<IntervalKey>("15min");
  const [tab, setTab] = useState<TabId>("terminal");

  const [candles, setCandles] = useState<Candle[]>([]);
  const [source, setSource] = useState<DataSource>("LIVE");
  const [analysis, setAnalysis] = useState<AnalysisSnapshot | null>(null);
  const [quote, setQuote] = useState<Record<string, QuoteLite>>({});
  const [chartError, setChartError] = useState<string | null>(null);

  const [candidates, setCandidates] = useState<import("@/lib/ict/types").SignalCandidate[]>([]);
  const [signalsNote, setSignalsNote] = useState("");
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [signalsError, setSignalsError] = useState<string | null>(null);
  const [savedSignals, setSavedSignals] = useState<SavedSignalRow[]>([]);

  // ---- chart + analysis data ----
  const loadMarket = useCallback(async () => {
    try {
      const [cRes, aRes] = await Promise.all([
        fetch(`/api/market/candles?symbol=${symbol}&interval=${interval}&outputsize=300`),
        fetch(`/api/analysis?symbol=${symbol}&interval=${interval}`),
      ]);
      const c = await cRes.json();
      if (!cRes.ok) throw new Error(c.error ?? "Market data unavailable");
      setCandles((c.candles ?? []) as Candle[]);
      setSource(c.source as DataSource);
      setChartError(null);

      if (aRes.ok) {
        const a = await aRes.json();
        setAnalysis(a as AnalysisSnapshot);
      }
    } catch (e) {
      setChartError(e instanceof Error ? e.message : "Market data unavailable");
    }
  }, [symbol, interval]);

  // ---- quotes ----
  const loadQuotes = useCallback(async () => {
    try {
      const res = await fetch("/api/market/quote");
      const json = await res.json();
      if (res.ok) setQuote(json.quotes ?? {});
    } catch {
      // quotes are cosmetic — ignore failures
    }
  }, []);

  // ---- signals ----
  const loadSignals = useCallback(async () => {
    setSignalsLoading(true);
    setSignalsError(null);
    try {
      const res = await fetch(`/api/signals?symbol=${symbol}&interval=${interval}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Signals unavailable");
      setCandidates(json.candidates ?? []);
      setSignalsNote(json.note ?? "");
    } catch (e) {
      setSignalsError(e instanceof Error ? e.message : "Signals unavailable");
    } finally {
      setSignalsLoading(false);
    }
  }, [symbol, interval]);

  const loadSaved = useCallback(async () => {
    const token = accessToken();
    if (!token) {
      setSavedSignals([]);
      return;
    }
    try {
      const res = await fetch("/api/signals/saved", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setSavedSignals(json.signals ?? []);
      }
    } catch {
      // non-fatal
    }
  }, [accessToken]);

  useEffect(() => {
    loadMarket();
    loadSignals();
  }, [loadMarket, loadSignals]);

  useEffect(() => {
    loadQuotes();
    const t = window.setInterval(loadQuotes, 30_000);
    return () => window.clearInterval(t);
  }, [loadQuotes]);

  useEffect(() => {
    if (!authLoading) loadSaved();
  }, [authLoading, loadSaved]);

  // refresh signals/saved when the signals tab opens
  useEffect(() => {
    if (tab === "signals") loadSignals();
  }, [tab, loadSignals]);

  const last = candles[candles.length - 1];
  const q = quote[symbol];
  const price = q?.price ?? last?.close ?? 0;
  const changePct = q?.percentChange ?? 0;
  const trend = analysis?.structure.trend ?? "NEUTRAL";

  const symbolSource = useMemo(
    () => (symbol === "XAUUSD" ? "LIVE" : "SIMULATED") as DataSource,
    [symbol]
  );

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
      {/* ---- instrument bar ---- */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-border bg-muted/30 p-1" role="tablist" aria-label="Symbol">
          {SYMBOL_TABS.map((s) => (
            <button
              key={s.key}
              role="tab"
              aria-selected={symbol === s.key}
              onClick={() => setSymbol(s.key)}
              className={`min-h-9 rounded-md px-3 text-sm font-semibold transition-colors ${symbol === s.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {s.label}
              {s.key === "XAGUSD" && (
                <span className="ml-1.5 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-bold text-amber-400">SIM</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex rounded-lg border border-border bg-muted/30 p-1" role="tablist" aria-label="Interval">
          {INTERVAL_TABS.map((i) => (
            <button
              key={i.key}
              role="tab"
              aria-selected={interval === i.key}
              onClick={() => setIntervalKey(i.key)}
              className={`min-h-9 rounded-md px-2.5 text-sm font-medium transition-colors ${interval === i.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {i.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-baseline gap-2">
          <span className="font-mono text-2xl font-bold tabular-nums">{fmtPrice(price)}</span>
          <span className={`text-sm font-semibold ${changePct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {fmtPct(changePct)}
          </span>
          <span className="hidden text-xs text-muted-foreground md:inline">
            {trend && <>· structure <span className={`font-bold ${trendColor[trend]}`}>{trend}</span></>}
          </span>
        </div>
      </div>

      {/* ---- tabs ---- */}
      <div className="mt-4 flex gap-1 overflow-x-auto border-b border-border" role="tablist" aria-label="Terminal sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`min-h-10 whitespace-nowrap border-b-2 px-4 text-sm font-medium transition-colors ${tab === t.id ? "border-gold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === "terminal" && (
          <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
            <div>
              {chartError ? (
                <p role="alert" className="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">{chartError}</p>
              ) : candles.length === 0 ? (
                <div className="h-[460px] animate-pulse rounded-xl bg-muted/40" />
              ) : (
                <ChartPanel candles={candles} analysis={analysis} source={source} />
              )}
              <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-muted-foreground">
                <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#2fbf71]" aria-hidden />Bullish FVG / sweep</span>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#e5484d]" aria-hidden />Bearish FVG / sweep</span>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#e0a430]" aria-hidden />Order block / MSS</span>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#7aa2f7]" aria-hidden />BOS</span>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#9aa3af]" aria-hidden />Equilibrium 50%</span>
              </div>
            </div>
            <aside className="rounded-xl border border-border bg-card p-4">
              <AnalysisPanel analysis={analysis} />
            </aside>
          </div>
        )}

        {tab === "signals" && (
          <SignalsTab
            candidates={candidates}
            loading={signalsLoading}
            error={signalsError}
            note={signalsNote}
            savedSignals={savedSignals}
            onRefreshSaved={loadSaved}
          />
        )}

        {tab === "backtest" && <BacktestTab symbol={symbol} interval={interval} />}

        {tab === "smt" && <SmtTab key={interval} interval={interval} />}
      </div>

      {!user && !authLoading && (
        <p className="mt-6 rounded-lg border border-dashed border-border px-4 py-3 text-center text-xs text-muted-foreground">
          You are browsing the terminal anonymously — sign in to save signals and backtest runs.
        </p>
      )}

      <p className="mt-8 text-center text-[11px] text-muted-foreground">
        {symbol === "XAGUSD"
          ? "XAGUSD currently runs on deterministic simulated data (TwelveData plan required for live silver). "
          : ""}
        Educational ICT analysis tool only — not financial advice. Trading gold and silver CFDs or
        spot involves substantial risk of loss. Past performance does not guarantee future results.
      </p>
    </div>
  );
}
