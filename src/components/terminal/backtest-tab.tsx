"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "./auth-provider";
import { fmtDate } from "./format";
import type { BacktestResult } from "@/lib/ict/backtest";

/** Small SVG equity curve (cumulative R). */
function EquityCurve({ points }: { points: { time: number; r: number }[] }) {
  if (points.length < 2) return null;
  const w = 640;
  const h = 160;
  const rs = points.map((p) => p.r);
  const min = Math.min(0, ...rs);
  const max = Math.max(0.5, ...rs);
  const x = (i: number) => (i / (points.length - 1)) * w;
  const y = (r: number) => h - ((r - min) / (max - min)) * h;

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.r).toFixed(1)}`).join(" ");
  const zeroY = y(0);
  const positive = rs[rs.length - 1] >= 0;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Equity curve in R multiples">
      <line x1="0" y1={zeroY} x2={w} y2={zeroY} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
      <path d={path} fill="none" stroke={positive ? "#2fbf71" : "#e5484d"} strokeWidth="2" />
    </svg>
  );
}

const metricCard = "rounded-lg border border-border bg-card px-3 py-2.5";

export function BacktestTab({ symbol, interval }: { symbol: string; interval: string }) {
  const { accessToken, user } = useAuth();
  const [bars, setBars] = useState(1500);
  const [btInterval, setBtInterval] = useState(interval);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    setSavedMsg(null);
    setResult(null);
    try {
      const res = await fetch(`/api/backtest?symbol=${symbol}&interval=${btInterval}&bars=${bars}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Backtest failed");
      setResult(json as BacktestResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backtest failed");
    } finally {
      setLoading(false);
    }
  }

  async function saveRun() {
    if (!result) return;
    const token = accessToken();
    if (!token) {
      setSavedMsg("Sign in to save backtest runs.");
      return;
    }
    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          symbol: result.symbol,
          interval: result.interval,
          bars: result.bars,
          from: result.from,
          to: result.to,
          metrics: result.metrics,
          params: { bars, sweepWindow: 10 },
        }),
      });
      if (!res.ok) throw new Error();
      setSavedMsg("Backtest run saved to your account ✓");
    } catch {
      setSavedMsg("Could not save the run — please retry.");
    }
  }

  const m = result?.metrics;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="bt-interval" className="mb-1 block text-xs text-muted-foreground">Backtest timeframe</label>
          <select
            id="bt-interval"
            value={btInterval}
            onChange={(e) => setBtInterval(e.target.value)}
            className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
          >
            <option value="15min">15m</option>
            <option value="1h">1H</option>
            <option value="4h">4H</option>
            <option value="1day">1D</option>
          </select>
        </div>
        <div>
          <label htmlFor="bt-bars" className="mb-1 block text-xs text-muted-foreground">History (bars, 400–5000)</label>
          <Input
            id="bt-bars"
            type="number"
            min={400}
            max={5000}
            step={100}
            value={bars}
            onChange={(e) => setBars(Number(e.target.value) || 1500)}
            className="h-9 w-36"
          />
        </div>
        <Button onClick={run} disabled={loading} className="h-9 bg-primary text-primary-foreground hover:bg-gold-soft">
          {loading ? "Running…" : `Run backtest · ${symbol}`}
        </Button>
        {result && user && (
          <Button variant="outline" className="h-9 border-border" onClick={saveRun}>
            Save run
          </Button>
        )}
        {savedMsg && <span className="text-xs text-muted-foreground">{savedMsg}</span>}
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</p>
      )}

      {m && result && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            <div className={metricCard}>
              <p className="text-xs text-muted-foreground">Trades</p>
              <p className="text-lg font-bold">{m.trades}</p>
            </div>
            <div className={metricCard}>
              <p className="text-xs text-muted-foreground">Win rate</p>
              <p className="text-lg font-bold">{m.winRate}%</p>
            </div>
            <div className={metricCard}>
              <p className="text-xs text-muted-foreground">Expectancy</p>
              <p className={`text-lg font-bold ${m.expectancyR >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {m.expectancyR}R
              </p>
            </div>
            <div className={metricCard}>
              <p className="text-xs text-muted-foreground">Profit factor</p>
              <p className="text-lg font-bold">{m.profitFactor}</p>
            </div>
            <div className={metricCard}>
              <p className="text-xs text-muted-foreground">Max drawdown</p>
              <p className="text-lg font-bold text-amber-400">{m.maxDrawdownR}R</p>
            </div>
            <div className={metricCard}>
              <p className="text-xs text-muted-foreground">Total return</p>
              <p className={`text-lg font-bold ${m.totalR >= 0 ? "text-emerald-400" : "text-red-400"}`}>{m.totalR}R</p>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Equity curve (R multiples)</h3>
              <span className="text-xs text-muted-foreground">
                {fmtDate(result.from)} → {fmtDate(result.to)} · {result.bars} bars
              </span>
            </div>
            <EquityCurve points={result.equityCurve} />
          </div>

          <div className="rounded-xl border border-border">
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Side</th>
                    <th className="px-3 py-2 font-medium">Entry time</th>
                    <th className="px-3 py-2 font-medium">Entry</th>
                    <th className="px-3 py-2 font-medium">Stop</th>
                    <th className="px-3 py-2 font-medium">Outcome</th>
                    <th className="px-3 py-2 text-right font-medium">R</th>
                    <th className="px-3 py-2 text-right font-medium">MFE/MAE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {result.trades.map((t, i) => (
                    <tr key={i} className="text-muted-foreground">
                      <td className={`px-3 py-2 font-semibold ${t.side === "LONG" ? "text-emerald-400" : "text-red-400"}`}>{t.side}</td>
                      <td className="px-3 py-2">{fmtDate(t.entryTime)} {new Date(t.entryTime * 1000).toISOString().slice(11, 16)}</td>
                      <td className="px-3 py-2 font-mono">{t.entry.toFixed(2)}</td>
                      <td className="px-3 py-2 font-mono">{t.stop.toFixed(2)}</td>
                      <td className="px-3 py-2">{t.outcome}</td>
                      <td className={`px-3 py-2 text-right font-mono font-semibold ${t.r >= 0 ? "text-emerald-400" : "text-red-400"}`}>{t.r}R</td>
                      <td className="px-3 py-2 text-right font-mono">{t.mfeR}/{t.maeR}</td>
                    </tr>
                  ))}
                  {result.trades.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No trades generated on this history — loosen nothing, that is a valid result.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <ul className="space-y-1">
            {result.notes.map((n, i) => (
              <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                <span aria-hidden className="text-gold">▸</span>{n}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Win rate alone is meaningless without expectancy: a 35% win rate at 2.5R average win
            beats a 60% win rate at 0.5R. Judge systems by expectancy and drawdown, not strike rate.
          </p>
        </>
      )}
    </div>
  );
}
