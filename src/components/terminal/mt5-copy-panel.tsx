"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * MT5 copy-trading setup card (bottom of the Signals tab).
 * Pure guidance + the EA download — the EA itself pulls
 * /api/signals/feed from the user's own terminal, so no broker
 * credentials ever touch this website. Additive UI only.
 */
export function Mt5CopyPanel({ symbol, interval }: { symbol: string; interval: string }) {
  const [origin, setOrigin] = useState("");

  // client-only value — avoids SSR hydration mismatch
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const feedUrl = `${origin || "https://tradepilot1.gabeyre80.workers.dev"}/api/signals/feed?symbol=${symbol}&interval=${interval}`;

  return (
    <details className="rounded-xl border border-border bg-card">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold">
        Copy to MT5 <span className="ml-1 text-xs font-normal text-muted-foreground">— auto-trade signals in MetaTrader 5</span>
      </summary>
      <div className="space-y-4 border-t border-border px-4 py-4 text-sm">
        <p className="text-xs text-muted-foreground">
          A small Expert Advisor runs inside <strong className="text-foreground">your own</strong> MT5
          terminal (PC or VPS), polls the signal feed below and places the trade automatically —
          entry, stop loss, the TP1/TP2/final partial ladder (30/35/35) and the breakeven move after
          TP1, exactly like the backtest. Your MT5 account credentials never leave your machine and
          no third-party bridge or subscription is involved.
        </p>

        <ol className="space-y-2 text-xs">
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
              and copy it into your terminal&apos;s <code className="rounded bg-muted px-1">MQL5/Experts</code>{" "}
              folder (File → Open Data Folder), then compile it in MetaEditor (F7).
            </span>
          </li>
          <li className="flex gap-2">
            <span className="font-bold text-gold">2.</span>
            <span>
              In MT5: <strong>Tools → Options → Expert Advisors</strong> → tick{" "}
              <em>Allow WebRequest for listed URL</em> and add{" "}
              <code className="rounded bg-muted px-1">{origin || "https://tradepilot1.gabeyre80.workers.dev"}</code>{" "}
              (without this, the EA can&apos;t read the feed).
            </span>
          </li>
          <li className="flex gap-2">
            <span className="font-bold text-gold">3.</span>
            <span>
              Drag the EA onto your broker&apos;s gold chart with the matching timeframe (XAUUSD M15
              for the default feed), enable <strong>Algo Trading</strong>, and set your lot size or
              risk % in the inputs. Watch the <em>Experts</em> log for &quot;TradePilot Copier:
              ready&quot;.
            </span>
          </li>
        </ol>

        <div>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">Signal feed the EA reads (already running):</p>
          <code className="block overflow-x-auto rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-[11px] text-muted-foreground">
            {feedUrl}
          </code>
        </div>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          <strong className="text-foreground">Risk warning:</strong> the EA places real orders on the
          account it is attached to. Test on a <strong className="text-foreground">demo account</strong>{" "}
          first, never risk more than you can afford to lose, and keep the{" "}
          <em>Algo Trading</em> button as your emergency stop. TradePilot signals are educational
          strategy output — not financial advice.
        </p>
      </div>
    </details>
  );
}
