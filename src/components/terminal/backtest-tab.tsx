"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "./auth-provider";
import { fmtDate } from "./format";
import type { BacktestResult } from "@/lib/ict/backtest";
import type { TradeRecord } from "@/lib/ict/types";

const metricCard = "rounded-lg border border-border bg-card px-3 py-2.5";

/** Small SVG equity curve (cumulative net R). */
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

/** MFE vs MAE scatter (spec #25). */
function MfeMaeScatter({ points }: { points: { mfeR: number; maeR: number; win: boolean }[] }) {
  if (points.length < 1) return null;
  const w = 480;
  const h = 260;
  const pad = 28;
  const maxMfe = Math.max(1, ...points.map((p) => p.mfeR)) * 1.1;
  const minMae = Math.min(-1, ...points.map((p) => p.maeR)) * 1.1;
  const x = (v: number) => pad + (v / maxMfe) * (w - pad - 8);
  const y = (v: number) => h - pad - ((v - minMae) / (0 - minMae)) * (h - pad - 10);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-xl" role="img" aria-label="MFE versus MAE scatter">
      <line x1={pad} y1={y(0)} x2={w - 8} y2={y(0)} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 4" />
      <line x1={x(0)} y1={pad} x2={x(0)} y2={h - pad} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 4" />
      {points.map((p, i) => (
        <circle key={i} cx={x(p.mfeR)} cy={y(p.maeR)} r={4} fill={p.win ? "#2fbf71" : "#e5484d"} fillOpacity={0.75} />
      ))}
      <text x={w / 2} y={h - 6} textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.5)">MFE (R) →</text>
      <text x={10} y={h / 2} fontSize="10" fill="rgba(255,255,255,0.5)" transform={`rotate(-90 10 ${h / 2})`}>MAE (R) →</text>
    </svg>
  );
}

const selectCls = "h-9 rounded-lg border border-border bg-background px-2 text-sm";

function SampleWarning({ n }: { n: number }) {
  if (n >= 30) return null;
  return (
    <p className="rounded-lg border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
      ⚠ {n} trade{n === 1 ? "" : "s"} is a very small sample. Treat every metric below as indicative,
      never as statistically reliable. More history → more trades → more meaning.
    </p>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full rounded bg-muted">
      <div className="h-1.5 rounded bg-gold" style={{ width: `${pct}%` }} />
    </div>
  );
}

function AuditViewer({ trade }: { trade: TradeRecord }) {
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-[11px] text-gold hover:underline">trade audit log</summary>
      <div className="mt-1 max-h-64 space-y-1 overflow-y-auto rounded-md border border-border/60 bg-background/60 p-2">
        {trade.audit.map((a, k) => (
          <p key={k} className="text-[11px] leading-snug text-muted-foreground">
            <span className="font-mono text-[10px] text-gold/80">{new Date(a.time * 1000).toISOString().slice(5, 16).replace("T", " ")}</span>{" "}
            <span className="font-medium text-foreground/80">{a.event}</span> — {a.detail}
          </p>
        ))}
        <p className="text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground/80">Legs:</span>{" "}
          {trade.legs.map((l) => `${l.label} ${(l.share * 100).toFixed(0)}% @ ${l.exitPrice} → ${l.netR}R net`).join(" | ")}
        </p>
      </div>
    </details>
  );
}

export function BacktestTab({ symbol, interval }: { symbol: string; interval: string }) {
  const { accessToken, user } = useAuth();
  const [bars, setBars] = useState(1500);
  const [btInterval, setBtInterval] = useState(interval === "5min" ? "15min" : interval);
  const [minRR, setMinRR] = useState("2");
  const [beMode, setBeMode] = useState("tp1");
  const [ambiguity, setAmbiguity] = useState("pessimistic");
  const [sessions, setSessions] = useState("london");
  const [sensitivity, setSensitivity] = useState(false);
  const [result, setResult] = useState<(BacktestResult & { sensitivity?: { minRR: number; trades: number; winRate: number; expectancyR: number; profitFactor: number; netR: number }[] }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    setSavedMsg(null);
    setResult(null);
    try {
      const params = new URLSearchParams({
        symbol,
        interval: btInterval,
        bars: String(bars),
        minRR,
        beMode,
        ambiguity,
        sessions,
      });
      if (sensitivity) params.set("sensitivity", "1.5,2,2.5,3");
      const res = await fetch(`/api/backtest?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Backtest failed");
      setResult(json);
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
          params: result.config,
        }),
      });
      if (!res.ok) throw new Error();
      setSavedMsg("Backtest run saved to your account ✓");
    } catch {
      setSavedMsg("Could not save the run — please retry.");
    }
  }

  const m = result?.metrics;
  const flags = result?.flags;
  const flagCls =
    flags?.level === "GREEN"
      ? "border-emerald-900/50 bg-emerald-950/30 text-emerald-300"
      : flags?.level === "RED"
        ? "border-red-900/50 bg-red-950/30 text-red-300"
        : "border-amber-900/50 bg-amber-950/30 text-amber-300";
  const maxFunnel = result ? Math.max(1, ...result.funnel.map((f) => f.count)) : 1;

  return (
    <div className="space-y-6">
      {/* ---------------- config ---------------- */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="bt-interval" className="mb-1 block text-xs text-muted-foreground">Timeframe</label>
          <select id="bt-interval" value={btInterval} onChange={(e) => setBtInterval(e.target.value)} className={selectCls}>
            <option value="15min">15m</option>
            <option value="1h">1H</option>
            <option value="4h">4H</option>
          </select>
        </div>
        <div>
          <label htmlFor="bt-bars" className="mb-1 block text-xs text-muted-foreground">History (bars)</label>
          <select id="bt-bars" value={bars} onChange={(e) => setBars(Number(e.target.value))} className={selectCls}>
            {[400, 1000, 1500, 3000, 5000].map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="bt-sessions" className="mb-1 block text-xs text-muted-foreground">Sessions</label>
          <select id="bt-sessions" value={sessions} onChange={(e) => setSessions(e.target.value)} className={selectCls}>
            <option value="london">London KZ</option>
            <option value="ny-am,ny-pm">New York KZ</option>
            <option value="london,ny-am,ny-pm">London + NY</option>
            <option value="">All sessions</option>
          </select>
        </div>
        <div>
          <label htmlFor="bt-minrr" className="mb-1 block text-xs text-muted-foreground">Min RR (structural)</label>
          <select id="bt-minrr" value={minRR} onChange={(e) => setMinRR(e.target.value)} className={selectCls}>
            {["1.5", "2", "2.5", "3"].map((v) => (
              <option key={v} value={v}>{v}R</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="bt-be" className="mb-1 block text-xs text-muted-foreground">Breakeven mode</label>
          <select id="bt-be" value={beMode} onChange={(e) => setBeMode(e.target.value)} className={selectCls}>
            <option value="tp1">After TP1</option>
            <option value="risk1">After +1R</option>
            <option value="structural">Structural</option>
            <option value="off">No BE</option>
          </select>
        </div>
        <div>
          <label htmlFor="bt-amb" className="mb-1 block text-xs text-muted-foreground">SL/TP ambiguity</label>
          <select id="bt-amb" value={ambiguity} onChange={(e) => setAmbiguity(e.target.value)} className={selectCls}>
            <option value="pessimistic">Pessimistic</option>
            <option value="optimistic">Optimistic</option>
            <option value="randomized">Randomized</option>
            <option value="ltf">5m resolution (15m only)</option>
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={sensitivity} onChange={(e) => setSensitivity(e.target.checked)} className="accent-[var(--gold)]" />
          minRR sensitivity
        </label>
        <Button onClick={run} disabled={loading} className="h-9 bg-primary text-primary-foreground hover:bg-gold-soft">
          {loading ? "Running…" : `Run backtest · ${symbol}`}
        </Button>
        {result && user && (
          <Button variant="outline" className="h-9 border-border" onClick={saveRun}>Save run</Button>
        )}
        {savedMsg && <span className="text-xs text-muted-foreground">{savedMsg}</span>}
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</p>
      )}

      {m && result && flags && (
        <>
          {/* ---------------- robustness flags ---------------- */}
          <div className={`rounded-lg border px-4 py-3 text-sm ${flagCls}`} role="status">
            <span className="font-bold">Robustness: {flags.level}</span>
            <ul className="mt-1 space-y-0.5 text-xs opacity-90">
              {flags.reasons.map((r, i) => <li key={i}>• {r}</li>)}
            </ul>
          </div>

          <SampleWarning n={m.trades} />

          {/* ---------------- executive summary ---------------- */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <div className={metricCard}>
              <p className="text-xs text-muted-foreground">Trades</p>
              <p className="text-lg font-bold">{m.trades}</p>
            </div>
            <div className={metricCard}>
              <p className="text-xs text-muted-foreground">Win rate</p>
              <p className="text-lg font-bold">{m.winRate}%</p>
            </div>
            <div className={metricCard}>
              <p className="text-xs text-muted-foreground">Expectancy (net)</p>
              <p className={`text-lg font-bold ${m.expectancyR >= 0 ? "text-emerald-400" : "text-red-400"}`}>{m.expectancyR}R</p>
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
              <p className="text-xs text-muted-foreground">Gross / costs</p>
              <p className="text-sm font-bold">{m.grossR}R <span className="text-xs text-muted-foreground">− {m.costsR}R</span></p>
            </div>
            <div className={metricCard}>
              <p className="text-xs text-muted-foreground">Net return</p>
              <p className={`text-lg font-bold ${m.netR >= 0 ? "text-emerald-400" : "text-red-400"}`}>{m.netR}R</p>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Equity curve (net R)</h3>
              <span className="text-xs text-muted-foreground">
                {fmtDate(result.from)} → {fmtDate(result.to)} · {result.bars} bars · {result.source}
              </span>
            </div>
            <EquityCurve points={result.equityCurve} />
          </div>

          {/* ---------------- walk-forward ---------------- */}
          <Section
            title="Walk-forward periods"
            subtitle={result.walkForward.note}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Period</th>
                    <th className="px-2 py-1.5 text-right font-medium">Trades</th>
                    <th className="px-2 py-1.5 text-right font-medium">Win rate</th>
                    <th className="px-2 py-1.5 text-right font-medium">Expectancy</th>
                    <th className="px-2 py-1.5 text-right font-medium">Profit factor</th>
                    <th className="px-2 py-1.5 text-right font-medium">Max DD</th>
                    <th className="px-2 py-1.5 text-right font-medium">Net R</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {result.walkForward.periods.map((p) => (
                    <tr key={p.period} className="text-muted-foreground">
                      <td className="px-2 py-1.5">{p.period}</td>
                      <td className="px-2 py-1.5 text-right">{p.trades}</td>
                      <td className="px-2 py-1.5 text-right">{p.winRate}%</td>
                      <td className={`px-2 py-1.5 text-right ${p.expectancyR >= 0 ? "text-emerald-400" : "text-red-400"}`}>{p.expectancyR}R</td>
                      <td className="px-2 py-1.5 text-right">{p.profitFactor}</td>
                      <td className="px-2 py-1.5 text-right">{p.maxDrawdownR}R</td>
                      <td className={`px-2 py-1.5 text-right font-semibold ${p.netR >= 0 ? "text-emerald-400" : "text-red-400"}`}>{p.netR}R</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {result.walkForward.splits.map((s) => (
                <div key={s.name} className="rounded-lg border border-border/60 p-2 text-xs">
                  <p className="font-medium">{s.name}</p>
                  <p className="text-muted-foreground">
                    {s.stats.trades} trades · {s.stats.winRate}% WR · {s.stats.expectancyR}R exp · PF {s.stats.profitFactor}
                  </p>
                </div>
              ))}
            </div>
          </Section>

          {/* ---------------- Monte Carlo ---------------- */}
          {result.monteCarlo && (
            <Section title="Monte Carlo (resampling of actual trades)" subtitle={result.monteCarlo.note}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                <div className={metricCard}><p className="text-xs text-muted-foreground">Median final</p><p className="font-bold">{result.monteCarlo.medianFinalR}R</p></div>
                <div className={metricCard}><p className="text-xs text-muted-foreground">5th percentile</p><p className="font-bold text-red-400">{result.monteCarlo.p5FinalR}R</p></div>
                <div className={metricCard}><p className="text-xs text-muted-foreground">95th percentile</p><p className="font-bold text-emerald-400">{result.monteCarlo.p95FinalR}R</p></div>
                <div className={metricCard}><p className="text-xs text-muted-foreground">P(losing outcome)</p><p className="font-bold">{Math.round(result.monteCarlo.probFinalNegative * 100)}%</p></div>
                <div className={metricCard}><p className="text-xs text-muted-foreground">Median max DD</p><p className="font-bold">{result.monteCarlo.medianMaxDrawdownR}R</p></div>
                <div className={metricCard}><p className="text-xs text-muted-foreground">95% max DD</p><p className="font-bold">{result.monteCarlo.p95MaxDrawdownR}R</p></div>
              </div>
              <div className="mt-3 flex h-20 items-end gap-1" aria-hidden>
                {result.monteCarlo.histogram.map((b, i) => {
                  const maxC = Math.max(...result.monteCarlo!.histogram.map((h) => h.count));
                  return <div key={i} className="flex-1 rounded-t bg-gold/60" style={{ height: `${maxC ? (b.count / maxC) * 100 : 0}%` }} title={`${b.bucket}: ${b.count}`} />;
                })}
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">Distribution of final equity across {result.monteCarlo.iterations} resampled paths ({result.monteCarlo.medianMaxConsecutiveLosses} median / {result.monteCarlo.p95MaxConsecutiveLosses} p95 max consecutive losses)</p>
            </Section>
          )}

          {/* ---------------- signal funnel ---------------- */}
          <Section title="Signal funnel" subtitle="How many market situations survive each stage — shows exactly where the strategy is too loose or too strict.">
            <div className="space-y-2">
              {result.funnel.map((f) => (
                <div key={f.stage}>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{f.stage}</span>
                    <span className="font-mono">{f.count}</span>
                  </div>
                  <Bar value={f.count} max={maxFunnel} />
                </div>
              ))}
            </div>
          </Section>

          {/* ---------------- loss diagnostics ---------------- */}
          <Section title="Why are trades losing?" subtitle="Rule-based attribution over losing trades — diagnostics, not proven causation.">
            {result.lossReasons.length === 0 ? (
              <p className="text-xs text-muted-foreground">No losing trades in this run (or none to attribute).</p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr><th className="px-2 py-1.5 font-medium">Reason</th><th className="px-2 py-1.5 font-medium">Description</th><th className="px-2 py-1.5 text-right font-medium">Count</th><th className="px-2 py-1.5 text-right font-medium">% of losers</th></tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {result.lossReasons.map((r) => (
                    <tr key={r.reason} className="text-muted-foreground">
                      <td className="px-2 py-1.5 font-mono text-[11px]">{r.reason}</td>
                      <td className="px-2 py-1.5">{r.description}</td>
                      <td className="px-2 py-1.5 text-right">{r.count}</td>
                      <td className="px-2 py-1.5 text-right">{r.pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {/* ---------------- MFE/MAE ---------------- */}
          <Section title="MFE / MAE analysis" subtitle="Maximum favourable / adverse excursion in R against the initial risk.">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="grid grid-cols-2 gap-3">
                <div className={metricCard}><p className="text-xs text-muted-foreground">Avg MFE — winners</p><p className="font-bold text-emerald-400">+{result.mfeMae.avgMfeWinners}R</p></div>
                <div className={metricCard}><p className="text-xs text-muted-foreground">Avg MFE — losers</p><p className="font-bold">+{result.mfeMae.avgMfeLosers}R</p></div>
                <div className={metricCard}><p className="text-xs text-muted-foreground">Avg MAE — winners</p><p className="font-bold">{result.mfeMae.avgMaeWinners}R</p></div>
                <div className={metricCard}><p className="text-xs text-muted-foreground">Avg MAE — losers</p><p className="font-bold text-red-400">{result.mfeMae.avgMaeLosers}R</p></div>
                <div className="col-span-2 space-y-1">
                  {result.mfeMae.reading.map((r, i) => (
                    <p key={i} className="text-xs text-muted-foreground">• {r}</p>
                  ))}
                </div>
              </div>
              <MfeMaeScatter points={result.mfeMae.points} />
            </div>
          </Section>

          {/* ---------------- sessions + score buckets ---------------- */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Session performance">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr><th className="px-2 py-1.5 font-medium">Session</th><th className="px-2 py-1.5 text-right font-medium">Trades</th><th className="px-2 py-1.5 text-right font-medium">WR</th><th className="px-2 py-1.5 text-right font-medium">Expectancy</th><th className="px-2 py-1.5 text-right font-medium">Net R</th></tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {result.sessions.map((s) => (
                    <tr key={s.session} className="text-muted-foreground">
                      <td className="px-2 py-1.5">{s.session}</td>
                      <td className="px-2 py-1.5 text-right">{s.trades}</td>
                      <td className="px-2 py-1.5 text-right">{s.winRate}%</td>
                      <td className={`px-2 py-1.5 text-right ${s.expectancyR >= 0 ? "text-emerald-400" : "text-red-400"}`}>{s.expectancyR}R</td>
                      <td className="px-2 py-1.5 text-right">{s.netR}R</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
            <Section title="Score tiers" subtitle="The score is a strategy-quality grade, not a probability.">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr><th className="px-2 py-1.5 font-medium">Score band</th><th className="px-2 py-1.5 text-right font-medium">Trades</th><th className="px-2 py-1.5 text-right font-medium">WR</th><th className="px-2 py-1.5 text-right font-medium">Expectancy</th><th className="px-2 py-1.5 text-right font-medium">Net R</th></tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {result.scoreBuckets.map((b) => (
                    <tr key={b.bucket} className="text-muted-foreground">
                      <td className="px-2 py-1.5">{b.bucket}</td>
                      <td className="px-2 py-1.5 text-right">{b.trades}</td>
                      <td className="px-2 py-1.5 text-right">{b.winRate}%</td>
                      <td className={`px-2 py-1.5 text-right ${b.expectancyR >= 0 ? "text-emerald-400" : "text-red-400"}`}>{b.expectancyR}R</td>
                      <td className="px-2 py-1.5 text-right">{b.netR}R</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          </div>

          {/* ---------------- sensitivity ---------------- */}
          {result.sensitivity && (
            <Section title="minRR sensitivity across this period" subtitle="Stability view only — do not pick the best number from profit; check that behaviour is consistent.">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr><th className="px-2 py-1.5 font-medium">minRR</th><th className="px-2 py-1.5 text-right font-medium">Trades</th><th className="px-2 py-1.5 text-right font-medium">WR</th><th className="px-2 py-1.5 text-right font-medium">Expectancy</th><th className="px-2 py-1.5 text-right font-medium">PF</th><th className="px-2 py-1.5 text-right font-medium">Net R</th></tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {result.sensitivity.map((s) => (
                    <tr key={s.minRR} className={`text-muted-foreground ${String(s.minRR) === minRR ? "text-foreground" : ""}`}>
                      <td className="px-2 py-1.5 font-mono">{s.minRR}R</td>
                      <td className="px-2 py-1.5 text-right">{s.trades}</td>
                      <td className="px-2 py-1.5 text-right">{s.winRate}%</td>
                      <td className={`px-2 py-1.5 text-right ${s.expectancyR >= 0 ? "text-emerald-400" : "text-red-400"}`}>{s.expectancyR}R</td>
                      <td className="px-2 py-1.5 text-right">{s.profitFactor}</td>
                      <td className="px-2 py-1.5 text-right">{s.netR}R</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {/* ---------------- trade management + risk ---------------- */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Trade management">
              <div className="grid grid-cols-3 gap-3">
                <div className={metricCard}><p className="text-xs text-muted-foreground">TP1 hit</p><p className="font-bold">{result.management.tp1HitRate}%</p></div>
                <div className={metricCard}><p className="text-xs text-muted-foreground">TP2 hit</p><p className="font-bold">{result.management.tp2HitRate}%</p></div>
                <div className={metricCard}><p className="text-xs text-muted-foreground">TP3 hit</p><p className="font-bold">{result.management.tp3HitRate}%</p></div>
                <div className={metricCard}><p className="text-xs text-muted-foreground">BE activated</p><p className="font-bold">{result.management.beRate}%</p></div>
                <div className={metricCard}><p className="text-xs text-muted-foreground">Timeout</p><p className="font-bold">{result.management.timeoutRate}%</p></div>
                <div className={metricCard}><p className="text-xs text-muted-foreground">Initial SL</p><p className="font-bold">{result.management.slRate}%</p></div>
              </div>
            </Section>
            <Section title="Risk analysis">
              <div className="grid grid-cols-3 gap-3">
                <div className={metricCard}><p className="text-xs text-muted-foreground">Avg win</p><p className="font-bold text-emerald-400">+{m.avgWinR}R</p></div>
                <div className={metricCard}><p className="text-xs text-muted-foreground">Avg loss</p><p className="font-bold text-red-400">{m.avgLossR}R</p></div>
                <div className={metricCard}><p className="text-xs text-muted-foreground">Max consec. losses</p><p className="font-bold">{result.report.risk.maxConsecutiveLosses}</p></div>
                <div className={metricCard}><p className="text-xs text-muted-foreground">Largest win</p><p className="font-bold">+{result.report.risk.largestWinR}R</p></div>
                <div className={metricCard}><p className="text-xs text-muted-foreground">Largest loss</p><p className="font-bold">{result.report.risk.largestLossR}R</p></div>
                <div className={metricCard}><p className="text-xs text-muted-foreground">Best / worst streak</p><p className="font-bold">{m.bestStreak} / {m.worstStreak}</p></div>
              </div>
            </Section>
          </div>

          {/* ---------------- report diagnostics ---------------- */}
          <Section title="Setup diagnostics">
            <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
              <p>Best setup: {result.report.diagnostics.bestSetup ? `${result.report.diagnostics.bestSetup.side} @ ${fmtDate(result.report.diagnostics.bestSetup.entryTime)} (${result.report.diagnostics.bestSetup.netR}R)` : "—"}</p>
              <p>Worst setup: {result.report.diagnostics.worstSetup ? `${result.report.diagnostics.worstSetup.side} @ ${fmtDate(result.report.diagnostics.worstSetup.entryTime)} (${result.report.diagnostics.worstSetup.netR}R)` : "—"}</p>
              <p>Best session: {result.report.diagnostics.bestSession ? `${result.report.diagnostics.bestSession.session} (${result.report.diagnostics.bestSession.expectancyR}R exp)` : "—"}</p>
              <p>Worst session: {result.report.diagnostics.worstSession ? `${result.report.diagnostics.worstSession.session} (${result.report.diagnostics.worstSession.expectancyR}R exp)` : "—"}</p>
              <p>Best score band: {result.report.diagnostics.bestScoreRange ? `${result.report.diagnostics.bestScoreRange.bucket} (${result.report.diagnostics.bestScoreRange.expectancyR}R exp)` : "—"}</p>
              <p>Worst score band: {result.report.diagnostics.worstScoreRange ? `${result.report.diagnostics.worstScoreRange.bucket} (${result.report.diagnostics.worstScoreRange.expectancyR}R exp)` : "—"}</p>
            </div>
          </Section>

          {/* ---------------- trades ---------------- */}
          <div className="rounded-xl border border-border">
            <div className="border-b border-border/60 px-4 py-3">
              <h3 className="text-sm font-semibold">Trades ({result.trades.length}) — initial stop is preserved even after breakeven moves</h3>
            </div>
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Side</th>
                    <th className="px-3 py-2 font-medium">Entry time</th>
                    <th className="px-3 py-2 font-medium">Tier</th>
                    <th className="px-3 py-2 font-medium">Entry</th>
                    <th className="px-3 py-2 font-medium">Init stop</th>
                    <th className="px-3 py-2 font-medium">Stop @ exit</th>
                    <th className="px-3 py-2 font-medium">Outcome</th>
                    <th className="px-3 py-2 font-medium">Legs</th>
                    <th className="px-3 py-2 text-right font-medium">Net R</th>
                    <th className="px-3 py-2 text-right font-medium">MFE/MAE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {result.trades.map((t) => (
                    <tr key={t.id} className="align-top text-muted-foreground">
                      <td className={`px-3 py-2 font-semibold ${t.side === "LONG" ? "text-emerald-400" : "text-red-400"}`}>{t.side}</td>
                      <td className="px-3 py-2">
                        {fmtDate(t.entryTime)} {new Date(t.entryTime * 1000).toISOString().slice(11, 16)}
                        <AuditViewer trade={t} />
                      </td>
                      <td className="px-3 py-2"><span className="font-mono text-gold">{t.tier}</span> <span className="text-[10px]">{t.totalScore}</span></td>
                      <td className="px-3 py-2 font-mono">{t.entry.toFixed(2)}</td>
                      <td className="px-3 py-2 font-mono">{t.initialStop.toFixed(2)}</td>
                      <td className="px-3 py-2 font-mono">
                        {t.currentStop.toFixed(2)}
                        {t.breakevenStop !== null && <span className="block text-[10px] text-gold/70">BE {t.breakevenStop.toFixed(2)}</span>}
                      </td>
                      <td className="px-3 py-2">{t.outcome}</td>
                      <td className="px-3 py-2 text-[10px]">{t.legs.map((l) => `${l.label} ${(l.share * 100).toFixed(0)}%`).join(", ")}</td>
                      <td className={`px-3 py-2 text-right font-mono font-semibold ${t.netR >= 0 ? "text-emerald-400" : "text-red-400"}`}>{t.netR}R</td>
                      <td className="px-3 py-2 text-right font-mono">{t.mfeR}/{t.maeR}</td>
                    </tr>
                  ))}
                  {result.trades.length === 0 && (
                    <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">No trades passed the sequence, quality and RR filters on this history — NO TRADE is a first-class result.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {result.sensitivity === undefined && null}

          <ul className="space-y-1">
            {result.notes.map((n, i) => (
              <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                <span aria-hidden className="text-gold">▸</span>{n}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Win rate alone is meaningless without expectancy: a 35% win rate at 2.5R average win
            beats a 60% win rate at 0.5R. Judge systems by expectancy, drawdown and stability across
            periods — never by strike rate alone.
          </p>
        </>
      )}
    </div>
  );
}
