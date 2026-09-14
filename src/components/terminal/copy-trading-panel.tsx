"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

/**
 * Copy-trading setup card (bottom of the Signals tab).
 * Pure guidance + the bot downloads — the bots themselves pull
 * /api/signals/feed from the user's own terminal, so no broker
 * credentials ever touch this website. Additive UI only.
 */
export function CopyTradingPanel({ symbol, interval }: { symbol: string; interval: string }) {
  const [origin, setOrigin] = useState("");

  // client-only value — avoids SSR hydration mismatch
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const feedUrl = `${origin || "https://tradepilot1.gabeyre80.workers.dev"}/api/signals/feed?symbol=${symbol}&interval=${interval}`;
  const siteUrl = origin || "https://tradepilot1.gabeyre80.workers.dev";

  return (
    <details className="rounded-xl border border-border bg-card">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold">
        Copy trading{" "}
        <span className="ml-1 text-xs font-normal text-muted-foreground">
          — auto-trade signals in MetaTrader 5 or cTrader
        </span>
      </summary>
      <div className="space-y-5 border-t border-border px-4 py-4 text-sm">
        <p className="text-xs text-muted-foreground">
          A small bot runs inside <strong className="text-foreground">your own</strong> trading
          terminal (PC or VPS), polls the signal feed below and places the trade automatically —
          entry, stop loss, the TP1/TP2/final partial ladder (30/35/35) and the breakeven move after
          TP1, exactly like the backtest. Your account credentials never leave your machine and no
          third-party bridge or subscription is involved. Pick your platform:
        </p>

        {/* ---- MetaTrader 5 ---- */}
        <details className="rounded-lg border border-border bg-background/50" open>
          <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold">
            MetaTrader 5 — Expert Advisor
          </summary>
          <ol className="space-y-2 px-3 py-3 text-xs">
            <li className="flex gap-2">
              <span className="font-bold text-gold">1.</span>
              <span>
                <a
                  href="/tradepilot-copier.mq5"
                  download
                  className="inline-flex items-center gap-1 font-semibold text-gold hover:underline"
                >
                  <Download className="h-3 w-3" aria-hidden /> Download tradepilot-copier.mq5
                </a>{" "}
                and copy it into your terminal&apos;s{" "}
                <code className="rounded bg-muted px-1">MQL5/Experts</code> folder (File → Open Data
                Folder), then compile it in MetaEditor (F7).
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-gold">2.</span>
              <span>
                In MT5: <strong>Tools → Options → Expert Advisors</strong> → tick{" "}
                <em>Allow WebRequest for listed URL</em> and add{" "}
                <code className="rounded bg-muted px-1">{siteUrl}</code> (without this, the EA
                can&apos;t read the feed).
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-gold">3.</span>
              <span>
                Drag the EA onto your broker&apos;s gold chart with the matching timeframe (XAUUSD
                M15 for the default feed), enable <strong>Algo Trading</strong>, and set your lot
                size or risk % in the inputs. Watch the <em>Experts</em> log for &quot;TradePilot
                Copier: ready&quot;.
              </span>
            </li>
          </ol>
        </details>

        {/* ---- cTrader ---- */}
        <details className="rounded-lg border border-border bg-background/50">
          <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold">
            cTrader — cBot
          </summary>
          <ol className="space-y-2 px-3 py-3 text-xs">
            <li className="flex gap-2">
              <span className="font-bold text-gold">1.</span>
              <span>
                <a
                  href="/tradepilot-cbot.cs"
                  download
                  className="inline-flex items-center gap-1 font-semibold text-gold hover:underline"
                >
                  <Download className="h-3 w-3" aria-hidden /> Download tradepilot-cbot.cs
                </a>{" "}
                then in cTrader open the <strong>Automate</strong> tab → <strong>New cBot</strong> →
                replace the generated code with this file → <strong>Build</strong> (Ctrl+B).
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-gold">2.</span>
              <span>
                Add an instance of <em>TradePilotCopier</em> to your broker&apos;s gold chart with
                the matching timeframe (XAUUSD M15 for the default feed). When cTrader asks for
                network access consent, <strong>allow it</strong> — the bot only calls the
                TradePilot feed.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-gold">3.</span>
              <span>
                Set your lot size or risk % in the parameters and press <strong>Play</strong>. The
                gold status box on the chart shows the live feed state; the <em>Automate log</em>{" "}
                records every action.
              </span>
            </li>
          </ol>
        </details>

        <div>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">
            Signal feed the bots read (already running):
          </p>
          <code className="block overflow-x-auto rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-[11px] text-muted-foreground">
            {feedUrl}
          </code>
        </div>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          <strong className="text-foreground">Risk warning:</strong> the bots place real orders on
          the account they run on. Test on a <strong className="text-foreground">demo account</strong>{" "}
          first, never risk more than you can afford to lose, and use the kill switch (MT5:{" "}
          <em>Algo Trading</em> button / cTrader: <em>Stop</em>) as your emergency stop. TradePilot
          signals are educational strategy output — not financial advice.
        </p>
      </div>
    </details>
  );
}
