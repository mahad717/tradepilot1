"use client";

/**
 * use-signal-alerts — browser notifications when a NEW live signal drops.
 *
 * Design constraints (user directive): notification feature ONLY — no engine,
 * API, or preset changes. The signals endpoint computes on demand, so "a new
 * signal dropped" is detected by light client-side polling (60s) of the same
 * public GET /api/signals the terminal already uses. That response is
 * Cache-Control: private, max-age=60, so the poller adds at most ~1
 * computation per minute while a terminal is open — the same order as a user
 * who keeps the page open and refreshes manually.
 *
 * "New" means a setup FINGERPRINT (side + entry + stop + targets) that was
 * never seen for this symbol+interval. Signal ids embed the generation minute
 * and createdAt resets on every call, so ids cannot be used for dedupe —
 * fingerprints are stable across re-evaluations of the same bar.
 *
 * Scope honesty: this notifies while the terminal page is open in some
 * browser tab (background tabs included — timers throttle to ~1/min, which
 * matches the poll cadence). Closed-browser delivery would need server push
 * infrastructure (VAPID + subscription store) — deliberately NOT added here.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { fmtPrice } from "./format";
import type { IntervalKey, SymbolKey } from "@/lib/market/types";

const LS_ENABLED = "tp.signalAlerts.enabled";
const LS_SEEN = "tp.signalAlerts.seen";
const POLL_MS = 60_000;
const SEEN_CAP = 50;

const INTERVAL_LABEL: Partial<Record<IntervalKey, string>> = {
  "5min": "5m",
  "15min": "15m",
  "1h": "1H",
  "4h": "4H",
  "1day": "1D",
};

type AlertPermission = "granted" | "denied" | "default" | "unsupported";

interface AlertCandidate {
  side: string;
  entry: number;
  stopLoss: number;
  targets: number[];
  confidence: number;
  grade?: string;
  killzone?: string;
}

/** Stable setup identity — survives re-evaluation of the same bar. */
function fingerprint(c: AlertCandidate): string {
  return [c.side, c.entry, c.stopLoss, ...c.targets].join("|");
}

function seenStorageKey(symbol: SymbolKey, interval: IntervalKey): string {
  return `${LS_SEEN}.${symbol}.${interval}`;
}

function loadSeen(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveSeen(key: string, list: string[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(list.slice(-SEEN_CAP)));
  } catch {
    // private mode — in-memory dedupe still works for this session
  }
}

/** Short two-tone blip so background tabs are audible even when the OS mutes notification sounds. */
function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    for (const [freq, at] of [[880, 0], [1318, 0.12]] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.05, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.1);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.12);
    }
    window.setTimeout(() => void ctx.close().catch(() => {}), 500);
  } catch {
    // audio is best-effort
  }
}

function currentPermission(): AlertPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission as AlertPermission;
}

export function useSignalAlerts(opts: {
  symbol: SymbolKey;
  interval: IntervalKey;
  /** called when the user clicks a notification — focus the terminal's Signals tab */
  onActivate?: () => void;
}) {
  const { symbol, interval, onActivate } = opts;
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<AlertPermission>("default");
  const [lastAlert, setLastAlert] = useState<string | null>(null);
  const enabledRef = useRef(false);
  const onActivateRef = useRef(onActivate);
  useEffect(() => {
    onActivateRef.current = onActivate;
  }, [onActivate]);

  // hydrate persisted state once (client-only values: Notification.permission + localStorage;
  // lazy initializers would desync SSR hydration, so mount-time sync setState is the correct pattern)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see note above
    setPermission(currentPermission());
    try {
      setEnabled(window.localStorage.getItem(LS_ENABLED) === "1" && currentPermission() === "granted");
    } catch {
      setEnabled(false);
    }
  }, []);

  const markAllSeen = useCallback(
    (candidates: AlertCandidate[]) => {
      const key = seenStorageKey(symbol, interval);
      const seen = new Set(loadSeen(key));
      for (const c of candidates) seen.add(fingerprint(c));
      saveSeen(key, [...seen]);
    },
    [symbol, interval]
  );

  const alert = useCallback(
    (c: AlertCandidate) => {
      const il = INTERVAL_LABEL[interval] ?? interval;
      const tps = c.targets.map((t) => fmtPrice(t)).join(" / ");
      const title = `New ${symbol} ${il} signal — ${c.side}`;
      const body = `${fmtPrice(c.entry)} · SL ${fmtPrice(c.stopLoss)} · TP ${tps} · score ${c.confidence}${c.grade ? ` (${c.grade})` : ""}${c.killzone ? ` · ${c.killzone}` : ""}`;
      toast({ title, description: `${body} — open the Signals tab for the full breakdown.` });
      setLastAlert(`${symbol} ${il}: ${title}`);
      beep();
      try {
        if ("Notification" in window && Notification.permission === "granted") {
          const n = new Notification(title, {
            body,
            tag: `${symbol}-${interval}-${fingerprint(c)}`,
            // no renotify — one notification per fingerprint
          });
          n.onclick = () => {
            window.focus();
            onActivateRef.current?.();
            n.close();
          };
        }
      } catch {
        // some browsers throw without a service worker — the toast already fired
      }
    },
    [symbol, interval]
  );

  // ---- polling watcher ----
  useEffect(() => {
    if (!enabled || permission !== "granted") return;
    let cancelled = false;
    let baseline = true; // first successful poll records state, never alerts

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/signals?symbol=${symbol}&interval=${interval}`);
        if (!res.ok) return;
        const json = (await res.json()) as { candidates?: AlertCandidate[] };
        const candidates = json.candidates ?? [];
        const key = seenStorageKey(symbol, interval);
        const seen = new Set(loadSeen(key));
        if (baseline) {
          markAllSeen(candidates);
          baseline = false;
          return;
        }
        const fresh = candidates.filter((c) => !seen.has(fingerprint(c)));
        if (fresh.length) {
          for (const c of fresh) alert(c);
          markAllSeen(candidates);
        }
      } catch {
        // network hiccup / rate limit — silent, next poll retries
      }
    };

    void poll();
    const t = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [enabled, permission, symbol, interval, alert, markAllSeen]);

  const toggle = useCallback(async () => {
    if (enabledRef.current) {
      enabledRef.current = false;
      setEnabled(false);
      try {
        window.localStorage.setItem(LS_ENABLED, "0");
      } catch {}
      return;
    }
    const p = currentPermission();
    if (p === "unsupported") {
      setPermission("unsupported");
      toast({ title: "Notifications not supported", description: "This browser can't show desktop notifications." });
      return;
    }
    let next: AlertPermission = p;
    if (p === "default") {
      try {
        next = (await Notification.requestPermission()) as AlertPermission;
      } catch {
        next = "denied";
      }
      setPermission(next);
    }
    if (next !== "granted") {
      toast({
        title: "Notifications blocked",
        description: "Allow notifications for this site in your browser settings, then toggle again.",
      });
      return;
    }
    enabledRef.current = true;
    setEnabled(true);
    try {
      window.localStorage.setItem(LS_ENABLED, "1");
    } catch {}
    toast({
      title: "Signal alerts on",
      description: `You'll be notified the moment a new ${symbol} signal drops while this page is open.`,
    });
  }, [symbol]);

  return { enabled, permission, toggle, lastAlert };
}
