"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "./auth-provider";
import { fmtDate } from "./format";
import { parseCsvCandles, intervalLabelOfKey, granularityLabel, coarseContext, type CsvParseSummary, type CoarseContext } from "@/lib/market/csv";
import type { Candle, SymbolKey } from "@/lib/market/types";
import type { BacktestResult, StrictnessComparisonRow, DimensionComparison, CompareDimension, DimensionRow, SensitivityRow } from "@/lib/ict/backtest";
import type { Strictness } from "@/lib/ict/sequence";
import type { ConfluenceItem, RejectedSetupSample, TradeRecord } from "@/lib/ict/types";

const metricCard = "rounded-lg border border-border bg-card px-3 py-2.5";
const selectCls = "h-9 rounded-lg border border-border bg-background px-2 text-sm";
/** label for the 6-period dealing range shown in the coarse-file macro context */
const LEG_NAME: Record<string, string> = { daily: "6-day", weekly: "6-week", monthly: "6-month" };

/** N/A-aware numeric display (spec §13). */
function num(v: number | null | undefined, suffix = ""): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "N/A";
  return `${v}${suffix}`;
}

function EquityCurve({ points, from, to }: { points: { time: number; r: number }[]; from: number; to: number }) {
  if (points.length < 1 || !(to > from)) return null;
  const w = 640;
  const h = 170;
  const padL = 6;
  const padR = 44;
  // time-scaled x-axis: a 3-trade month must NOT look like a uniform ladder
  const start = [{ time: from, r: 0 }, ...points];
  const rs = start.map((p) => p.r);
  const min = Math.min(0, ...rs);
  const max = Math.max(0.5, ...rs);
  const x = (t: number) => padL + ((t - from) / (to - from)) * (w - padL - padR);
  const y = (r: number) => h - 12 - ((r - min) / (max - min)) * (h - 24);
  // step-after path: equity only changes at trade exits
  let path = `M${x(start[0].time).toFixed(1)},${y(start[0].r).toFixed(1)}`;
  for (let i = 1; i < start.length; i++) {
    path += ` H${x(start[i].time).toFixed(1)} V${y(start[i].r).toFixed(1)}`;
  }
  const zeroY = y(0);
  const positive = rs[rs.length - 1] >= 0;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Equity curve in R multiples over time">
      <line x1="0" y1={zeroY} x2={w} y2={zeroY} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
      <path d={path} fill="none" stroke={positive ? "#2fbf71" : "#e5484d"} strokeWidth="2" />
      {points.map((p, i) => {
        const prev = i === 0 ? 0 : points[i - 1].r;
        const up = p.r >= prev;
        return <circle key={i} cx={x(p.time)} cy={y(p.r)} r={3.5} fill={up ? "#2fbf71" : "#e5484d"} stroke="rgba(0,0,0,0.4)" strokeWidth={1}><title>{`trade ${i + 1}: ${p.r >= 0 ? "+" : ""}${p.r}R cumulative @ ${new Date(p.time * 1000).toISOString().slice(0, 10)}`}</title></circle>;
      })}
      <text x={w - padR + 6} y={y(rs[rs.length - 1]) + 4} fontSize="11" fontWeight="bold" fill={positive ? "#2fbf71" : "#e5484d"}>
        {rs[rs.length - 1] >= 0 ? "+" : ""}{rs[rs.length - 1]}R
      </text>
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
function ConfluenceViewer({ trade, onLoad, loading }: { trade: TradeRecord; onLoad?: () => void; loading?: boolean }) {
  if (!trade.confluence) {
    return (
      <details className="mt-1">
        <summary className="cursor-pointer text-[11px] text-gold hover:underline">confluence trace (compact deep-window mode)</summary>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Trace text is omitted in compact deep-window responses to stay under the Worker resource ceiling.
          {onLoad ? <button type="button" onClick={onLoad} disabled={loading} className="ml-1 text-gold hover:underline">{loading ? "loading…" : "load this trade's detail"}</button> : null}
        </p>
      </details>
    );
  }
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

function AuditViewer({ trade, onLoad, loading }: { trade: TradeRecord; onLoad?: () => void; loading?: boolean }) {
  if (!trade.audit || trade.audit.length === 0) {
    return (
      <details className="mt-1">
        <summary className="cursor-pointer text-[11px] text-gold hover:underline">trade audit log (compact deep-window mode)</summary>
        <p className="mt-1 text-[11px] text-muted-foreground">
          The audit trail is omitted in compact deep-window responses to stay under the Worker resource ceiling.
          {onLoad ? <button type="button" onClick={onLoad} disabled={loading} className="ml-1 text-gold hover:underline">{loading ? "loading…" : "load this trade's audit"}</button> : null}
        </p>
      </details>
    );
  }
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
  // defaults = the user-verified BEST config (XAUUSD 15m CSV, 480k candles,
  // 25k-bar window: 71 trades · 74.6% WR · PF 5.63 · maxDD 0.46R · +7.31R net,
  // GREEN robustness) — verified against pessimistic/edge/all-session baselines
  // (33.5% WR) and randomized (36% WR) on identical data. Restore via the
  // "★ Best (verified)" preset chip below.
  const [minRR, setMinRR] = useState("2");
  const [beMode, setBeMode] = useState("tp1cost");
  const [ambiguity, setAmbiguity] = useState("optimistic");
  const [entryAnchor, setEntryAnchor] = useState("midpoint");
  const [entryTolerance, setEntryTolerance] = useState("0.05");
  const [costGate, setCostGate] = useState("0.35");
  const [obInvalidation, setObInvalidation] = useState("close-mid");
  const [obDisp, setObDisp] = useState("1.2");
  const [spread, setSpread] = useState("");
  const [slip, setSlip] = useState("");
  const [commBp, setCommBp] = useState("");
  const [tierB, setTierB] = useState("70");
  const [sessions, setSessions] = useState("london,ny-am,ny-pm");
  const [strictness, setStrictness] = useState("balanced");
  const [sensitivity, setSensitivity] = useState(false);
  const [compare, setCompare] = useState(false);
  const [compareDim, setCompareDim] = useState<CompareDimension>("strictness");
  const [result, setResult] = useState<(BacktestResult & {
    sensitivity?: SensitivityRow[];
    comparison?: StrictnessComparisonRow[];
    dimensionComparison?: DimensionComparison;
    runtimeMs?: number;
  }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [runStage, setRunStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  // compact deep-window mode: bars > 5000 ship without audit/confluence text
  // (Worker resource ceiling) — a trade's detail loads on demand
  const [compactMode, setCompactMode] = useState(false);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const lastParamsRef = useRef<string | null>(null);
  // data-source selector: live API (TwelveData) or an uploaded candle CSV.
  // CSV runs execute ENTIRELY in the browser: the parsed candles live in a
  // ref (the raw 25 MB text is never kept, never uploaded) and the engine is
  // dynamically imported at run time — the Worker never sees the file, so
  // its per-request CPU/memory ceiling (the old HTTP 503) cannot bite.
  const [dataSource, setDataSource] = useState<"api" | "csv">("api");
  const csvCandlesRef = useRef<Candle[]>([]);
  const [csvName, setCsvName] = useState("");
  const [csvPreview, setCsvPreview] = useState<CsvParseSummary | null>(null);
  const [csvCtx, setCsvCtx] = useState<CoarseContext | null>(null);

  async function onCsvFile(f: File | null) {
    setCsvPreview(null);
    setCsvCtx(null);
    csvCandlesRef.current = [];
    if (!f) return;
    setCsvName(f.name);
    try {
      const text = await f.text();
      const { candles, summary } = parseCsvCandles(text);
      csvCandlesRef.current = candles;
      setCsvPreview(summary);
      // coarse uploads can't run the engine — surface the higher-timeframe
      // read they CAN answer instead of a dead end
      setCsvCtx(
        summary.granularity === "daily" || summary.granularity === "weekly" || summary.granularity === "monthly"
          ? coarseContext(candles, summary.granularity)
          : null
      );
    } catch {
      setError("The file could not be read as text.");
    }
  }

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
        entryAnchor,
        entryTolerance: entryTolerance,
        costGate,
        obInvalidation,
        obDisp,
        tierB,
        sessions,
        strictness,
      });
      if (spread !== "") params.set("spread", spread);
      if (slip !== "") params.set("slip", slip);
      if (commBp !== "") params.set("commBp", commBp);
      if (sensitivity) params.set("sensitivity", "1.5,2,2.5,3");
      if (compare) {
        params.set("compare", "1");
        params.set("compareDim", compareDim);
      }
      // uploaded-CSV path: the FILE defines interval + window, and the run
      // executes LOCALLY — the pure engine core is imported on demand and the
      // parsed candles never leave this tab. No upload, no Worker CPU/memory
      // ceiling, and every trade ships with its full audit trail.
      if (dataSource === "csv") {
        const csvCandles = csvCandlesRef.current;
        const summary = csvPreview;
        if (csvCandles.length === 0 || !summary) throw new Error("Choose a CSV file first.");
        if (symbol !== "XAUUSD" && symbol !== "XAGUSD") throw new Error(`CSV runs are not configured for ${symbol}`);
        lastParamsRef.current = null; // no server round-trip to replay
        setCompactMode(false);
        setError(null);
        const paint = () => new Promise((r) => setTimeout(r, 30)); // let React paint between sync runs
        // dynamic import: the engine joins the client bundle only when a CSV
        // run actually happens
        const core = await import("@/lib/ict/run-core");
        const cfgOverrides = core.csvConfigFromUi(symbol, {
          minRR: Number(minRR),
          beMode,
          ambiguity,
          sessions: sessions ? sessions.split(",").map((s) => s.trim()).filter(Boolean) : [],
          entryAnchor,
          entryToleranceR: Number(entryTolerance),
          maxCostPctOfR: Number(costGate),
          obInvalidation,
          obDisplacementFactor: Number(obDisp),
          tierB: Number(tierB),
          spread: spread === "" ? null : Number(spread),
          slip: slip === "" ? null : Number(slip),
          commBp: commBp === "" ? null : Number(commBp),
        });
        const runOpts = {
          symbol: symbol as SymbolKey,
          candles: csvCandles,
          csvSummary: summary,
          config: cfgOverrides,
          strictness: strictness as Strictness,
        };
        const t0 = performance.now();
        setRunStage(`Running ${Math.min(csvCandles.length, 25000).toLocaleString()} candles in your browser — nothing is uploaded…`);
        await paint();
        const base = core.runCsvBacktest(runOpts);
        let sens: SensitivityRow[] | undefined;
        if (sensitivity) {
          sens = [];
          for (const rr of [1.5, 2, 2.5, 3]) {
            setRunStage(`minRR sensitivity ${rr}R…`);
            await paint();
            sens.push(core.sensitivityRowCsv(runOpts, rr, base));
          }
        }
        let comp: StrictnessComparisonRow[] | undefined;
        let dimComp: DimensionComparison | undefined;
        if (compare) {
          if (compareDim === "strictness") {
            comp = [];
            for (const s of ["conservative", "balanced", "aggressive"] as const) {
              setRunStage(`Strictness ${s}…`);
              await paint();
              comp.push(core.strictnessRowCsv(runOpts, s, base));
            }
          } else {
            const rows: DimensionRow[] = [];
            for (const step of core.dimensionPlan(compareDim)) {
              setRunStage(`${step.label}…`);
              await paint();
              rows.push(core.toDimensionRow(step.label, step.description, core.runCsvBacktest({ ...runOpts, config: { ...cfgOverrides, ...step.over } })));
            }
            dimComp = { dimension: compareDim, rows };
          }
        }
        setRunStage(null);
        setResult({ ...base, sensitivity: sens, comparison: comp, dimensionComparison: dimComp, runtimeMs: Math.round(performance.now() - t0) });
        return;
      }
      const compact = bars > 5000;
      if (compact) params.set("compact", "1");
      lastParamsRef.current = params.toString();
      setCompactMode(compact);
      // deep runs sit near the Worker resource ceiling — a failed attempt
      // (isolate cold start, transient 503/1102) usually succeeds on retry
      let json: Record<string, unknown> | null = null;
      let lastErr = "Backtest failed";
      for (let attempt = 0; attempt < (compact ? 3 : 1); attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 2500 * attempt));
        const res = await fetch(`/api/backtest?${params.toString()}`);
        try {
          json = (await res.json()) as Record<string, unknown>;
        } catch {
          lastErr = `Transient worker error (HTTP ${res.status}) — retrying…`;
          json = null;
          continue;
        }
        if (res.ok && json) break;
        lastErr = typeof json?.error === "string" ? json.error : `HTTP ${res.status}`;
        json = null;
      }
      if (!json) throw new Error(lastErr);
      setResult(json as unknown as typeof result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backtest failed");
    } finally {
      setLoading(false);
      setRunStage(null);
    }
  }

  async function loadTradeDetail(tradeId: string) {
    // Only live-API deep windows need this (their compact responses strip the
    // audit text to stay under the Worker ceiling). CSV runs execute locally
    // and always carry the full audit for every trade.
    if (dataSource === "csv" || !lastParamsRef.current) return;
    setDetailLoadingId(tradeId);
    try {
      const u = new URLSearchParams(lastParamsRef.current);
      u.set("tradeDetail", tradeId);
      const res = await fetch(`/api/backtest?${u.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.trade) throw new Error(json.error ?? "Trade detail unavailable");
      const full = json.trade as TradeRecord;
      setResult((prev) => prev
        ? { ...prev, trades: prev.trades.map((t) => t.id === tradeId ? { ...t, audit: full.audit ?? [], confluence: full.confluence ?? t.confluence, rationale: full.rationale ?? [] } : t) }
        : prev);
    } catch {
      setSavedMsg("Trade detail could not be loaded — try again shortly.");
    } finally {
      setDetailLoadingId(null);
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

  // Named knob sets — "Best" is the user-verified config on XAUUSD 15m
  // (480k-candle CSV, 25k window): 71 trades · 74.6% WR · PF 5.63 · +7.31R.
  // "Baseline" is the conservative read of the SAME data (pessimistic
  // ambiguity, edge fills, all sessions): 161 trades · 33.5% WR · +2.24R.
  const PRESETS: Record<string, { label: string; title: string; values: Record<string, string> }> = {
    best: {
      label: "★ Best (verified)",
      title: "User-verified on XAUUSD 15m CSV (25k bars): London+NY kill zones · BE+ costs · Optimistic ambiguity · Midpoint anchor · +0.05R tolerance — 71 trades, 74.6% WR, PF 5.63, maxDD 0.46R, +7.31R net (GREEN).",
      values: { sessions: "london,ny-am,ny-pm", beMode: "tp1cost", ambiguity: "optimistic", entryAnchor: "midpoint", entryTolerance: "0.05", costGate: "0.35", minRR: "2", tierB: "70", obDisp: "1.2", obInvalidation: "close-mid", strictness: "balanced" },
    },
    baseline: {
      label: "Conservative baseline",
      title: "Honest-touch read of the same data: all sessions · plain BE · Pessimistic ambiguity · edge fills — 161 trades, 33.5% WR, PF 1.14, maxDD 6.34R, +2.24R net (YELLOW). Use it as the lower bound.",
      values: { sessions: "", beMode: "tp1", ambiguity: "pessimistic", entryAnchor: "edge", entryTolerance: "0.05", costGate: "0.35", minRR: "2", tierB: "70", obDisp: "1.2", obInvalidation: "close-mid", strictness: "balanced" },
    },
  };
  function applyPreset(p: { values: Record<string, string> }) {
    const v = p.values;
    if (v.sessions !== undefined) setSessions(v.sessions);
    if (v.beMode !== undefined) setBeMode(v.beMode);
    if (v.ambiguity !== undefined) setAmbiguity(v.ambiguity);
    if (v.entryAnchor !== undefined) setEntryAnchor(v.entryAnchor);
    if (v.entryTolerance !== undefined) setEntryTolerance(v.entryTolerance);
    if (v.costGate !== undefined) setCostGate(v.costGate);
    if (v.minRR !== undefined) setMinRR(v.minRR);
    if (v.tierB !== undefined) setTierB(v.tierB);
    if (v.obDisp !== undefined) setObDisp(v.obDisp);
    if (v.obInvalidation !== undefined) setObInvalidation(v.obInvalidation);
    if (v.strictness !== undefined) setStrictness(v.strictness);
  }
  const onBest =
    sessions === "london,ny-am,ny-pm" && beMode === "tp1cost" && ambiguity === "optimistic" && entryAnchor === "midpoint";
  const onBaseline = sessions === "" && beMode === "tp1" && ambiguity === "pessimistic" && entryAnchor === "edge";

  return (
    <div className="space-y-6">
      {/* ---------------- config ---------------- */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Settings presets">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Presets</span>
          {Object.entries(PRESETS).map(([key, p]) => {
            const active = key === "best" ? onBest : onBaseline;
            return (
              <button
                key={key}
                type="button"
                onClick={() => applyPreset(p)}
                title={p.title}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  active
                    ? "border-[rgba(224,164,48,0.6)] bg-[rgba(224,164,48,0.12)] text-gold"
                    : "border-border bg-card text-muted-foreground hover:border-[rgba(224,164,48,0.4)] hover:text-gold"
                }`}
              >
                {p.label}{active ? " ✓" : ""}
              </button>
            );
          })}
          <span className="text-[11px] text-muted-foreground">
            Best = the verified winner on XAU 15m · Baseline = the conservative lower bound on the same data
          </span>
        </div>
        <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="bt-src" className="mb-1 block text-xs text-muted-foreground" title="Live API fetches TwelveData history; CSV runs the engine entirely on an uploaded candle file — no API credits, no fetch shortfall.">Data source</label>
          <select id="bt-src" value={dataSource} onChange={(e) => setDataSource(e.target.value as "api" | "csv")} className={selectCls}>
            <option value="api">TwelveData API</option>
            <option value="csv">Uploaded CSV</option>
          </select>
        </div>
        {dataSource === "csv" && (
          <div>
            <label htmlFor="bt-csv" className="mb-1 block text-xs text-muted-foreground">Candle file (.csv)</label>
            <input
              id="bt-csv"
              type="file"
              accept=".csv,.txt,text/csv"
              onChange={(e) => onCsvFile(e.target.files?.[0] ?? null)}
              className="h-9 text-xs file:mr-2 file:h-9 file:rounded-l-lg file:border-0 file:bg-muted file:px-3 file:text-xs file:text-foreground"
            />
          </div>
        )}
        <div>
          <label htmlFor="bt-interval" className="mb-1 block text-xs text-muted-foreground">Timeframe</label>
          <select id="bt-interval" value={btInterval} onChange={(e) => setBtInterval(e.target.value)} disabled={dataSource === "csv"} className={`${selectCls} disabled:opacity-50`}>
            <option value="5min">5m</option>
            <option value="15min">15m</option>
            <option value="1h">1H</option>
            <option value="4h">4H</option>
          </select>
        </div>
        <div>
          <label htmlFor="bt-bars" className="mb-1 block text-xs text-muted-foreground">History (bars)</label>
          <select id="bt-bars" value={bars} onChange={(e) => setBars(Number(e.target.value))} disabled={dataSource === "csv"} className={`${selectCls} disabled:opacity-50`}>
            {[400, 1000, 1500, 3000, 5000, 10000, 15000, 25000].map((b) => (
              <option key={b} value={b}>{b}{b > 5000 ? " (deep)" : ""}</option>
            ))}
          </select>
          {dataSource === "api" && bars > 5000 && <p className="mt-1 text-[10px] text-muted-foreground">Deep windows are assembled from paginated API chunks (extra credits, slower first run, then cached 15 min).</p>}
          {dataSource === "csv" && <p className="mt-1 text-[10px] text-muted-foreground">Interval + window are detected from the file. CSV runs execute in YOUR browser — nothing is uploaded (engine window: most recent 25,000 candles).</p>}
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
          <label htmlFor="bt-be" className="mb-1 block text-xs text-muted-foreground" title="After TP1 the stop moves to entry (plain BE) or to entry + the round-trip cost buffer on the remaining shares (BE+) — BE+ makes the worst case after TP1 a small net win. Effective from the next bar; the initial stop is preserved in every record.">Breakeven mode</label>
          <select id="bt-be" value={beMode} onChange={(e) => setBeMode(e.target.value)} className={selectCls}>
            <option value="tp1cost">After TP1 → entry + costs (BE+)</option>
            <option value="tp1">After TP1 → entry</option>
            <option value="risk1">After +1R</option>
            <option value="structural">Structural</option>
            <option value="off">No BE</option>
          </select>
        </div>
        <div>
          <label htmlFor="bt-amb" className="mb-1 block text-xs text-muted-foreground">SL/TP ambiguity</label>
          <select id="bt-amb" value={ambiguity} onChange={(e) => setAmbiguity(e.target.value)} className={selectCls}>
            <option value="optimistic">Optimistic (verified best)</option>
            <option value="pessimistic">Pessimistic</option>
            <option value="randomized">Randomized</option>
            <option value="ltf">5m resolution (15m only)</option>
          </select>
          {ambiguity === "optimistic" && (
            <p className="mt-1 text-[10px] leading-snug text-amber-300/90" title="When one candle touches both the stop and the target, Optimistic credits the target. Real fills are usually in between — run compare → SL/TP ambiguity for the pessimistic/randomized spread on the same data.">
              Upper-bound read: same-candle SL+TP conflicts credit the target. Check compare → SL/TP ambiguity for the honest spread.
            </p>
          )}
        </div>
        <div>
          <label htmlFor="bt-anchor" className="mb-1 block text-xs text-muted-foreground" title="Proximal edge = ICT default. Midpoint = deeper limit, more fills, worse location.">Entry anchor</label>
          <select id="bt-anchor" value={entryAnchor} onChange={(e) => setEntryAnchor(e.target.value)} className={selectCls}>
            <option value="edge">Zone edge</option>
            <option value="midpoint">Zone midpoint</option>
          </select>
        </div>
        <div>
          <label htmlFor="bt-tol" className="mb-1 block text-xs text-muted-foreground" title="Marketable last-look: fill when price comes within this many R of the limit without touching it. Default 0.05R — earlier fills; every tolerance fill is counted (Tolerance fills card) and flagged on the trade. Set 0 for strict touch. Compare → Entry placement quantifies the assumption.">Entry tolerance</label>
          <select id="bt-tol" value={entryTolerance} onChange={(e) => setEntryTolerance(e.target.value)} className={selectCls}>
            <option value="0">Strict touch</option>
            <option value="0.05">+0.05R</option>
            <option value="0.1">+0.10R</option>
          </select>
        </div>
        <div>
          <label htmlFor="bt-cost" className="mb-1 block text-xs text-muted-foreground" title="Decline setups whose estimated round-trip cost exceeds this share of 1R. Costs were 44% of gross edge in deep runs.">Cost gate</label>
          <select id="bt-cost" value={costGate} onChange={(e) => setCostGate(e.target.value)} className={selectCls}>
            <option value="0">Off</option>
            <option value="0.25">25% of 1R</option>
            <option value="0.35">35% of 1R</option>
            <option value="0.5">50% of 1R</option>
          </select>
        </div>
        <div>
          <label htmlFor="bt-spread" className="mb-1 block text-xs text-muted-foreground" title="Override the assumed bid/ask spread for this run, in price units. Empty = engine default (XAUUSD $0.30, XAGUSD $0.03). The active model is echoed in the notes; costs feed the cost gate and every trade's net R.">Spread $</label>
          <input id="bt-spread" type="number" min="0" step="0.01" inputMode="decimal" placeholder="default" value={spread} onChange={(e) => setSpread(e.target.value)} className={`${selectCls} w-24`} />
        </div>
        <div>
          <label htmlFor="bt-slip" className="mb-1 block text-xs text-muted-foreground" title="Override assumed slippage per fill side, in price units. Empty = engine default (XAUUSD $0.05, XAGUSD $0.01).">Slip $/side</label>
          <input id="bt-slip" type="number" min="0" step="0.01" inputMode="decimal" placeholder="default" value={slip} onChange={(e) => setSlip(e.target.value)} className={`${selectCls} w-24`} />
        </div>
        <div>
          <label htmlFor="bt-comm" className="mb-1 block text-xs text-muted-foreground" title="Override assumed commission per fill side, in basis points of price. Empty = engine default (0.1 bp/side).">Comm. bp/side</label>
          <input id="bt-comm" type="number" min="0" step="0.1" inputMode="decimal" placeholder="default" value={commBp} onChange={(e) => setCommBp(e.target.value)} className={`${selectCls} w-24`} />
        </div>
        <div>
          <label htmlFor="bt-obi" className="mb-1 block text-xs text-muted-foreground" title="When a tapped order block stops being tradable. Default is the ICT close-through-midpoint rule — the compare dimension obInvalidation runs all four rules side by side.">OB invalidation</label>
          <select id="bt-obi" value={obInvalidation} onChange={(e) => setObInvalidation(e.target.value)} className={selectCls}>
            <option value="close-mid">Close thru midpoint</option>
            <option value="wick-mid">Wick thru midpoint</option>
            <option value="close-distal">Close thru zone</option>
            <option value="wick-distal">Wick thru zone</option>
          </select>
        </div>
        <div>
          <label htmlFor="bt-obd" className="mb-1 block text-xs text-muted-foreground" title="OB creation threshold: the displacement candle after the block must have a body ≥ factor × per-bar ATR. Lower = more blocks (Model C/D wake up, average quality drops). The compare dimension obDisplacement scans 0.8/1.0/1.2/1.5 on the same data.">OB displacement</label>
          <select id="bt-obd" value={obDisp} onChange={(e) => setObDisp(e.target.value)} className={selectCls}>
            <option value="0.8">0.8× ATR</option>
            <option value="1.0">1.0× ATR</option>
            <option value="1.2">1.2× ATR (default)</option>
            <option value="1.5">1.5× ATR</option>
          </select>
        </div>
        <div>
          <label htmlFor="bt-tierb" className="mb-1 block text-xs text-muted-foreground" title="Minimum setup score allowed to trade (tier B floor). 70 = engine default. Raising it trades less — check the score-bucket table for what each floor would have excluded.">Min score (B floor)</label>
          <select id="bt-tierb" value={tierB} onChange={(e) => setTierB(e.target.value)} className={selectCls}>
            <option value="70">70 (default)</option>
            <option value="75">75</option>
            <option value="80">80</option>
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={sensitivity} onChange={(e) => setSensitivity(e.target.checked)} className="accent-[var(--gold)]" />
          minRR sensitivity
        </label>
        <label className="flex items-center gap-2 pb-2 text-xs text-muted-foreground" title="Runs a one-dimension comparison on the same data — strictness presets, expiry window, session filter, or entry placement">
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="accent-[var(--gold)]" />
          compare
        </label>
        {compare && (
          <div className="pb-2">
            <label htmlFor="bt-cdim" className="mb-1 block text-xs text-muted-foreground">Compare dimension</label>
            <select id="bt-cdim" value={compareDim} onChange={(e) => setCompareDim(e.target.value as CompareDimension)} className={selectCls}>
              <option value="strictness">Strictness presets</option>
              <option value="expiry">Expiry window (6/12/24)</option>
              <option value="sessions">Sessions (all vs kill zones)</option>
              <option value="entry">Entry placement (edge/tolerance/midpoint)</option>
              <option value="be">Breakeven rule (BE+ vs plain vs risk1 vs structural)</option>
              <option value="obInvalidation">OB invalidation rule (4 modes)</option>
              <option value="obDisplacement">OB displacement factor (0.8–1.5)</option>
              <option value="ambiguity">SL/TP ambiguity (pessimistic vs optimistic vs randomized)</option>
            </select>
          </div>
        )}
        <Button
          onClick={run}
          disabled={loading || (dataSource === "csv" && (!csvPreview || csvPreview.parsed < 150))}
          className="h-9 bg-primary text-primary-foreground hover:bg-gold-soft"
        >
          {loading ? "Running…" : `Run backtest · ${symbol}${dataSource === "csv" ? " (CSV)" : ""}`}
        </Button>
        {savedMsg && <span className="text-xs text-muted-foreground">{savedMsg}</span>}
        {result && user && (
          <Button variant="outline" className="h-9 border-border" onClick={saveRun}>Save run</Button>
        )}
        </div>{/* /config grid */}
      </div>{/* /config section */}
      {loading && runStage && (
        <p className="rounded-lg border border-[rgba(224,164,48,0.35)] bg-[rgba(224,164,48,0.06)] px-4 py-2 text-xs text-gold" role="status">{runStage}</p>
      )}
      {dataSource === "csv" && csvPreview && (
        <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm" role="status">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{csvName || "CSV"}</span>
            <span className="rounded bg-background/40 px-2 py-0.5 text-xs">{csvPreview.format}</span>
            <span className="text-xs text-muted-foreground">
              {csvPreview.parsed} candles
              {csvPreview.granularity === "weekly" || csvPreview.granularity === "monthly"
                ? ` · ${granularityLabel(csvPreview.granularity).toUpperCase()} detected`
                : csvPreview.detectedInterval
                  ? ` · ${intervalLabelOfKey(csvPreview.detectedInterval)} detected`
                  : ""}
              {" · "}{csvPreview.from ? new Date(csvPreview.from * 1000).toISOString().slice(0, 10) : "—"} → {csvPreview.to ? new Date(csvPreview.to * 1000).toISOString().slice(0, 10) : "—"}
              {csvPreview.skipped > 0 ? ` · ${csvPreview.skipped} rows skipped` : ""}
              {csvPreview.duplicatesRemoved > 0 ? ` · ${csvPreview.duplicatesRemoved} dupes removed` : ""}
              {csvPreview.reSorted ? " · re-sorted to chronological" : ""}
            </span>
          </div>
          {csvPreview.parsed >= 150 && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Ready — Run executes locally in your browser. Your file never leaves this device; large files take a few seconds, and every trade ships with its full audit trail.
            </p>
          )}
          {csvPreview.parsed < 150 && (
            <p className="mt-1 text-xs text-red-300">
              {csvPreview.granularity === "weekly" || csvPreview.granularity === "monthly"
                ? `Below the engine's 150-candle minimum — the engine cannot run on ${granularityLabel(csvPreview.granularity)} bars. ICT backtesting needs INTRADAY history: 5m/15m/1H candles (several months' worth works best). Investing.com's Historical Data page offers a Time-frame selector for intraday downloads over a limited range; Dukascopy's free historical data export covers years of 5m/15m XAUUSD. This file stays useful as macro context below.`
                : csvPreview.detectedSeconds !== null && csvPreview.detectedSeconds >= 86400
                  ? "Below the engine's 150-candle minimum — upload a longer history before running. This file is DAILY data: ICT intraday models (kill zones, session liquidity, FVG precision) cannot be observed on daily bars — download 5m/15m/1H history instead."
                  : "Below the engine's 150-candle minimum — upload a longer history before running. For meaningful ICT results, several months of 5m/15m/1H candles are the sweet spot."}
            </p>
          )}
          {csvCtx && (
            <div className="mt-2 rounded border border-border/60 bg-background/20 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Macro context from this file · {granularityLabel(csvCtx.granularity)} · informational only
              </p>
              <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs md:grid-cols-3">
                <span>Last close: <b>{csvCtx.lastClose.toFixed(2)}</b></span>
                <span>
                  vs previous period:{" "}
                  <b>
                    {csvCtx.vsPrev === "above-both"
                      ? `above ${csvCtx.prevHigh.toFixed(2)} (buy-side liquidity taken)`
                      : csvCtx.vsPrev === "below-both"
                        ? `below ${csvCtx.prevLow.toFixed(2)} (sell-side liquidity taken)`
                        : `inside ${csvCtx.prevLow.toFixed(2)}–${csvCtx.prevHigh.toFixed(2)}`}
                  </b>
                </span>
                <span>
                  {LEG_NAME[csvCtx.granularity]} range {csvCtx.legLow.toFixed(2)}–{csvCtx.legHigh.toFixed(2)}:{" "}
                  <b>
                    {csvCtx.legPct !== null ? `${csvCtx.legPct}% — ${csvCtx.legLabel}` : "flat"}
                  </b>
                </span>
                <span>
                  Swing structure:{" "}
                  <b>{csvCtx.structure === null ? "not enough pivots" : csvCtx.structure}</b>{" "}
                  <span className="text-muted-foreground">({csvCtx.swingsFound} pivots)</span>
                </span>
                <span>
                  Close streak:{" "}
                  <b>{csvCtx.streak.dir === null ? "flat" : `${csvCtx.streak.count} × ${csvCtx.streak.dir}`}</b>
                </span>
              </div>
            </div>
          )}
          {csvPreview.warnings.map((w, i) => (
            <p key={i} className="mt-1 text-xs text-amber-300">{w}</p>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</p>
      )}

      {m && result && flags && (
        <div className="space-y-6">
          {/* ---------------- robustness + sample verdict (one honest verdict, not two banners) ---------------- */}
          <div className={`rounded-lg border px-4 py-3 text-sm ${flagCls}`} role="status">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold">Robustness: {flags.level}</span>
              <span className="rounded bg-background/40 px-2 py-0.5 text-xs font-semibold">Sample size: {result.sampleInfo.label} · {m.trades} trades</span>
              {result.runtimeMs !== undefined && (
                <span className="rounded bg-background/40 px-2 py-0.5 text-xs font-semibold">executed in-browser · {(result.runtimeMs / 1000).toFixed(1)}s</span>
              )}
            </div>
            <p className="mt-1 text-xs opacity-90">{result.sampleInfo.note}</p>
            <ul className="mt-1 space-y-0.5 text-xs opacity-90">
              {flags.reasons.map((r, i) => <li key={i}>• {r}</li>)}
            </ul>
          </div>

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

          {/* ---------------- cost share warning ---------------- */}
          {m.grossR > 0 && m.costsR / m.grossR > 0.3 && (
            <p className="rounded-lg border border-amber-900/50 bg-amber-950/20 px-4 py-2 text-xs text-amber-300">
              Transaction costs consume {Math.round((m.costsR / m.grossR) * 100)}% of gross edge ({m.costsR}R of {m.grossR}R) — a fixed round-trip cost (~$0.42 on XAUUSD) dominates when structural stops are tight. Check the per-trade cost column below.
            </p>
          )}

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Equity curve (net R)</h3>
              <span className="text-xs text-muted-foreground">
                {fmtDate(result.from)} → {fmtDate(result.to)} · {result.bars} bars · {result.source} · {result.strictness} preset
              </span>
            </div>
            <EquityCurve points={result.equityCurve} from={result.from} to={result.to} />
          </div>

          {/* ---------------- STRATEGY DIAGNOSTICS: signal funnel (spec §1) ---------------- */}
          <Section
            title="Strategy diagnostics — signal funnel"
            subtitle="How many opportunities survive each stage (count + % of total candles). bars = per-candle facts · candidates = bar × model opportunities. Shows exactly where the strategy is too loose or too strict."
          >
            <div className="space-y-2">
              {result.funnel.map((f) => {
                const smtBlocked = f.stage === "SMT confirmation" && result.smt?.source !== "LIVE";
                return (
                  <div key={f.stage} className={smtBlocked ? "opacity-50" : undefined}>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">
                        {f.stage} <span className="ml-1 rounded bg-muted/60 px-1 text-[10px] uppercase">{f.unit}</span>
                        {smtBlocked && <span className="ml-2 text-[10px] italic">N/A — companion feed {result.smt?.source ?? "unavailable"}; divergence confluence cannot run</span>}
                      </span>
                      <span className="font-mono">{f.count} <span className="text-muted-foreground">{f.pct}%</span></span>
                    </div>
                    <Bar value={f.count} max={maxFunnel} />
                  </div>
                );
              })}
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
            subtitle="Which ICT model actually produces trades — and whether it has an edge. Zone-stage rejections only: the shared prefix (bias → sweep → MSS → displacement) is identical across models by construction, so it is listed once in the rejection table above."
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
                    <th className="px-2 py-1.5 font-medium">Zone-stage rejections</th>
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
              subtitle="Counted BEFORE the minimum-RR gate applies — shows whether 2R is the bottleneck. The gate asks whether AT LEAST ONE structural target WITHIN the horizon is minRR away (TP3 = farthest in-horizon level)."
            >
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">Candidates reaching the target stage</span><span className="font-mono">{result.rrDiagnostics.evaluated}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">With a structural target ladder</span><span className="font-mono">{result.rrDiagnostics.beforeFilter}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">RR ≥ 1.5R</span><span className="font-mono">{result.rrDiagnostics.ge1_5}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">RR ≥ 2.0R</span><span className="font-mono">{result.rrDiagnostics.ge2}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">RR ≥ 2.5R</span><span className="font-mono">{result.rrDiagnostics.ge2_5}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">RR ≥ 3.0R</span><span className="font-mono">{result.rrDiagnostics.ge3}</span></div>
                <div className="flex justify-between" title="RR to the NEAREST structural level — the target that actually pays TP1">
                  <span className="text-muted-foreground">Median RR to TP1 (nearest level)</span><span className="font-mono">{num(result.rrDiagnostics.medianTp1Rr, "R")}</span>
                </div>
                <div className="flex justify-between" title="RR to the farthest structural level within the horizon cap — the runner target">
                  <span className="text-muted-foreground">Median RR to TP3 (in-horizon far)</span><span className="font-mono">{num(result.rrDiagnostics.medianTp3Rr, "R")}</span>
                </div>
                <div className="flex justify-between" title="Levels excluded from the execution ladder by the target-horizon cap — landmarks (PDH/PWH), not tradable targets">
                  <span className="text-muted-foreground">Far levels excluded by horizon cap</span><span className="font-mono">{result.rrDiagnostics.targetsCapped}</span>
                </div>
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

          {/* ---------------- one-dimension comparison (spec §16, §17 extended) ---------------- */}
          {result.dimensionComparison && result.dimensionComparison.rows.length > 0 && (
            <Section
              title={`Comparison — ${result.dimensionComparison.dimension} dimension`}
              subtitle="Same data, one execution dimension varied, shown objectively. Do NOT assume any variant is better — compare trades, expectancy, PF, drawdown, and remember sample sizes.">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-muted-foreground">
                    <tr><th className="px-2 py-1.5 font-medium">Variant</th><th className="px-2 py-1.5 text-right font-medium">Trades</th><th className="px-2 py-1.5 text-right font-medium">Win%</th><th className="px-2 py-1.5 text-right font-medium">Expectancy</th><th className="px-2 py-1.5 text-right font-medium">PF</th><th className="px-2 py-1.5 text-right font-medium">Max DD</th><th className="px-2 py-1.5 text-right font-medium">Gross R</th><th className="px-2 py-1.5 text-right font-medium">Costs R</th><th className="px-2 py-1.5 text-right font-medium">Net R</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {result.dimensionComparison.rows.map((c) => (
                      <tr key={c.label} className="text-muted-foreground">
                        <td className="px-2 py-1.5 font-medium text-foreground/90" title={c.description}>{c.label}</td>
                        <td className="px-2 py-1.5 text-right">{c.trades}</td>
                        <td className="px-2 py-1.5 text-right">{num(c.winRate, "%")}</td>
                        <td className={`px-2 py-1.5 text-right ${(c.expectancyR ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>{num(c.expectancyR, "R")}</td>
                        <td className="px-2 py-1.5 text-right">{num(c.profitFactor)}</td>
                        <td className="px-2 py-1.5 text-right">{c.maxDrawdownR}R</td>
                        <td className="px-2 py-1.5 text-right">{c.grossR ? `${c.grossR}R` : "—"}</td>
                        <td className="px-2 py-1.5 text-right">{c.costsR ? `${c.costsR}R` : "—"}</td>
                        <td className="px-2 py-1.5 text-right font-semibold">{c.netR}R</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* ---------------- legacy strictness table (kept when compareDim = strictness) ---------------- */}
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

          {/* ---------------- order-block creation pipeline (Model C/D diagnosis) ---------------- */}
          <Section
            title={`Order-Block pipeline — where Model C/D candidates die (rule: ${result.obInvalidation} · creation ≥ ${result.obPipeline.displacementFactor}× ATR)`}
            subtitle="Series-wide creation → candidate-window visibility → skip reasons. Diagnoses WHY OB reversals are rare before anyone touches a threshold. The compare dimensions obInvalidation / obDisplacement scan both sides of the definition."
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              <div className={metricCard} title="OB zones the detector created over the whole series (displacement-qualified opposing candles)"><p className="text-[10px] text-muted-foreground">OBs created</p><p className="font-bold">{result.obPipeline.zonesCreated}</p></div>
              <div className={metricCard} title={`Of those, later invalidated under the active rule (${result.obInvalidation}) — compare dimension obInvalidation runs all four rules on the same data`}><p className="text-[10px] text-muted-foreground">Invalidated</p><p className="font-bold">{result.obPipeline.zonesInvalidated}</p></div>
              <div className={metricCard} title="OBs that fell inside some candidate's sweep→MSS zone window"><p className="text-[10px] text-muted-foreground">In candidate windows</p><p className="font-bold">{result.obPipeline.windowSeen}</p></div>
              <div className={metricCard} title="Skipped: mitigated / consumed before the candidate could use them"><p className="text-[10px] text-muted-foreground">Skip: mitigated</p><p className="font-bold">{result.obPipeline.skippedMitigated}</p></div>
              <div className={metricCard} title="Skipped: the limit would cross current price (zone already consumed)"><p className="text-[10px] text-muted-foreground">Skip: consumed</p><p className="font-bold">{result.obPipeline.skippedPosition}</p></div>
              <div className={metricCard} title="Skipped: zone insane relative to the swept extreme"><p className="text-[10px] text-muted-foreground">Skip: vs sweep</p><p className="font-bold">{result.obPipeline.skippedSweepExtreme}</p></div>
              <div className={metricCard} title="Candidates that still had a usable OB after all skips"><p className="text-[10px] text-muted-foreground">Candidates w/ OB</p><p className="font-bold">{result.obPipeline.candidatesWithOb}</p></div>
              <div className={metricCard} title="Model C setups that passed every gate"><p className="text-[10px] text-muted-foreground">Model C valid</p><p className="font-bold">{result.obPipeline.modelCValidSetups}</p></div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">{result.obPipeline.note}</p>
          </Section>

          {/* ---------------- SMT companion transparency ---------------- */}
          <Section
            title="SMT companion — what divergence checks actually ran against"
            subtitle="SMT is an OPTIONAL confluence: when no live companion exists its score bonus is silently absent, so the run states which series was used, how many divergences fired and how much of the window they covered. A proxy with weaker correlation (r≈0.55) diverges more often than the canonical XAU/XAG pair — treat its bonus as weak confluence, and judge it via the score-bucket table."
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className={metricCard}><p className="text-[10px] text-muted-foreground">Companion</p><p className="text-sm font-bold">{result.smt?.companion ?? "None"}</p></div>
              <div className={metricCard} title="LIVE = real market data; anything else means the divergence confluence is not evidence-based on this run"><p className="text-[10px] text-muted-foreground">Data source</p><p className={`text-sm font-bold ${result.smt?.source === "LIVE" ? "text-emerald-400" : "text-amber-400"}`}>{result.smt?.source ?? "unavailable"}</p></div>
              <div className={metricCard} title="Divergence events that became knowable inside the window (both swings confirmed — no look-ahead)"><p className="text-[10px] text-muted-foreground">Divergences</p><p className="font-bold">{result.smt?.events ?? 0}</p></div>
              <div className={metricCard} title="Share of traded bars whose timestamp has companion data — low coverage means SMT only judged the tail of the window"><p className="text-[10px] text-muted-foreground">Coverage</p><p className="font-bold">{result.smt?.coveragePct === null || result.smt?.coveragePct === undefined ? "—" : `${result.smt.coveragePct}%`}</p></div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">{result.smt?.note}</p>
            {result.smtSplit?.live && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-medium text-foreground/80">Does the +5 SMT bonus separate outcomes? — closed trades split by entry-time alignment</p>
                <table className="w-full max-w-md text-left text-xs">
                  <thead className="text-muted-foreground">
                    <tr><th className="px-2 py-1 font-medium">Cohort</th><th className="px-2 py-1 text-right font-medium">Trades</th><th className="px-2 py-1 text-right font-medium">Win%</th><th className="px-2 py-1 text-right font-medium">Expectancy</th><th className="px-2 py-1 text-right font-medium">Net R</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    <tr>
                      <td className="px-2 py-1 font-medium">SMT-aligned</td>
                      <td className="px-2 py-1 text-right">{result.smtSplit.aligned.trades}</td>
                      <td className="px-2 py-1 text-right">{num(result.smtSplit.aligned.winRate, "%")}</td>
                      <td className={`px-2 py-1 text-right ${(result.smtSplit.aligned.expectancyR ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>{num(result.smtSplit.aligned.expectancyR, "R")}</td>
                      <td className="px-2 py-1 text-right font-semibold">{result.smtSplit.aligned.netR}R</td>
                    </tr>
                    <tr>
                      <td className="px-2 py-1 font-medium">Not aligned</td>
                      <td className="px-2 py-1 text-right">{result.smtSplit.notAligned.trades}</td>
                      <td className="px-2 py-1 text-right">{num(result.smtSplit.notAligned.winRate, "%")}</td>
                      <td className={`px-2 py-1 text-right ${(result.smtSplit.notAligned.expectancyR ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>{num(result.smtSplit.notAligned.expectancyR, "R")}</td>
                      <td className="px-2 py-1 text-right font-semibold">{result.smtSplit.notAligned.netR}R</td>
                    </tr>
                  </tbody>
                </table>
                <p className="mt-1 text-[11px] text-muted-foreground">{result.smtSplit.note}</p>
              </div>
            )}
          </Section>

          {/* ---------------- pending-order flow: why orders don't fill ---------------- */}
          <Section
            title="Pending-order flow — why orders don't fill"
            subtitle={result.orderFlow.note || "Telemetry between order placement and fill/expiry. The observation window (48 bars) never changes trading semantics — it only measures what would have happened."}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <div className={metricCard}><p className="text-[10px] text-muted-foreground">Orders placed</p><p className="font-bold">{result.orderFlow.placed}</p></div>
              <div className={metricCard}><p className="text-[10px] text-muted-foreground">Filled</p><p className="font-bold text-emerald-400">{result.orderFlow.filled}</p></div>
              <div className={metricCard}><p className="text-[10px] text-muted-foreground">Expired (window)</p><p className="font-bold text-amber-400">{result.orderFlow.expired}</p></div>
              <div className={metricCard}><p className="text-[10px] text-muted-foreground">Zone-invalidated</p><p className="font-bold text-red-400">{result.orderFlow.invalidated}</p></div>
              <div className={metricCard} title="Entry was touched AFTER the configured expiry window — evidence the expiry, not the level, was the constraint"><p className="text-[10px] text-muted-foreground">Touched after expiry</p><p className="font-bold">{result.orderFlow.lateFills}</p></div>
              <div className={metricCard} title="Median closest approach of expired orders to the entry limit, in R"><p className="text-[10px] text-muted-foreground">Median closest approach</p><p className="font-bold">{result.orderFlow.medianClosestApproachR === null ? "—" : `${result.orderFlow.medianClosestApproachR}R`}</p></div>
              <div className={metricCard} title="Fills that happened only because the entry-tolerance margin was applied — price never actually touched the limit"><p className="text-[10px] text-muted-foreground">Tolerance fills</p><p className="font-bold">{result.orderFlow.toleranceFills}</p></div>
            </div>
            <div className="mt-3 space-y-1 text-xs text-muted-foreground">
              <p>Fill latency (filled orders): ≤3 bars {result.orderFlow.fillLatency.le3} · ≤6 {result.orderFlow.fillLatency.le6} · ≤12 {result.orderFlow.fillLatency.le12} · ≤24 {result.orderFlow.fillLatency.le24} · ≤48 {result.orderFlow.fillLatency.le48}</p>
              <p>Cumulative fill rate: {result.orderFlow.fillRateAt.bars6 ?? 0}% within 6 bars · {result.orderFlow.fillRateAt.bars12 ?? 0}% within 12 · {result.orderFlow.fillRateAt.bars24 ?? 0}% within 24 · {result.orderFlow.fillRateAt.bars48 ?? 0}% within 48</p>
              <p className="text-[11px]">Same-candle SL+TP collisions: <span className="font-mono text-foreground/80">{result.ambiguityCollisions}</span>{result.ambiguityCollisions === 0 ? " — the ambiguity model had no effect on this run (the setting is a no-op until a collision occurs)." : ""}</p>
            </div>
          </Section>

          {/* ---------------- rejected setup inspector (spec §19) ---------------- */}
          <Section
            title="Rejected setup inspector"
            subtitle="Sampled rejected opportunities with the chart state the engine saw at the decision bar — click a date to inspect. Visual verification of the strategy."
          >
            {compactMode ? (
              <p className="text-[11px] text-muted-foreground">Inspector samples are omitted in compact deep-window mode (Worker resource ceiling). Run a ≤5000-bar window for the full inspector.</p>
            ) : (
              <RejectedInspector samples={result.rejectedSamples} />
            )}
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
                <div className={metricCard} title="Median bars from fill to each target hit — target realism, not just hit rate"><p className="text-xs text-muted-foreground">Med bars → TP1 / TP2 / TP3</p><p className="font-bold text-sm">{result.management.medianBarsToTp1 ?? "—"} / {result.management.medianBarsToTp2 ?? "—"} / {result.management.medianBarsToTp3 ?? "—"}</p></div>
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
          <Section title="Data quality audit" subtitle="Historical feed sanity check (spec §18) — duplicate/out-of-order candles, gaps, invalid OHLC, plus dead-market weekend candle removal AND fetch accounting (requested vs received).">
            <p className={`text-xs ${result.dataQuality.ok ? "text-emerald-400" : "text-amber-400"}`}>{result.dataQuality.note}</p>
            {(result.dataQuality.fetchShortfallPct ?? 0) > 10 && (
              <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                Fetch shortfall {result.dataQuality.fetchShortfallPct}% — the upstream delivered less history than requested ({result.dataQuality.rawFetched} of {result.dataQuality.requestedBars} raw bars). Sample-size claims must use RECEIVED bars, not the selector value.
              </p>
            )}
            <div className="mt-2 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3 lg:grid-cols-8">
              <div className={metricCard}><p className="text-[10px] text-muted-foreground">Bars traded</p><p className="font-bold">{result.dataQuality.bars}</p></div>
              <div className={metricCard} title="Raw candles the upstream actually delivered (before weekend filtering) vs requested"><p className="text-[10px] text-muted-foreground">Raw fetched / req</p><p className="font-bold">{result.dataQuality.rawFetched ?? "—"}{result.dataQuality.requestedBars ? <span className="text-[10px] font-normal text-muted-foreground"> / {result.dataQuality.requestedBars}</span> : null}</p></div>
              <div className={metricCard} title="Weekend candles removed before the run (Sat + Sun before 22:00 UTC) — the raw feed quotes through closed hours"><p className="text-[10px] text-muted-foreground">Weekend dropped</p><p className="font-bold">{result.dataQuality.weekendCandles}</p></div>
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
                      <th className="px-2 py-1.5 text-right font-medium" title="Spread + slippage + commission attributed to this trade (gross − net)">Cost R</th>
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
                        <td className="px-2 py-1.5 text-right text-amber-400/90">{t.costR}R</td>
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
                      <span className={t.side === "LONG" ? "font-semibold text-emerald-400" : "font-semibold text-red-400"}>{t.side}</span> @ {fmtDate(t.entryTime)}{t.rationale[0] ? ` — ${t.rationale[0]}` : ""}
                    </p>
                    <ConfluenceViewer trade={t} onLoad={compactMode ? () => loadTradeDetail(t.id) : undefined} loading={detailLoadingId === t.id} />
                    <AuditViewer trade={t} onLoad={compactMode ? () => loadTradeDetail(t.id) : undefined} loading={detailLoadingId === t.id} />
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
