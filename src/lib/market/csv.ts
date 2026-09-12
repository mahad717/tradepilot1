// Isomorphic CSV → Candle parser for the backtest data-source selector.
//
// Accepts the two layouts traders actually download:
//  1. Investing.com export — "Date","Price","Open","High","Low","Vol.","Change %"
//     (BOM, quoted fields, comma thousands separators, newest-first, no volume)
//  2. Generic OHLC — time/datetime/timestamp, open, high, low, close[, volume]
//     with or without a header row
//
// Deliberately PURE and free of "server-only": the browser imports the same
// function for an upload preview, and the API route re-parses authoritatively
// so the client can never lie about what the file contains.
import type { Candle, IntervalKey } from "./types";

/**
 * Coarseness of the candle spacing, classified from the RAW median gap
 * (before snapping to the engine's supported interval steps). Weekly and
 * monthly files cannot drive the engine at all — they are macro context —
 * so the distinction matters for messaging even though IntervalKey tops
 * out at 1day.
 */
export type CoarseGranularity = "intraday" | "daily" | "weekly" | "monthly";

export function granularityLabel(g: CoarseGranularity): string {
  return { intraday: "intraday", daily: "daily", weekly: "weekly", monthly: "monthly" }[g];
}

export interface CsvParseSummary {
  /** data rows seen in the file (header excluded) */
  rowsSeen: number;
  /** rows that became valid candles */
  parsed: number;
  /** rows dropped: unparseable date/price or invalid OHLC */
  skipped: number;
  /** duplicate timestamps removed (first occurrence kept) */
  duplicatesRemoved: number;
  /** whether the file needed re-sorting into chronological order */
  reSorted: boolean;
  detectedInterval: IntervalKey | null;
  detectedSeconds: number | null;
  /** raw-median-gap classification — names weekly/monthly files the snapped key cannot */
  granularity: CoarseGranularity;
  /** raw median spacing in seconds (unsnapped), null when undetectable */
  medianGapSeconds: number | null;
  from: number | null;
  to: number | null;
  headers: string[];
  /** human label of the layout recognized */
  format: string;
  warnings: string[];
}

export interface CsvParseResult {
  candles: Candle[];
  summary: CsvParseSummary;
}

const INTERVAL_STEPS: { key: IntervalKey; seconds: number }[] = [
  { key: "5min", seconds: 300 },
  { key: "15min", seconds: 900 },
  { key: "1h", seconds: 3600 },
  { key: "4h", seconds: 14400 },
  { key: "1day", seconds: 86400 },
];

export function intervalSecondsOfKey(interval: IntervalKey): number {
  return INTERVAL_STEPS.find((i) => i.key === interval)?.seconds ?? 900;
}

/** Detect the candle interval from the median spacing between sorted candles. */
function medianGapSeconds(candles: Candle[]): number | null {
  const gaps: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const dt = candles[i].time - candles[i - 1].time;
    if (dt > 0) gaps.push(dt);
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

function detectIntervalSeconds(candles: Candle[]): number | null {
  const median = medianGapSeconds(candles);
  if (median === null) return null;
  // snap to the nearest supported step (log-distance: 45min → 1h, 2h → 1h/4h edge)
  let best = INTERVAL_STEPS[0];
  let bestDist = Infinity;
  for (const step of INTERVAL_STEPS) {
    const dist = Math.abs(Math.log(median / step.seconds));
    if (dist < bestDist) {
      bestDist = dist;
      best = step;
    }
  }
  return best.seconds;
}

/**
 * Classify candle coarseness from the RAW median spacing. Boundaries tuned
 * to real downloads: daily bars sit ~1 day apart (weekend Fri→Mon = 3d, but
 * the median is 1d), weekly exports ~7 days (holiday weeks 14d), monthly
 * exports ~28–31 days. Beyond 20 days only monthly-style exports exist.
 */
export function classifyGranularity(medianSec: number | null): CoarseGranularity {
  if (medianSec === null) return "intraday";
  if (medianSec < 86400) return "intraday";
  if (medianSec < 5 * 86400) return "daily";
  if (medianSec <= 20 * 86400) return "weekly";
  return "monthly";
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function isNumeric(v: string): boolean {
  return v.trim() !== "" && Number.isFinite(Number(v));
}

/**
 * Parse one date cell into unix seconds (UTC). Returns null when unrecognizable.
 * Disambiguation rule for 3-part numeric dates: if the first component is > 12
 * the row must be DD/MM/YYYY; otherwise MM/DD/YYYY (Investing.com's default
 * export format) is assumed and stated in the UI.
 */
export function parseCsvDate(rawCell: string): number | null {
  const cell = rawCell.trim().replace(/^"|"$/g, "");
  if (cell === "") return null;

  // unix seconds (10 digits) or milliseconds (13 digits)
  if (/^\d{10}$/.test(cell)) return Number(cell);
  if (/^\d{13}$/.test(cell)) return Math.floor(Number(cell) / 1000);

  // ISO: 2026-09-11 / 2026-09-11T14:30 / 2026-09-11 14:30[:45] (+ optional Z/offset)
  let m = cell.match(/^(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const [, y, mo, d, h = "0", mi = "0", s = "0"] = m;
    return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) / 1000;
  }

  // Month names: "Sep 11, 2026 14:30" / "11 Sep 2026"
  m = cell.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s*(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()] !== undefined) {
    const [, monName, d, y, h = "0", mi = "0"] = m;
    return Date.UTC(Number(y), MONTHS[monName.slice(0, 3).toLowerCase()], Number(d), Number(h), Number(mi)) / 1000;
  }
  m = cell.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()] !== undefined) {
    const [, d, monName, y, h = "0", mi = "0"] = m;
    return Date.UTC(Number(y), MONTHS[monName.slice(0, 3).toLowerCase()], Number(d), Number(h), Number(mi)) / 1000;
  }

  // Numeric 3-part: MM/DD/YYYY or DD/MM/YYYY (auto-flip when impossible), optional HH:MM
  m = cell.match(/^(\d{1,4})[\/\-](\d{1,2})[\/\-](\d{1,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const [, a, b, y, h = "0", mi = "0"] = m;
    if (y.length === 4 && Number(y) > 1970) {
      let month: number;
      let day: number;
      if (Number(a) > 12 && Number(b) <= 12) {
        day = Number(a); month = Number(b); // must be DD/MM
      } else {
        month = Number(a); day = Number(b); // MM/DD (Investing.com default)
      }
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return Date.UTC(Number(y), month - 1, day, Number(h), Number(mi)) / 1000;
      }
    }
  }
  return null;
}

/** Parse one price cell: strips quotes, comma thousands separators, spaces; "-" → null. */
function parseCsvPrice(rawCell: string): number | null {
  const cell = rawCell.trim().replace(/^"|"$/g, "").replace(/,/g, "").replace(/\s+/g, "");
  if (cell === "" || cell === "-" || cell === "n/a" || cell === "N/A") return null;
  const n = Number(cell);
  return Number.isFinite(n) ? n : null;
}

/** Split one CSV line honoring double-quoted fields (commas inside quotes are literal). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function normalizeHeader(h: string): string {
  return h.trim().replace(/^"|"$/g, "").toLowerCase().replace(/[^a-z%]/g, "");
}

type ColumnRole = "date" | "open" | "high" | "low" | "close" | "ignore";

function roleFor(header: string): ColumnRole | null {
  const n = normalizeHeader(header);
  if (["date", "datetime", "timestamp", "time", "gmttime", "localtime", "gmt", "local", "unix", "ts"].includes(n)) return "date";
  if (n === "open" || n === "o") return "open";
  if (n === "high" || n === "h") return "high";
  if (n === "low" || n === "l") return "low";
  if (n === "close" || n === "price" || n === "last" || n === "c" || n === "adjclose") return "close";
  return null; // volume, change %, etc. → parsed only in the positional fallback
}

/**
 * Parse a candle CSV into validated, chronological candles.
 * Never throws for dirty content — bad rows are counted in the summary.
 */
export function parseCsvCandles(raw: string): CsvParseResult {
  const warnings: string[] = [];
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw; // BOM
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== "");

  const summary: CsvParseSummary = {
    rowsSeen: 0, parsed: 0, skipped: 0, duplicatesRemoved: 0, reSorted: false,
    detectedInterval: null, detectedSeconds: null,
    granularity: "intraday", medianGapSeconds: null,
    from: null, to: null,
    headers: [], format: "unknown", warnings,
  };
  if (lines.length === 0) {
    warnings.push("The file is empty.");
    return { candles: [], summary };
  }

  // ----- locate the header row and column mapping -----
  let headerLine = -1;
  let roles: (ColumnRole | null)[] = [];
  let positional = false; // headerless time,open,high,low,close[,volume]
  const firstCells = splitCsvLine(lines[0]);
  const firstIsData = parseCsvDate(firstCells[0]) !== null && firstCells.slice(1, 5).filter(isNumeric).length >= 4;
  if (firstIsData) {
    positional = true;
    roles = ["date", "open", "high", "low", "close", "ignore"];
    summary.format = "headerless OHLC";
  } else {
    headerLine = 0;
    const headers = splitCsvLine(lines[0]);
    summary.headers = headers.map((h) => h.trim());
    roles = headers.map(roleFor);
    const found = roles.filter(Boolean).length;
    if (found >= 5 && roles.includes("date")) {
      summary.format = summary.headers.some((h) => normalizeHeader(h) === "price") ? "Investing.com export" : "generic OHLC";
    } else {
      // recognized too few columns — try the positional fallback anyway
      positional = true;
      roles = ["date", "open", "high", "low", "close", "ignore"];
      summary.format = "assumed time,open,high,low,close";
      warnings.push(
        `Header row not recognized (${summary.headers.join(", ") || "empty"}) — columns were read positionally as time, open, high, low, close.`
      );
    }
  }

  // ----- parse rows -----
  const candles: Candle[] = [];
  const dataLines = lines.slice(headerLine + 1);
  summary.rowsSeen = dataLines.length;
  let invalidOhlc = 0;
  let badDate = 0;
  let badPrice = 0;
  for (const line of dataLines) {
    const cells = splitCsvLine(line);
    const pick = (role: ColumnRole): string | null => {
      if (positional) {
        const idx = ["date", "open", "high", "low", "close"].indexOf(role);
        return idx >= 0 && idx < cells.length ? cells[idx] : null;
      }
      const idx = roles.indexOf(role);
      return idx >= 0 && idx < cells.length ? cells[idx] : null;
    };
    const time = parseCsvDate(pick("date") ?? "");
    if (time === null) {
      badDate++;
      summary.skipped++;
      continue;
    }
    const o = parseCsvPrice(pick("open") ?? "");
    const h = parseCsvPrice(pick("high") ?? "");
    const l = parseCsvPrice(pick("low") ?? "");
    const c = parseCsvPrice(pick("close") ?? "");
    if (o === null || h === null || l === null || c === null) {
      badPrice++;
      summary.skipped++;
      continue;
    }
    if (!(h >= Math.max(o, c) && l <= Math.min(o, c) && l > 0 && h > 0)) {
      invalidOhlc++;
      summary.skipped++;
      continue;
    }
    candles.push({ time, open: o, high: h, low: l, close: c });
  }
  if (badDate) warnings.push(`${badDate} row${badDate === 1 ? "" : "s"} skipped — date not parseable.`);
  if (badPrice) warnings.push(`${badPrice} row${badPrice === 1 ? "" : "s"} skipped — missing or non-numeric OHLC values.`);
  if (invalidOhlc) warnings.push(`${invalidOhlc} row${invalidOhlc === 1 ? "" : "s"} skipped — invalid OHLC (high < low, or non-positive prices).`);

  // ----- chronology -----
  let reSorted = false;
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].time < candles[i - 1].time) {
      reSorted = true;
      break;
    }
  }
  if (reSorted) candles.sort((a, b) => a.time - b.time);
  summary.reSorted = reSorted;

  let duplicatesRemoved = 0;
  const deduped: Candle[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i > 0 && candles[i].time === candles[i - 1].time) {
      duplicatesRemoved++;
      continue;
    }
    deduped.push(candles[i]);
  }
  summary.duplicatesRemoved = duplicatesRemoved;
  if (duplicatesRemoved) warnings.push(`${duplicatesRemoved} duplicate timestamp${duplicatesRemoved === 1 ? "" : "s"} removed (first occurrence kept).`);

  // ----- interval + range + guidance -----
  if (deduped.length >= 3) {
    const seconds = detectIntervalSeconds(deduped);
    const rawMedian = medianGapSeconds(deduped);
    summary.medianGapSeconds = rawMedian;
    summary.granularity = classifyGranularity(rawMedian);
    if (seconds !== null) {
      summary.detectedSeconds = seconds;
      const snap = INTERVAL_STEPS.find((s) => s.seconds === seconds);
      summary.detectedInterval = snap?.key ?? "15min";
      if (medianGapCrossesWeeks(deduped)) {
        warnings.push("Candle spacing is irregular (mixed intervals or long gaps) — the timeframe below is the MEDIAN spacing; verify it matches what you downloaded.");
      }
    }
  }
  if (deduped.length > 0) {
    summary.parsed = deduped.length;
    summary.from = deduped[0].time;
    summary.to = deduped[deduped.length - 1].time;
  }

  if (summary.granularity === "weekly" || summary.granularity === "monthly") {
    const g = granularityLabel(summary.granularity).toUpperCase();
    warnings.push(
      `This file contains ${g} candles (${deduped.length} bars). The backtest engine CANNOT run on them — ICT kill zones, session liquidity and FVG/OB precision need INTRADAY candles (5m/15m/1H). This file serves as higher-timeframe macro context; upload intraday history to run the engine.`
    );
  } else if (summary.detectedSeconds !== null && summary.detectedSeconds >= 86400) {
    warnings.push(
      "This file contains DAILY candles. The engine runs on them, but ICT intraday models — kill zones, session liquidity, 5-minute FVG precision — cannot be observed on daily bars. Results are a coarse approximation at best."
    );
  }
  if (deduped.length > 0 && deduped.length < 150) {
    warnings.push(`Only ${deduped.length} candles — below the engine's 150-candle minimum. Download a longer history (at least a few months of intraday data).`);
  }
  if (deduped.length > 25000) {
    warnings.push(`${deduped.length} candles in the file — the engine uses the most recent 25,000.`);
  }
  return { candles: deduped, summary };
}

/** true when typical gaps wildly exceed the median spacing (irregular history) */
function medianGapCrossesWeeks(candles: Candle[]): boolean {
  const gaps: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const dt = candles[i].time - candles[i - 1].time;
    if (dt > 0) gaps.push(dt);
  }
  if (gaps.length < 3) return false;
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  const p90 = gaps[Math.floor(gaps.length * 0.9)];
  return p90 > median * 8;
}

/** Human label for a detected interval — used by the UI preview banner. */
export function intervalLabelOfKey(interval: IntervalKey): string {
  return { "5min": "5m", "15min": "15m", "1h": "1H", "4h": "4H", "1day": "1D" }[interval];
}

// ---------------------------------------------------------------------------
// Macro context for coarse (daily/weekly/monthly) uploads
//
// The engine cannot run on weekly/monthly files, but they still answer real
// ICT questions at the higher-timeframe level: where is price relative to the
// previous period's liquidity (PMH/PML analog), is the dealing leg in
// premium or discount, and what does raw swing structure say. Computed here
// so the client preview and any future server use share one honest definition.
// ---------------------------------------------------------------------------

export interface CoarseContext {
  granularity: CoarseGranularity;
  /** most recent close in the file */
  lastClose: number;
  lastTime: number;
  /** previous COMPLETED period's range (second-to-last row) — always present when the context exists */
  prevHigh: number;
  prevLow: number;
  /** last close vs the previous period's range */
  vsPrev: "above-both" | "inside" | "below-both";
  /** dealing range of the last `leg` completed periods */
  legHigh: number;
  legLow: number;
  /** position of the last close inside the leg range, 0..100 (null when flat leg) */
  legPct: number | null;
  legLabel: "premium" | "discount" | "equilibrium" | null;
  /** fractal swing structure (pivot span 2) — verdict from the last two highs AND lows */
  structure: "bullish" | "bearish" | "mixed" | null;
  swingsFound: number;
  /** consecutive closes in one direction at the end of the file */
  streak: { dir: "up" | "down" | null; count: number };
}

const LEG_PERIODS = 6;

/**
 * ICT-flavored macro read of a coarse candle series. Pure + isomorphic.
 * Returns null below 8 candles (not enough history for any of the reads).
 */
export function coarseContext(candles: Candle[], granularity: CoarseGranularity): CoarseContext | null {
  if (candles.length < 8) return null;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2]; // previous completed period relative to the last row

  const prevHigh = prev.high;
  const prevLow = prev.low;
  const vsPrev: CoarseContext["vsPrev"] =
    last.close > prevHigh ? "above-both" : last.close < prevLow ? "below-both" : "inside";

  const leg = candles.slice(-1 - LEG_PERIODS, -1); // LEG_PERIODS completed periods
  const legHigh = Math.max(...leg.map((c) => c.high));
  const legLow = Math.min(...leg.map((c) => c.low));
  const span = legHigh - legLow;
  const legPct = span > 0 ? Math.round(((last.close - legLow) / span) * 1000) / 10 : null;
  const legLabel =
    legPct === null ? null : legPct > 60 ? "premium" : legPct < 40 ? "discount" : "equilibrium";

  // fractal pivots with a 2-bar arm on each side
  const pivotHighs: number[] = [];
  const pivotLows: number[] = [];
  for (let i = 2; i < candles.length - 2; i++) {
    const c = candles[i];
    if (
      c.high > candles[i - 1].high && c.high > candles[i - 2].high &&
      c.high > candles[i + 1].high && c.high > candles[i + 2].high
    ) pivotHighs.push(c.high);
    if (
      c.low < candles[i - 1].low && c.low < candles[i - 2].low &&
      c.low < candles[i + 1].low && c.low < candles[i + 2].low
    ) pivotLows.push(c.low);
  }
  let structure: CoarseContext["structure"] = null;
  if (pivotHighs.length >= 2 && pivotLows.length >= 2) {
    const hh = pivotHighs[pivotHighs.length - 1] > pivotHighs[pivotHighs.length - 2];
    const hl = pivotLows[pivotLows.length - 1] > pivotLows[pivotLows.length - 2];
    structure = hh && hl ? "bullish" : !hh && !hl ? "bearish" : "mixed";
  }

  let streakDir: "up" | "down" | null = null;
  let streakCount = 0;
  for (let i = candles.length - 1; i > 0; i--) {
    const d = candles[i].close > candles[i - 1].close ? "up" : candles[i].close < candles[i - 1].close ? "down" : null;
    if (d === null) break;
    if (streakDir === null) streakDir = d;
    if (d !== streakDir) break;
    streakCount++;
  }

  return {
    granularity,
    lastClose: last.close,
    lastTime: last.time,
    prevHigh,
    prevLow,
    vsPrev,
    legHigh,
    legLow,
    legPct,
    legLabel,
    structure,
    swingsFound: pivotHighs.length + pivotLows.length,
    streak: { dir: streakDir, count: streakCount },
  };
}
