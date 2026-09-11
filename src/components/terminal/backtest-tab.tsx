"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "./auth-provider";
import { fmtDate } from "./format";
import type { BacktestResult, StrictnessComparisonRow } from "@/lib/ict/backtest";
import type { ConfluenceItem, RejectedSetupSample, TradeRecord } from "@/lib/ict/types";

const metricCard = "rounded-lg border border-border bg-card px-3 py-2.5";
const selectCls = "h-9 rounded-lg border border-border bg-background px-2 text-sm";

/** N/A-aware numeric display (spec §13). */
function num(v: number | null | undefined, suffix = ""): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "N/A";
  return `${v}${suffix}`;
}

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

function SampleBanner({ result }: { result: BacktestResult }) {
  const { category, label, note } = result.sampleInfo;
  const cls =
    category === "MODERATE" || category === "STRONGER"
      ? "border-emerald-900/50 bg-emerald-950/30 text-emerald-300"
      : category === "LOW"
        ? "border-amber-900/50 bg-amber-950/30 text-amber-300"
        : "border-red-900/50 bg-red-950/30 text-red-300";
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${cls}`} role="status">
      <span className="font-bold">Sample size: {label}</span>
      <span className="ml-2 text-xs">{result.metrics.trades} trades</span>
      <p className="mt-1 text-xs opacity-90">{note}</p>
    </div>
  );
}

/** Mini candlestick chart around a rejected setup (spec §19). */
function MiniCandles({ sample }: { sample: RejectedSetupSample }) {
  const cs = sample.candles;
  if (cs.length < 3) return null;
  const w = 560;
  const h = 180;
  const pad = 26;
  const levels = [sample.entry, sample.initialStop, sample.target].filter((v): v is number => v !== null);
  const hi = Math.max(...cs.map((c) => c.h), ...levels);
  const lo = Math.min(...cs.map((c) => c.l), ...levels);
  const span = Math.max(1e-9, hi - lo);
  const cw = (w - pad - 8) / cs.length;
  const y = (v: number) => h - pad - ((v - lo) / span) * (h - pad - 12);
  const decIdx = sample.index - sample.candleStartIndex;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label={`Rejected setup candles around ${sample.stageReached}`}>
      {cs.map((c, i) => {
        const up = c.c >= c.o;
        const color = up ? "#2fbf71" : "#e5484d";
        const cx = pad + i * cw + cw / 2;
        const yo = y(c.o);
        const yc = y(c.c);
        const isDecision = i === decIdx;
        return (
          <g key={i}>
            <line x1={cx} y1={y(c.h)} x2={cx} y2={y(c.l)} stroke={color} strokeWidth={1} />
            <rect x={cx - cw * 0.32} y={Math.min(yo, yc)} width={cw * 0.64} height={Math.max(1, Math.abs(yc - yo))} fill={color} />
            {isDecision && <rect x={pad + i * cw} y={4} width={cw} height={h - 8} fill="rgba(224,164,48,0.10)" />}
          </g>
        );
      })}
      {sample.entry !== null && <line x1={pad} y1={y(sample.entry)} x2={w - 8} y2={y(sample.entry)} stroke="#e0a430" strokeWidth={1} strokeDasharray="4 3" />}
      {sample.initialStop !== null && <line x1={pad} y1={y(sample.initialStop)} x2={w - 8} y2={y(sample.initialStop)} stroke="#e5484d" strokeWidth={1} strokeDasharray="4 3" />}
      {sample.target !== null && <line x1={pad} y1={y(sample.target)} x2={w - 8} y2={y(sample.target)} stroke="#2fbf71" strokeWidth={1} strokeDasharray="4 3" />}
      <text x={pad} y={12} fontSize="9" fill="rgba(255,255,255,0.55)">
        {sample.entry !== null ? `entry ${sample.entry} · SL ${sample.initialStop} · TP ${sample.target} (${sample.rr}R)` : `rejected at: ${sample.stageReached}`}
      </text>
    </svg>
  );
}

/** Rejected-setup inspector (spec §19). */
function RejectedInspector({ samples }: { samples: RejectedSetupSample[] }) {
  const [selected, setSelected] = useState(0);
  if (samples.length === 0) return <p className="text-xs text-muted-foreground">No sampled rejections in this run.</p>;
  const s = samples[Math.min(selected, samples.length - 1)];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {samples.map((x, i) => (
          <button
            key={i}
            onClick={() => setSelected(i)}
            className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${i === selected ? "bg-gold/30 text-foreground" : "bg-muted/60 text-muted-foreground hover:bg-muted"}`}
            title={`${x.model} · ${x.rejection} · ${x.side}`}
          >
            {new Date(x.time * 1000).toISOString().slice(5, 10)}
          </button>
        ))}
      </div>
      {s && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded bg-red-950/40 px-2 py-0.5 font-mono text-red-300">{s.rejection}</span>
            <span className="text-muted-foreground">{s.model} · {s.side} · {s.session}</span>
            <span className="ml-auto text-muted-foreground">{fmtDate(s.time)} · bar #{s.index}</span>
          </div>
          <MiniCandles sample={s} />
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
            <p>Stage reached: <span className="text-foreground/90">{s.stageReached}</span></p>
            <p>Entry: <span className="font-mono">{s.entry ?? "—"}</span></p>
            <p>Initial SL: <span className="font-mono">{s.initialStop ?? "—"}</span></p>
            <p>Max RR available: <span className="font-mono">{s.maxRrAvailable ?? "—"}</span></p>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Chart state at the decision bar (gold band) — the engine saw these candles and rejected the candidate at the stage above. Entry/SL/TP lines appear once the candidate got that far.
          </p>
        </div>
      )}
    </div>
  );
}

const TRACE_ORDER: { key: string; label: string }[] = [
  { key: "htfBias", label: "HTF bias" },
  { key: "dealingRange", label: "Dealing range" },
  { key: "premiumDiscount", label: "Premium/discount" },
  { key: "liquidityPool", label: "Liquidity pool" },
  { key: "liquiditySweep", label: "Liquidity sweep" },
  { key: "mss", label: "MSS/CHOCH" },
  { key: "displacement", label: "Displacement" },
  { key: "fvg", label: "FVG" },
  { key: "orderBlock", label: "Order block" },
  { key: "session", label: "Session" },
  { key: "smt", label: "SMT" },
  { key: "structuralStop", label: "Structural SL" },
  { key: "structuralTarget", label: "Structural target" },
  { key: "rr", label: "RR" },
  { key: "score", label: "Score" },
];

/** Per-condition traceability viewer for executed trades (spec §3). */
function ConfluenceViewer({ trade }: { trade: TradeRecord }) {
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-[11px] text-gold hover:underline">confluence trace (why each condition was true)</summary>
      <ul className="mt-1 max-h-72 space-y-1.5 overflow-y-auto rounded-md border border-border/60 bg-background/60 p-2">
        {TRACE_ORDER.map(({ key, label }) => {
          const item = (trade.confluence as unknown as Record<string, ConfluenceItem>)[key];
          if (!item) return null;
          return (
            <li key={key} className="flex items-start gap-2 text-[11px]">
              <span aria-hidden className={item.detected ? "text-emerald-400" : "text-red-400"}>{item.detected ? "✓" : "✗"}</span>
              <span className="text-muted-foreground"><span className="font-medium text-foreground/85">{label}</span> [{item.timeframe}] — {item.reason}</span>
            </li>
          );
        })}
      </ul>
    </details>
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
  const [sessions, setSessions] = useState("");
  const [strictness, setStrictness] = useState("balanced");
  const [sensitivity, setSensitivity] = useState(false);
  const [compare, setCompare] = useState(false);
  const [result, setResult] = useState<(BacktestResult & {
    sensitivity?: { minRR: number; trades: number; winRate: number | null; expectancyR: number | null; profitFactor: number | null; netR: number }[];
    comparison?: StrictnessComparisonRow[];
  }) | null>(null);
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
        strictness,
      });
      if (sensitivity) params.set("sensitivity", "1.5,2,2.5,3");
      if (compare) params.set("compare", "1");
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
            <option value="5min">5m</option>
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
          <label htmlFor="bt-strict" className="mb-1 block text-xs text-muted-foreground">Strictness</label>
          <select id="bt-strict" value={strictness} onChange={(e) => setStrictness(e.target.value)} className={selectCls}>
            <option value="conservative">Conservative</option>
            <option value="balanced">Balanced</option>
            <option value="aggressive">Aggressive</option>
          </select>
        </div>
        <div>
          <label htmlFor="bt-sessions" className="mb-1 block text-xs text-muted-foreground">Sessions</label>
          <select id="bt-sessions" value={sessions} onChange={(e) => setSessions(e.target.value)} className={selectCls}>
            <option value="">All sessions</option>
            <option value="london">London KZ</option>
            <option value="ny-am,ny-pm">New York KZ</option>
            <option value="london,ny-am,ny-pm">London + NY</option>
            <option value="asia">Asian KZ</option>
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
        <label className="flex items-center gap-2 pb-2 text-xs text-muted-foreground" title="Runs Conservative / Balanced / Aggressive on the same data (spec §16)">
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="accent-[var(--gold)]" />
          compare strictness
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
        <div className="space-y-6">
          {/* ---------------- robustness flags ---------------- */}
          <div className={`rounded-lg border px-4 py-3 text-sm ${flagCls}`} role="status">
            <span className="font-bold">Robustness: {flags.level}</span>
            <ul className="mt-1 space-y-0.5 text-xs opacity-90">
              {flags.reasons.map((r, i) => <li key={i}>• {r}</li>)}
            </ul>
          </div>

          <SampleBanner result={result} />

          {/* ---------------- executive summary ---------------- */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <div className={metricCard}>
              <p className="text-xs text-muted-foreground">Trades</p>
              <p className="text-lg font-bold">{m.trades}</p>
            </div>
            <div className={metricCard}>
              <p className="text-xs text-muted-foreground">Win rate</p>
              <p className="text-lg font-bold">{num(m.winRate, "%")}</p>
            </div>
            <div className={metricCard}>
              <p className="text-xs text-muted-foreground" title="Net of spread, slippage and commission (spec §14)">Expectancy (net)</p>
              <p className={`text-lg font-bold ${m.expectancyR !== null ? (m.expectancyR >= 0 ? "text-emerald-400" : "text-red-400") : ""}`}>{num(m.expectancyR, "R")}</p>
            </div>
            <div className={metricCard}>
              <p className="text-xs text-muted-foreground" title="Before costs (spec §14)">Expectancy (gross)</p>
              <p className="text-lg font-bold">{num(m.expectancyGrossR, "R")}</p>
            </div>
            <div className={metricCard}>
              <p className="text-xs text-muted-foreground" title="N/A when the sample has no losing trades — never 99 (spec §13)">Profit factor</p>
              <p className="text-lg font-bold">
                {m.profitFactor === null && m.trades > 0 ? <span className="text-sm">N/A <span className="block text-[10px] font-normal text-muted-foreground">no losing trades in sample</span></span> : num(m.profitFactor)}
              </p>
            </div>
            <div className={metricCard}>
              <p className="text-xs text-muted-foreground">Max drawdown</p>
              <p className="text-lg font-bold text-amber-400">{m.maxDrawdownR}R</p>
            </div>
            <div className={metricCard}>
              <p className="text-xs text-muted-foreground">Gross / costs</p>
              <p className="text-sm font-bold">{m.grossR}R <span className="text-xs text-muted-foreground">− {m.costsR}R</span></p>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Equity curve (net R)</h3>
              <span className="text-xs text-muted-foreground">
                {fmtDate(result.from)} → {fmtDate(result.to)} · {result.bars} bars · {result.source} · {result.strictness} preset
              </span>
            </div>
            <EquityCurve points={result.equityCurve} />
          </div>

          {/* ---------------- STRATEGY DIAGNOSTICS: signal funnel (spec §1) ---------------- */}
          <Section
            title="Strategy diagnostics — signal funnel"
            subtitle="How many opportunities survive each stage (count + % of total candles). bars = per-candle facts · candidates = bar × model opportunities. Shows exactly where the strategy is too loose or too strict."
          >
            <div className="space-y-2">
              {result.funnel.map((f) => (
                <div key={f.stage}>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">
                      {f.stage} <span className="ml-1 rounded bg-muted/60 px-1 text-[10px] uppercase">{f.unit}</span>
                    </span>
                    <span className="font-mono">{f.count} <span className="text-muted-foreground">{f.pct}%</span></span>
                  </div>
                  <Bar value={f.count} max={maxFunnel} />
                </div>
              ))}
            </div>
          </Section>

          {/* ---------------- rejection reasons (spec §2) ---------------- */}
          <Section
            title="Rejection reasons (primary, ranked)"
            subtitle="For every rejected opportunity the engine records the deepest stage reached and why. This tells you which filter to examine — before touching anything."
          >
            {result.rejections.length === 0 ? (
              <p className="text-xs text-muted-foreground">No rejections recorded.</p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr><th className="px-2 py-1.5 font-medium">Rejection reason</th><th className="px-2 py-1.5 font-medium">Code</th><th className="px-2 py-1.5 text-right font-medium">Count</th></tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {result.rejections.map((r) => (
                    <tr key={r.code} className="text-muted-foreground">
                      <td className="px-2 py-1.5">{r.label}</td>
                      <td className="px-2 py-1.5 font-mono text-[11px]">{r.code}</td>
                      <td className="px-2 py-1.5 text-right font-semibold">{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {/* ---------------- setup model performance (spec §7) ---------------- */}
          <Section
            title="Setup model performance"
            subtitle="Which ICT model actually produces trades — and whether it has an edge. Top rejections show where each model loses its opportunities."
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Model</th>
                    <th className="px-2 py-1.5 text-right font-medium">Opportunities</th>
                    <th className="px-2 py-1.5 text-right font-medium">Valid setups</th>
                    <th className="px-2 py-1.5 text-right font-medium">Trades</th>
                    <th className="px-2 py-1.5 text-right font-medium">Win rate</th>
                    <th className="px-2 py-1.5 text-right font-medium">Expectancy</th>
                    <th className="px-2 py-1.5 text-right font-medium">PF</th>
                    <th className="px-2 py-1.5 text-right font-medium">Net R</th>
                    <th className="px-2 py-1.5 font-medium">Top rejections</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {result.modelStats.map((mm) => (
                    <tr key={mm.model} className="text-muted-foreground">
                      <td className="px-2 py-1.5 font-medium text-foreground/90">{mm.label}</td>
                      <td className="px-2 py-1.5 text-right">{mm.opportunities}</td>
                      <td className="px-2 py-1.5 text-right">{mm.validSetups}</td>
                      <td className="px-2 py-1.5 text-right font-semibold">{mm.trades}</td>
                      <td className="px-2 py-1.5 text-right">{num(mm.winRate, "%")}</td>
                      <td className={`px-2 py-1.5 text-right ${(mm.expectancyR ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>{num(mm.expectancyR, "R")}</td>
                      <td className="px-2 py-1.5 text-right">{num(mm.profitFactor)}</td>
                      <td className="px-2 py-1.5 text-right">{mm.netR}R</td>
                      <td className="px-2 py-1.5 font-mono text-[10px]">{mm.topRejections.map((t) => `${t.code}:${t.count}`).join(" ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* ---------------- RR + session filter diagnostics (spec §9, §10) ---------------- */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Section
              title="RR filter diagnostics"
              subtitle="Counted BEFORE the minimum-RR gate applies — shows whether 2R is the bottleneck. The gate asks whether AT LEAST ONE structural target is minRR away (TP3 = the farthest level, not the 3rd-nearest)."
            >
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">Candidates reaching the target stage</span><span className="font-mono">{result.rrDiagnostics.evaluated}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">With a structural target ladder</span><span className="font-mono">{result.rrDiagnostics.beforeFilter}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">RR ≥ 1.5R</span><span className="font-mono">{result.rrDiagnostics.ge1_5}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">RR ≥ 2.0R</span><span className="font-mono">{result.rrDiagnostics.ge2}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">RR ≥ 2.5R</span><span className="font-mono">{result.rrDiagnostics.ge2_5}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">RR ≥ 3.0R</span><span className="font-mono">{result.rrDiagnostics.ge3}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Median max available RR</span><span className="font-mono">{num(result.rrDiagnostics.medianMaxRr, "R")}</span></div>
              </div>
            </Section>

            <Section title="Session filter diagnostics" subtitle={result.sessionFilterDiagnostics.note}>
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr><th className="px-2 py-1.5 font-medium">Session</th><th className="px-2 py-1.5 text-right font-medium">Valid setups</th></tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {result.sessionFilterDiagnostics.bySession.map((s) => (
                    <tr key={s.session} className="text-muted-foreground">
                      <td className="px-2 py-1.5">{s.label}</td>
                      <td className="px-2 py-1.5 text-right font-semibold">{s.setups}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Current run traded: {result.config.sessions.length ? result.config.sessions.join(", ") : "all sessions"}. Kill zones are DST-aware market-local windows.
              </p>
            </Section>
          </div>

          {/* ---------------- strictness comparison (spec §16, §17) ---------------- */}
          {result.comparison && (
            <Section
              title="Strictness comparison — Conservative vs Balanced vs Aggressive"
              subtitle="Same data, three presets, shown objectively. Do NOT assume aggressive is better — compare trades, expectancy, PF, drawdown and stability."
            >
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-muted-foreground">
                    <tr><th className="px-2 py-1.5 font-medium">Preset</th><th className="px-2 py-1.5 text-right font-medium">Trades</th><th className="px-2 py-1.5 text-right font-medium">Win%</th><th className="px-2 py-1.5 text-right font-medium">Expectancy</th><th className="px-2 py-1.5 text-right font-medium">PF</th><th className="px-2 py-1.5 text-right font-medium">Max DD</th><th className="px-2 py-1.5 text-right font-medium">Net R</th><th className="px-2 py-1.5 font-medium">Models with trades</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {result.comparison.map((c) => (
                      <tr key={c.strictness} className={`text-muted-foreground ${c.strictness === result.strictness ? "text-foreground" : ""}`}>
                        <td className="px-2 py-1.5 font-medium" title={c.description}>{c.strictness}</td>
                        <td className="px-2 py-1.5 text-right">{c.trades}</td>
                        <td className="px-2 py-1.5 text-right">{num(c.winRate, "%")}</td>
                        <td className={`px-2 py-1.5 text-right ${(c.expectancyR ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>{num(c.expectancyR, "R")}</td>
                        <td className="px-2 py-1.5 text-right">{num(c.profitFactor)}</td>
                        <td className="px-2 py-1.5 text-right">{c.maxDrawdownR}R</td>
                        <td className="px-2 py-1.5 text-right font-semibold">{c.netR}R</td>
                        <td className="px-2 py-1.5 text-[10px]">{c.modelBreakdown.map((mb) => `${mb.model} (${mb.trades})`).join(", ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* ---------------- rejected setup inspector (spec §19) ---------------- */}
          <Section
            title="Rejected setup inspector"
            subtitle="Sampled rejected opportunities with the chart state the engine saw at the decision bar — click a date to inspect. Visual verification of the strategy."
          >
            <RejectedInspector samples={result.rejectedSamples} />
          </Section>

          {/* ---------------- walk-forward ---------------- */}
          <Section title="Walk-forward periods" subtitle={result.walkForward.note}>
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
                      <td className="px-2 py-1.5 text-right">{num(p.winRate, "%")}</td>
                      <td className={`px-2 py-1.5 text-right ${(p.expectancyR ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>{num(p.expectancyR, "R")}</td>
                      <td className="px-2 py-1.5 text-right">{num(p.profitFactor)}</td>
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
                    {s.stats.trades} trades · {num(s.stats.winRate, "%")} WR · {num(s.stats.expectancyR, "R")} exp · PF {num(s.stats.profitFactor)}
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
            <Section title="Session performance (trades)">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr><th className="px-2 py-1.5 font-medium">Session</th><th className="px-2 py-1.5 text-right font-medium">Trades</th><th className="px-2 py-1.5 text-right font-medium">WR</th><th className="px-2 py-1.5 text-right font-medium">Expectancy</th><th className="px-2 py-1.5 text-right font-medium">Net R</th></tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {result.sessions.map((s) => (
                    <tr key={s.session} className="text-muted-foreground">
                      <td className="px-2 py-1.5">{s.session}</td>
                      <td className="px-2 py-1.5 text-right">{s.trades}</td>
                      <td className="px-2 py-1.5 text-right">{num(s.winRate, "%")}</td>
                      <td className={`px-2 py-1.5 text-right ${(s.expectancyR ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>{num(s.expectancyR, "R")}</td>
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
                      <td className="px-2 py-1.5 text-right">{num(b.winRate, "%")}</td>
                      <td className={`px-2 py-1.5 text-right ${(b.expectancyR ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>{num(b.expectancyR, "R")}</td>
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
                      <td className="px-2 py-1.5 text-right">{num(s.winRate, "%")}</td>
                      <td className={`px-2 py-1.5 text-right ${(s.expectancyR ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>{num(s.expectancyR, "R")}</td>
                      <td className="px-2 py-1.5 text-right">{num(s.profitFactor)}</td>
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

          {/* ---------------- data quality ---------------- */}
          <Section title="Data quality audit" subtitle="Historical feed sanity check (spec §18) — duplicate/out-of-order candles, gaps, invalid OHLC.">
            <p className={`text-xs ${result.dataQuality.ok ? "text-emerald-400" : "text-amber-400"}`}>{result.dataQuality.note}</p>
            <div className="mt-2 grid grid-cols-2 gap-3 text-xs sm:grid-cols-6">
              <div className={metricCard}><p className="text-[10px] text-muted-foreground">Bars</p><p className="font-bold">{result.dataQuality.bars}</p></div>
              <div className={metricCard}><p className="text-[10px] text-muted-foreground">Duplicates</p><p className="font-bold">{result.dataQuality.duplicates}</p></div>
              <div className={metricCard}><p className="text-[10px] text-muted-foreground">Out of order</p><p className="font-bold">{result.dataQuality.outOfOrder}</p></div>
              <div className={metricCard}><p className="text-[10px] text-muted-foreground">Gaps</p><p className="font-bold">{result.dataQuality.gaps}</p></div>
              <div className={metricCard}><p className="text-[10px] text-muted-foreground">Largest gap</p><p className="font-bold">{result.dataQuality.largestGapBars} bars</p></div>
              <div className={metricCard}><p className="text-[10px] text-muted-foreground">Invalid OHLC</p><p className="font-bold">{result.dataQuality.invalidOhlc}</p></div>
            </div>
          </Section>

          {/* ---------------- trades ---------------- */}
          <div className="rounded-xl border border-border">
            <div className="border-b border-border/60 px-4 py-3">
              <h3 className="text-sm font-semibold">Trades ({result.trades.length}) — initial stop preserved even after breakeven moves</h3>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {result.trades.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                  No trades — NO TRADE is a first-class outcome. Check the funnel and rejection table above to see why.
                </p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">#</th>
                      <th className="px-2 py-1.5 font-medium">Side</th>
                      <th className="px-2 py-1.5 font-medium">Model</th>
                      <th className="px-2 py-1.5 text-right font-medium">Entry</th>
                      <th className="px-2 py-1.5 text-right font-medium">Init SL</th>
                      <th className="px-2 py-1.5 text-right font-medium">Current</th>
                      <th className="px-2 py-1.5 text-right font-medium">Outcome</th>
                      <th className="px-2 py-1.5 text-right font-medium">Gross R</th>
                      <th className="px-2 py-1.5 text-right font-medium">Net R</th>
                      <th className="px-2 py-1.5 text-right font-medium">MFE</th>
                      <th className="px-2 py-1.5 text-right font-medium">MAE</th>
                      <th className="px-2 py-1.5 font-medium">Entry time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {result.trades.map((t, idx) => (
                      <tr key={t.id} className="text-muted-foreground">
                        <td className="px-2 py-1.5">{idx + 1}</td>
                        <td className={`px-2 py-1.5 font-medium ${t.side === "LONG" ? "text-emerald-400" : "text-red-400"}`}>{t.side}</td>
                        <td className="px-2 py-1.5 text-[10px]">{t.model.replace("_", " ")}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{t.entry}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{t.initialStop}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{t.currentStop}</td>
                        <td className="px-2 py-1.5 text-right">{t.outcome}</td>
                        <td className="px-2 py-1.5 text-right">{t.grossR}R</td>
                        <td className={`px-2 py-1.5 text-right font-semibold ${t.netR >= 0 ? "text-emerald-400" : "text-red-400"}`}>{t.netR}R</td>
                        <td className="px-2 py-1.5 text-right">{t.mfeR}R</td>
                        <td className="px-2 py-1.5 text-right">{t.maeR}R</td>
                        <td className="px-2 py-1.5">{fmtDate(t.entryTime)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {result.trades.length > 0 && (
              <div className="divide-y divide-border/60 border-t border-border/60">
                {result.trades.map((t) => (
                  <div key={`d-${t.id}`} className="px-4 py-2">
                    <p className="text-[11px] text-muted-foreground">
                      <span className={t.side === "LONG" ? "font-semibold text-emerald-400" : "font-semibold text-red-400"}>{t.side}</span> @ {fmtDate(t.entryTime)} — {t.rationale[0]}
                    </p>
                    <ConfluenceViewer trade={t} />
                    <AuditViewer trade={t} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ---------------- notes ---------------- */}
          <div className="rounded-xl border border-border/60 bg-card/50 p-4">
            <h3 className="text-sm font-semibold">Methodology notes</h3>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {result.notes.map((n, i) => <li key={i}>• {n}</li>)}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
