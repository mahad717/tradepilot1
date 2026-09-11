"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { Candle, DataSource } from "@/lib/market/types";
import type { SmtResult } from "@/lib/ict/types";
import { findSwings } from "@/lib/ict/swings";
import { fmtPrice, fmtTime } from "./format";

/** Dual sparkline with swing pivots marked — the classic SMT visual. */
function DualSparkline({ gold, silver }: { gold: Candle[]; silver: Candle[] }) {
  const w = 640;
  const h = 120;
  const n = Math.min(gold.length, silver.length, 150);
  const g = gold.slice(-n);
  const s = silver.slice(-n);
  if (n < 10) return null;

  const line = (data: Candle[]) => {
    const min = Math.min(...data.map((c) => c.low));
    const max = Math.max(...data.map((c) => c.high));
    return data
      .map((c, i) => `${i === 0 ? "M" : "L"}${((i / (n - 1)) * w).toFixed(1)},${(h - ((c.close - min) / (max - min)) * (h - 12) - 6).toFixed(1)}`)
      .join(" ");
  };

  const mark = (data: Candle[], type: "HIGH" | "LOW") =>
    findSwings(data, 2)
      .filter((sw) => sw.type === type)
      .map((sw) => {
        const idx = data.indexOf(data.find((c) => c.time === sw.time)!);
        const min = Math.min(...data.map((c) => c.low));
        const max = Math.max(...data.map((c) => c.high));
        const x = (idx / (n - 1)) * w;
        const y = type === "HIGH" ? h - ((sw.price - min) / (max - min)) * (h - 12) - 6 : h - ((sw.price - min) / (max - min)) * (h - 12) - 6;
        return { x, y, price: sw.price, time: sw.time };
      });

  const goldHighs = mark(g, "HIGH");
  const goldLows = mark(g, "LOW");
  const silverHighs = mark(s, "HIGH");
  const silverLows = mark(s, "LOW");

  const dot = (x: number, y: number, color: string, key: string) => (
    <circle key={key} cx={x} cy={y} r="2.5" fill={color} />
  );

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1 text-xs font-semibold text-muted-foreground">XAUUSD (gold)</p>
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full rounded-lg border border-border bg-card" role="img" aria-label="Gold close price with swing pivots">
          <path d={line(g)} fill="none" stroke="#e0a430" strokeWidth="1.5" />
          {goldHighs.map((d, i) => dot(d.x, d.y, "#e5484d", `gh${i}`))}
          {goldLows.map((d, i) => dot(d.x, d.y, "#2fbf71", `gl${i}`))}
        </svg>
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold text-muted-foreground">XAGUSD (silver)</p>
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full rounded-lg border border-border bg-card" role="img" aria-label="Silver close price with swing pivots">
          <path d={line(s)} fill="none" stroke="#7aa2f7" strokeWidth="1.5" />
          {silverHighs.map((d, i) => dot(d.x, d.y, "#e5484d", `sh${i}`))}
          {silverLows.map((d, i) => dot(d.x, d.y, "#2fbf71", `sl${i}`))}
        </svg>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Red dots mark swing highs, green dots swing lows. Divergence = the two metals disagree on
        whether the latest pivot exceeded the previous one.
      </p>
    </div>
  );
}

export function SmtTab({ interval }: { interval: string }) {
  const [result, setResult] = useState<SmtResult | null>(null);
  const [gold, setGold] = useState<Candle[]>([]);
  const [silver, setSilver] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    Promise.all([
      fetch(`/api/smt?interval=${interval}`).then((r) => r.json()),
      fetch(`/api/market/candles?symbol=XAUUSD&interval=${interval}&outputsize=200`).then((r) => r.json()),
      fetch(`/api/market/candles?symbol=XAGUSD&interval=${interval}&outputsize=200`).then((r) => r.json()),
    ])
      .then(([smt, g, s]) => {
        if (!alive) return;
        if (smt.error) throw new Error(smt.error);
        setResult(smt as SmtResult);
        setGold((g.candles ?? []) as Candle[]);
        setSilver((s.candles ?? []) as Candle[]);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "SMT scan failed"))
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [interval]);

  if (loading) {
    return <div className="h-64 animate-pulse rounded-xl bg-muted/40" />;
  }
  if (error) {
    return (
      <p role="alert" className="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</p>
    );
  }
  if (!result) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-border text-muted-foreground">XAU {result.goldSource}</Badge>
        <Badge variant="outline" className={result.silverSource === "LIVE" ? "border-emerald-800 text-emerald-400" : "border-amber-700 text-amber-400"}>
          {result.companionLabel ?? "XAG"} {result.silverSource}
        </Badge>
        <span className="text-xs text-muted-foreground">{result.note}</span>
      </div>

      {result.silverSource === "SIMULATED" && (
        <div className="rounded-lg border border-amber-900/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
          Silver spot (XAG/USD) requires a TwelveData paid plan (Grow or Venture). Until the plan is
          upgraded this panel runs on deterministic simulated silver data so the correlation logic
          stays fully testable. No performance claim in this mode is meaningful.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <DualSparkline gold={gold} silver={silver} />

        <div>
          <h3 className="mb-2 text-sm font-semibold">Detected divergences ({result.divergences.length})</h3>
          {result.divergences.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No SMT divergence in the recent swing windows — both metals are confirming structure.
            </p>
          ) : (
            <ul className="space-y-3">
              {result.divergences.slice().reverse().map((d, i) => (
                <li key={i} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center gap-2">
                    <Badge className={d.type === "BULLISH" ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/15" : "bg-red-500/15 text-red-400 hover:bg-red-500/15"}>
                      SMT {d.type}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{fmtTime(d.windowEnd)}</span>
                  </div>
                  <p className="mt-2 text-sm">
                    <span className="font-semibold text-gold">{d.goldDescription}</span>
                    {" vs "}
                    <span className="font-semibold text-gold">{d.silverDescription}</span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{d.detail}</p>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground">How to read SMT</p>
            <p className="mt-1">
              Gold and silver normally move together because they share the same dollar-liquidity
              driver. When one prints a higher high while the other fails, the move is more likely a
              liquidity grab than genuine repricing — ICT traders use it as confirmation for reversal
              setups at premium/discount levels, never as a standalone entry trigger.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
