"use client";

import { useState } from "react";
import { Card } from "@/components/site/ui";
import { Activity, BookOpen, FlaskConical, Radar } from "lucide-react";

/**
 * Private trading terminal (noindex). Demo workspace shell:
 * live signals, backtesting, session radar and journal tabs are
 * representative of the authenticated product. Data connection is
 * prepared for Supabase (see src/lib/supabase.ts) — the demo below
 * renders illustrative, clearly-labeled sample data.
 */

const TABS = [
  { id: "signals", label: "Signals", icon: Radar },
  { id: "backtest", label: "Backtesting", icon: FlaskConical },
  { id: "sessions", label: "Session radar", icon: Activity },
  { id: "journal", label: "Journal", icon: BookOpen },
] as const;

type TabId = (typeof TABS)[number]["id"];

const DEMO_SIGNALS = [
  {
    pair: "XAUUSD",
    dir: "LONG",
    session: "London",
    status: "Confirmed",
    score: 78,
    context: "Sweep of Asian low → MSS → FVG retrace",
    zone: "4,012.4 – 4,016.8",
    invalidation: "4,005.9 (sweep low)",
    factors: ["Kill Zone", "SMT clean", "Discount of London range"],
  },
  {
    pair: "XAGUSD",
    dir: "SHORT",
    session: "New York",
    status: "Watching",
    score: 64,
    context: "Equal highs swept, awaiting MSS close",
    zone: "48.90 – 49.12",
    invalidation: "49.65 (sweep high)",
    factors: ["Round-number pool", "Gold confirming"],
  },
  {
    pair: "XAUUSD",
    dir: "SHORT",
    session: "New York",
    status: "Invalidated",
    score: 55,
    context: "Sweep of PDH failed MSS requirement",
    zone: "—",
    invalidation: "—",
    factors: ["No MSS: setup skipped by engine"],
  },
];

export default function DashboardPage() {
  const [tab, setTab] = useState<TabId>("signals");
  const supabaseStatus = (() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    return url && key
      ? "connected"
      : "not configured (add NEXT_PUBLIC_SUPABASE_ANON_KEY)";
  })();

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
      <div className="rounded-xl border border-gold/25 bg-gold/5 p-4 text-sm text-muted-foreground">
        <strong className="text-foreground">Demo workspace.</strong> This is
        the authenticated app shell (noindex). Data shown is illustrative.
        Supabase connection: {supabaseStatus}.
      </div>

      <div
        role="tablist"
        aria-label="Terminal sections"
        className="mt-6 flex flex-wrap gap-2"
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? "border-gold/60 bg-gold/10 text-gold"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="mt-6">
        {tab === "signals" ? (
          <div className="grid gap-4 lg:grid-cols-3">
            {DEMO_SIGNALS.map((s, i) => (
              <Card key={i} className="h-full">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-semibold text-foreground">
                    {s.pair}
                  </span>
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs font-bold ${
                      s.dir === "LONG"
                        ? "bg-bull/15 text-bull"
                        : "bg-bear/15 text-bear"
                    }`}
                  >
                    {s.dir}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {s.context}
                </p>
                <dl className="mt-4 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Session</dt>
                    <dd className="text-foreground">{s.session}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Status</dt>
                    <dd className="text-foreground">{s.status}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Entry zone</dt>
                    <dd className="font-mono text-foreground">{s.zone}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Invalidation</dt>
                    <dd className="font-mono text-foreground">{s.invalidation}</dd>
                  </div>
                </dl>
                <div className="mt-4 flex items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${s.score}%` }}
                    />
                  </div>
                  <span className="font-mono text-sm text-gold">{s.score}/100</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {s.factors.map((f) => (
                    <span
                      key={f}
                      className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        ) : null}

        {tab === "backtest" ? (
          <Card>
            <h2 className="font-semibold text-foreground">
              Bar-replay backtester
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Replay historical XAUUSD/XAGUSD sessions candle-by-candle with
              the engine&apos;s rules overlaid: pools, verified sweeps, MSS
              gates and FVG entries. Results report expectancy (R per trade),
              profit factor and maximum drawdown — never win-rate marketing.
              Full methodology on the{" "}
              <a href="/ict-backtesting" className="text-gold hover:underline">
                ICT backtesting page
              </a>
              .
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                ["Sample period", "2019 – 2026"],
                ["Instruments", "XAUUSD, XAGUSD"],
                ["Look-ahead bias", "None (timestamp-audited)"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-border p-4">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">{k}</p>
                  <p className="mt-1 font-mono text-sm text-foreground">{v}</p>
                </div>
              ))}
            </div>
          </Card>
        ) : null}

        {tab === "sessions" ? (
          <Card>
            <h2 className="font-semibold text-foreground">Session radar</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Asia builds, London raids, New York decides. The radar tracks
              which pools are loaded in each session and when Kill Zones
              open — the same session context attached to every signal.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                ["Asia (19:00–03:00 ET)", "Building ranges"],
                ["London (02:00–05:00 ET)", "Raiding Asian pools"],
                ["New York (07:00–10:00 ET)", "Deciding the day"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-border p-4">
                  <p className="font-mono text-xs text-gold">{k}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{v}</p>
                </div>
              ))}
            </div>
          </Card>
        ) : null}

        {tab === "journal" ? (
          <Card>
            <h2 className="font-semibold text-foreground">Trading journal</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Log your executions against the engine&apos;s signals: did you
              follow the model? Where did you override it? The journal is your
              mirror for discipline — and the fastest way to discover whether
              your edge lives in the rules or in your overrides.
            </p>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
