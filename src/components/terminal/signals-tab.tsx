"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "./auth-provider";
import { Mt5CopyPanel } from "./mt5-copy-panel";
import { fmtPrice } from "./format";
import type { SignalCandidate, WhyNoTradeState } from "@/lib/ict/types";

export interface SavedSignalRow {
  id: string;
  symbol: string;
  interval: string;
  side: string;
  entry: number;
  stopLoss: number;
  targets: string;
  confidence: number;
  grade: string;
  rationale: string;
  createdAt: string;
}

const gradeColor = (g: string) =>
  g === "A+" || g === "A" ? "bg-emerald-500/15 text-emerald-400" : g === "B" ? "bg-amber-500/15 text-amber-400" : "bg-muted text-muted-foreground";

const CATEGORY_LABELS: Record<string, string> = {
  context: "Context",
  liquidity: "Liquidity",
  structure: "Structure",
  entry: "Entry",
  confirmation: "Confirm",
  risk: "Risk",
};
const CATEGORY_MAX: Record<string, number> = {
  context: 20,
  liquidity: 20,
  structure: 20,
  entry: 20,
  confirmation: 10,
  risk: 10,
};

function CategoryBars({ scores }: { scores: SignalCandidate["scores"] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
      {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
        const v = scores[key as keyof SignalCandidate["scores"]];
        const max = CATEGORY_MAX[key];
        return (
          <div key={key}>
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>{label}</span>
              <span className="font-mono">{v}/{max}</span>
            </div>
            <div className="h-1 w-full rounded bg-muted">
              <div className="h-1 rounded bg-gold" style={{ width: `${(v / max) * 100}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Live strategy-state checklist (spec §4) — generated from actual engine state. */
function WhyNoTradePanel({ state }: { state: WhyNoTradeState }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">WHY NO TRADE?</h3>
        <span className="text-xs text-muted-foreground">
          {state.side ? `next setup would be ${state.side}` : "no tradeable side yet"}
        </span>
      </div>
      <ul className="mt-3 space-y-1.5">
        {state.conditions.map((c, i) => (
          <li key={i} className="flex items-start gap-2 text-xs">
            <span aria-hidden className={c.detected ? "text-emerald-400" : "text-red-400"}>
              {c.detected ? "✓" : "✗"}
            </span>
            <span className={c.detected ? "text-foreground/90" : "text-muted-foreground"}>
              <span className="font-medium">{c.label}</span> — {c.reason}
            </span>
          </li>
        ))}
      </ul>
      {state.waitingFor.length > 0 && (
        <div className="mt-3 rounded-lg border border-gold/30 bg-gold/5 px-3 py-2">
          <p className="text-xs font-semibold text-gold">Waiting for:</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-xs text-muted-foreground">
            {state.waitingFor.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ol>
        </div>
      )}
      <p className="mt-2 text-[10px] text-muted-foreground">
        Generated from the engine state on the last closed candle — not a hardcoded message.
      </p>
    </div>
  );
}

function SignalCard({
  s,
  onSave,
  saveState,
}: {
  s: SignalCandidate;
  onSave?: () => void;
  saveState?: "idle" | "saving" | "saved" | "error" | "anonymous";
}) {
  const long = s.side === "LONG";
  return (
    <article className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={long ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/15" : "bg-red-500/15 text-red-400 hover:bg-red-500/15"}>
          {s.side}
        </Badge>
        <span className="text-sm font-semibold">{s.symbol}</span>
        <span className="text-xs text-muted-foreground">{s.interval}</span>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-bold ${gradeColor(s.tier)}`}>
          {s.tier} · {s.confidence}/100
        </span>
      </div>

      <div className="mt-3">
        <CategoryBars scores={s.scores} />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Entry</dt>
          <dd className="font-mono font-semibold">{fmtPrice(s.entry)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Stop loss</dt>
          <dd className="font-mono font-semibold text-red-400">{fmtPrice(s.stopLoss)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Targets</dt>
          <dd className="font-mono font-semibold text-emerald-400">
            {s.targets.map((t) => fmtPrice(t)).join(" / ")}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">R:R to final target</dt>
          <dd className="font-mono font-semibold">1 : {s.rrToFinal}</dd>
        </div>
      </dl>

      <p className="mt-2 text-[11px] text-muted-foreground">
        Sequence: {s.sequence.map((e) => e.kind).join(" → ")}
      </p>

      <ul className="mt-3 space-y-1">
        {s.rationale.map((r, i) => (
          <li key={i} className="flex gap-2 text-xs text-muted-foreground">
            <span aria-hidden className="text-gold">▸</span>
            {r}
          </li>
        ))}
      </ul>

      {onSave && (
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            Rule-based analysis · not financial advice
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-border"
            disabled={saveState === "saving" || saveState === "saved"}
            onClick={onSave}
          >
            {saveState === "saved"
              ? "Saved ✓"
              : saveState === "saving"
                ? "Saving…"
                : saveState === "anonymous"
                  ? "Sign in to save"
                  : saveState === "error"
                    ? "Retry save"
                    : "Save signal"}
          </Button>
        </div>
      )}
    </article>
  );
}

export function SignalsTab({
  candidates,
  loading,
  error,
  note,
  noTradeReasons,
  whyNoTrade,
  savedSignals,
  onRefreshSaved,
  symbol,
  interval,
}: {
  candidates: SignalCandidate[];
  loading: boolean;
  error: string | null;
  note: string;
  noTradeReasons: string[];
  whyNoTrade: WhyNoTradeState | null;
  savedSignals: SavedSignalRow[];
  onRefreshSaved: () => void;
  symbol: string;
  interval: string;
}) {
  const { accessToken, user } = useAuth();
  const [saveStates, setSaveStates] = useState<Record<string, "idle" | "saving" | "saved" | "error" | "anonymous">>({});

  async function saveSignal(s: SignalCandidate) {
    const token = accessToken();
    if (!token) {
      setSaveStates((m) => ({ ...m, [s.id]: "anonymous" }));
      return;
    }
    setSaveStates((m) => ({ ...m, [s.id]: "saving" }));
    try {
      const res = await fetch("/api/signals/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(s),
      });
      if (!res.ok) throw new Error();
      setSaveStates((m) => ({ ...m, [s.id]: "saved" }));
      onRefreshSaved();
    } catch {
      setSaveStates((m) => ({ ...m, [s.id]: "error" }));
    }
  }

  async function deleteSignal(id: string) {
    const token = accessToken();
    if (!token) return;
    await fetch(`/api/signals/saved?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    onRefreshSaved();
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="h-40 animate-pulse rounded-xl bg-muted/40" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p role="alert" className="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
        {error}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">{note}</p>

      {candidates.length === 0 ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-dashed border-border px-6 py-6 text-center">
            <p className="text-sm font-semibold">NO TRADE — no setup meets the quality bar</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              Waiting is part of the strategy. The checklist below is generated from the
              live strategy state (spec §4) — core requirements vs optional confluence.
            </p>
            {noTradeReasons.length > 0 && (
              <ul className="mx-auto mt-3 max-w-md space-y-1 text-left">
                {noTradeReasons.map((r, i) => (
                  <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                    <span aria-hidden className="text-gold">▸</span>{r}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {whyNoTrade && <WhyNoTradePanel state={whyNoTrade} />}
        </div>
      ) : (
        <div className="space-y-4">
          {whyNoTrade && <WhyNoTradePanel state={whyNoTrade} />}
          <div className="grid gap-3 lg:grid-cols-2">
            {candidates.map((s) => (
              <SignalCard
                key={s.id}
                s={s}
                onSave={() => saveSignal(s)}
                saveState={saveStates[s.id] ?? (user ? "idle" : "anonymous")}
              />
            ))}
          </div>
        </div>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold">Saved signals {savedSignals.length > 0 && `(${savedSignals.length})`}</h3>
        {savedSignals.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing saved yet. Save a candidate to track it in your journal.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {savedSignals.map((r) => {
              const targets = JSON.parse(r.targets) as number[];
              const rationale = JSON.parse(r.rationale) as string[];
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                  <Badge variant="outline" className={r.side === "LONG" ? "border-emerald-700 text-emerald-400" : "border-red-800 text-red-400"}>
                    {r.side}
                  </Badge>
                  <span className="font-semibold">{r.symbol}</span>
                  <span className="text-xs text-muted-foreground">{r.interval}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {fmtPrice(r.entry)} · SL {fmtPrice(r.stopLoss)} → {targets.map((t) => fmtPrice(t)).join(" / ")}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${gradeColor(r.grade)}`}>{r.grade}</span>
                  <span className="hidden max-w-xs truncate text-xs text-muted-foreground md:inline" title={rationale[0]}>
                    {rationale[0]}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto h-7 px-2 text-xs text-muted-foreground hover:text-red-400"
                    onClick={() => deleteSignal(r.id)}
                  >
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Mt5CopyPanel symbol={symbol} interval={interval} />
    </div>
  );
}
