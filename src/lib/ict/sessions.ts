// Session / kill-zone classification for a timestamp (pure — shared by live
// signals and backtests so both see identical session boundaries).
//
// DST-AWARE (spec §18-timezone): kill zones are defined in MARKET-LOCAL time
// and converted to UTC per timestamp:
//   - London KZ  07:00–10:00 Europe/London  (07:00–10:00 UTC in winter,
//                06:00–09:00 UTC in summer — the old fixed-UTC window was
//                wrong for half the year)
//   - NY AM KZ   09:30–12:00 America/New_York (the actual NY morning session)
//   - NY PM KZ   13:30–16:00 America/New_York
//   - London Close KZ 15:00–17:00 Europe/London
//   - Asian KZ   00:00–06:00 UTC (Tokyo a.m. range; kept UTC deliberately)
//
// Conversion uses Intl.DateTimeFormat with the IANA zone (supported in
// Node and workerd). Offsets are memoised per calendar day per zone so the
// backtest loop stays fast (one lookup per zone per day, not per bar).
import type { SessionKey } from "./types";

interface Window {
  key: Exclude<SessionKey, "off-session">;
  zone: "UTC" | "Europe/London" | "America/New_York";
  /** start/end minutes in the window's LOCAL market time */
  startMin: number;
  endMin: number;
}

const WINDOWS: Window[] = [
  { key: "asia", zone: "UTC", startMin: 0 * 60, endMin: 6 * 60 },
  { key: "london", zone: "Europe/London", startMin: 7 * 60, endMin: 10 * 60 },
  { key: "ny-am", zone: "America/New_York", startMin: 9 * 60 + 30, endMin: 12 * 60 },
  { key: "london-close", zone: "Europe/London", startMin: 15 * 60, endMin: 17 * 60 },
  { key: "ny-pm", zone: "America/New_York", startMin: 13 * 60 + 30, endMin: 16 * 60 },
];

/**
 * Local wall-clock minutes-since-midnight + weekday for a UTC timestamp in a
 * given IANA zone, via Intl (no external tz database needed).
 * Intl.DateTimeFormat construction is expensive — formatters are memoised.
 */
const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtfFor(timeZone: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${timeZone}:${JSON.stringify(opts)}`;
  let f = dtfCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, ...opts });
    dtfCache.set(key, f);
  }
  return f;
}

function localMinutes(timeSec: number, timeZone: string): { minutes: number; dow: number } {
  const parts = dtfFor(timeZone, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(timeSec * 1000));
  let hour = 0;
  let minute = 0;
  let dow = 0;
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  for (const p of parts) {
    if (p.type === "hour") hour = Number(p.value) % 24; // "24" can appear with hour12:false
    else if (p.type === "minute") minute = Number(p.value);
    else if (p.type === "weekday") dow = dowMap[p.value] ?? 0;
  }
  return { minutes: hour * 60 + minute, dow };
}
// Memoised offset lookup: zone+UTC-day → {offsetMin, dow}. The offset for a
// zone can change mid-session only at DST transitions (03:00 local), and no
// kill zone straddles that hour, so a per-day memo is exact for our windows.
const offsetCache = new Map<string, { offsetMin: number; dow: number }>();

function zoneOffsetAndDow(timeSec: number, zone: string): { offsetMin: number; dow: number } {
  const dayKey = Math.floor(timeSec / 86400);
  const cacheKey = `${zone}:${dayKey}`;
  const hit = offsetCache.get(cacheKey);
  if (hit) return hit;
  // compute the zone's UTC offset by formatting the timestamp in the zone
  // and comparing wall-clock to UTC (exact at this instant).
  const parts = dtfFor(zone, {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(timeSec * 1000));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = dowMap[get("weekday")] ?? 0;
  const asUtc = Date.UTC(
    Number(get("year")),
    Number(get("month")) - 1,
    Number(get("day")),
    Number(get("hour")) % 24,
    Number(get("minute")),
    Number(get("second"))
  );
  const offsetMin = Math.round((asUtc - timeSec * 1000) / 60000);
  const value = { offsetMin, dow };
  if (offsetCache.size < 4000) offsetCache.set(cacheKey, value);
  return value;
}

/** Which kill zone / session a timestamp falls into (DST-aware). */
const sessionMemo = new Map<number, SessionKey>();
export function sessionKeyAt(timeSec: number): SessionKey {
  const memo = sessionMemo.get(timeSec);
  if (memo !== undefined) return memo;
  let key: SessionKey = "off-session";
  for (const w of WINDOWS) {
    if (w.zone === "UTC") {
      const d = new Date(timeSec * 1000);
      const m = d.getUTCHours() * 60 + d.getUTCMinutes();
      if (m >= w.startMin && m < w.endMin) {
        key = w.key;
        break;
      }
      continue;
    }
    const lm = localMinutes(timeSec, w.zone);
    if (lm.minutes >= w.startMin && lm.minutes < w.endMin) {
      key = w.key;
      break;
    }
  }
  if (sessionMemo.size > 20000) sessionMemo.clear();
  sessionMemo.set(timeSec, key);
  return key;
}

/** True when the timestamp is inside any kill zone. */
export function isKillzone(timeSec: number): boolean {
  return sessionKeyAt(timeSec) !== "off-session";
}

/** New York means the AM + PM kill zones together. */
export function sessionMatches(key: SessionKey, filter: string[]): boolean {
  if (filter.length === 0) return true;
  if (filter.includes(key)) return true;
  return (key === "ny-am" || key === "ny-pm") && filter.includes("ny");
}

export const SESSION_LABELS: Record<SessionKey, string> = {
  asia: "Asian KZ",
  london: "London KZ",
  "ny-am": "New York AM KZ",
  "london-close": "London Close KZ",
  "ny-pm": "New York PM KZ",
  "off-session": "Off-session",
};

/** Human-readable UTC window for display — resolved for a given date. */
export function sessionWindowLabel(key: Exclude<SessionKey, "off-session">, timeSec: number): string {
  const w = WINDOWS.find((x) => x.key === key);
  if (!w) return key;
  if (w.zone === "UTC") return `${fmtMin(w.startMin)}–${fmtMin(w.endMin)} UTC`;
  const { offsetMin } = zoneOffsetAndDow(timeSec, w.zone);
  return `${fmtMin(w.startMin)}–${fmtMin(w.endMin)} ${w.zone.split("/")[1].replace("_", " ")} (${fmtMin(w.startMin - offsetMin)}–${fmtMin(w.endMin - offsetMin)} UTC)`;
}

function fmtMin(m: number): string {
  const mm = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
}
