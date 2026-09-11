"use client";

import type { AnalysisSnapshot, Trend } from "@/lib/ict/types";
import { fmtPrice, fmtTime } from "./format";

const trendColor: Record<Trend, string> = {
  BULLISH: "text-emerald-400",
  BEARISH: "text-red-400",
  NEUTRAL: "text-muted-foreground",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function AnalysisPanel({ analysis }: { analysis: AnalysisSnapshot | null }) {
  if (!analysis) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-muted/40" />
        ))}
      </div>
    );
  }

  const { structure, range, killzone, fvg, orderBlocks, sweeps, pools } = analysis;

  return (
    <div className="space-y-4">
      <Section title="Market structure">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Trend (this TF)</span>
          <span className={`text-sm font-bold ${trendColor[structure.trend]}`}>
            {structure.trend}
          </span>
        </div>
        {range && (
          <>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Dealing range</span>
              <span className="text-sm font-medium">
                {range.zone} · {range.positionPct}%
              </span>
            </div>
            <div className="relative mt-2 h-2 rounded-full bg-gradient-to-r from-emerald-900/60 via-yellow-900/40 to-red-900/60">
              <div
                className="absolute -top-1 h-4 w-1 rounded-full bg-foreground"
                style={{ left: `${Math.min(98, Math.max(0, range.positionPct))}%` }}
                aria-hidden
              />
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
              <span>{fmtPrice(range.low)}</span>
              <span>EQ {fmtPrice(range.equilibrium)}</span>
              <span>{fmtPrice(range.high)}</span>
            </div>
          </>
        )}
      </Section>

      <Section title="Kill zone (UTC)">
        {killzone ? (
          <div className="rounded-lg border border-gold/40 bg-gold/5 px-3 py-2">
            <p className="text-sm font-semibold text-gold">{killzone.name}</p>
            <p className="text-xs text-muted-foreground">
              {killzone.startUtc}–{killzone.endUtc} · {killzone.description}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No kill zone active — outside institutional session windows.
          </p>
        )}
      </Section>

      <Section title={`Unmitigated FVG (${fvg.length})`}>
        {fvg.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open fair value gaps.</p>
        ) : (
          <ul className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
            {fvg.slice(-6).reverse().map((z) => (
              <li key={z.id} className="flex items-center justify-between rounded-md bg-muted/30 px-2.5 py-1.5 text-xs">
                <span className={z.direction === "BULLISH" ? "text-emerald-400" : "text-red-400"}>
                  {z.direction === "BULLISH" ? "Bull" : "Bear"} FVG
                </span>
                <span className="font-mono text-muted-foreground">
                  {fmtPrice(z.bottom)} – {fmtPrice(z.top)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Order blocks (${orderBlocks.length})`}>
        {orderBlocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open order blocks.</p>
        ) : (
          <ul className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
            {orderBlocks.slice(-6).reverse().map((z) => (
              <li key={z.id} className="flex items-center justify-between rounded-md bg-muted/30 px-2.5 py-1.5 text-xs">
                <span className={z.direction === "BULLISH" ? "text-emerald-400" : "text-red-400"}>
                  {z.direction === "BULLISH" ? "Bull" : "Bear"} OB
                </span>
                <span className="font-mono text-muted-foreground">
                  {fmtPrice(z.bottom)} – {fmtPrice(z.top)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Recent liquidity events">
        {sweeps.length === 0 && pools.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent sweeps or liquidity pools.</p>
        ) : (
          <ul className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
            {sweeps.slice(-4).reverse().map((s) => (
              <li key={`${s.side}-${s.time}`} className="rounded-md bg-muted/30 px-2.5 py-1.5 text-xs">
                <span className={s.side === "SELL_SIDE" ? "font-semibold text-emerald-400" : "font-semibold text-red-400"}>
                  {s.side === "SELL_SIDE" ? "Sellside sweep" : "Buyside sweep"}
                </span>{" "}
                <span className="text-muted-foreground">
                  · {fmtPrice(s.level)} · {fmtTime(s.time)}
                </span>
              </li>
            ))}
            {pools.slice(-3).reverse().map((p) => (
              <li key={`${p.type}-${p.time}`} className="rounded-md bg-muted/30 px-2.5 py-1.5 text-xs">
                <span className="font-semibold text-amber-400">
                  {p.type === "EQH" ? "Equal highs" : "Equal lows"}
                </span>{" "}
                <span className="text-muted-foreground">
                  · {fmtPrice(p.price)} · {fmtTime(p.time)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Latest structure events">
        {structure.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No BOS/MSS events detected.</p>
        ) : (
          <ul className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
            {structure.events.slice(-4).reverse().map((e) => (
              <li key={`${e.type}-${e.time}`} className="flex items-center justify-between rounded-md bg-muted/30 px-2.5 py-1.5 text-xs">
                <span className={e.direction === "BULLISH" ? "font-semibold text-emerald-400" : "font-semibold text-red-400"}>
                  {e.type} {e.direction === "BULLISH" ? "↑" : "↓"}
                </span>
                <span className="font-mono text-muted-foreground">
                  {fmtPrice(e.level)} · {fmtTime(e.time)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
