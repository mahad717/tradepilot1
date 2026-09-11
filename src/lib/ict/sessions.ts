// Session / kill-zone classification for a timestamp (pure — shared by live
// signals and backtests so both see identical session boundaries).
import type { SessionKey } from "./types";

interface Window {
  key: Exclude<SessionKey, "off-session">;
  startMin: number;
  endMin: number;
}

// UTC minutes, matching the KILLZONES defined in range.ts.
const WINDOWS: Window[] = [
  { key: "asia", startMin: 0 * 60, endMin: 6 * 60 },
  { key: "london", startMin: 7 * 60, endMin: 10 * 60 },
  { key: "ny-am", startMin: 12 * 60, endMin: 15 * 60 },
  { key: "london-close", startMin: 15 * 60, endMin: 17 * 60 },
  { key: "ny-pm", startMin: 17 * 60 + 30, endMin: 20 * 60 },
];

/** Which kill zone / session a timestamp falls into. */
export function sessionKeyAt(timeSec: number): SessionKey {
  const d = new Date(timeSec * 1000);
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  for (const w of WINDOWS) {
    if (m >= w.startMin && m < w.endMin) return w.key;
  }
  return "off-session";
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
