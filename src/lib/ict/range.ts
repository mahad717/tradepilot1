// Premium / Discount dealing range and ICT Kill Zones (UTC).
import type { Candle, DealingRange, KillzoneInfo } from "./types";

/**
 * Dealing range from the highest high and lowest low of the recent window.
 *   equilibrium = 50% retracement
 *   discount    = 0–50%  (long-bias zone)
 *   premium     = 50–100% (short-bias zone)
 *   OTE         = 62–79% retracement of the directional leg
 */
export function computeDealingRange(
  candles: Candle[],
  lookback = 60
): DealingRange | null {
  if (candles.length < 10) return null;
  const window = candles.slice(-lookback);
  let high = -Infinity;
  let low = Infinity;
  let highIdx = 0;
  let lowIdx = 0;
  window.forEach((c, i) => {
    if (c.high > high) {
      high = c.high;
      highIdx = i;
    }
    if (c.low < low) {
      low = c.low;
      lowIdx = i;
    }
  });

  if (high <= low) return null;

  const last = window[window.length - 1].close;
  const equilibrium = (high + low) / 2;
  const positionPct = ((last - low) / (high - low)) * 100;

  // OTE measured from the leg that produced the latest extreme
  const bullishLeg = highIdx > lowIdx; // low -> high leg (uptrend leg)
  let oteTop: number;
  let oteBottom: number;
  if (bullishLeg) {
    // retracement of up-leg: 62–79% down from high
    const leg = high - low;
    oteTop = high - leg * 0.62;
    oteBottom = high - leg * 0.79;
  } else {
    // retracement of down-leg: 62–79% up from low
    const leg = high - low;
    oteBottom = low + leg * 0.62;
    oteTop = low + leg * 0.79;
  }

  const zone: DealingRange["zone"] =
    positionPct > 55 ? "PREMIUM" : positionPct < 45 ? "DISCOUNT" : "EQUILIBRIUM";

  return {
    high,
    low,
    equilibrium,
    zone,
    positionPct: Math.round(positionPct * 10) / 10,
    oteTop,
    oteBottom,
  };
}

export const KILLZONES: Omit<KillzoneInfo, "active">[] = [
  {
    key: "asia",
    name: "Asian Kill Zone",
    startUtc: "00:00",
    endUtc: "06:00",
    description: "Asian session range builds the liquidity London and New York often hunt.",
  },
  {
    key: "london",
    name: "London Kill Zone",
    startUtc: "07:00",
    endUtc: "10:00",
    description: "Primary manipulation window — Judas swing and range displacement.",
  },
  {
    key: "ny-am",
    name: "New York AM Kill Zone",
    startUtc: "12:00",
    endUtc: "15:00",
    description: "Highest volatility window; classic silver & gold expansion session.",
  },
  {
    key: "london-close",
    name: "London Close Kill Zone",
    startUtc: "15:00",
    endUtc: "17:00",
    description: "Reversal window as London positions unwind into the fix.",
  },
  {
    key: "ny-pm",
    name: "New York PM Kill Zone",
    startUtc: "17:30",
    endUtc: "20:00",
    description: "Afternoon session — continuation or accumulation setups.",
  },
];

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function activeKillzone(timeSec: number | null = null): KillzoneInfo | null {
  const now = timeSec ? new Date(timeSec * 1000) : new Date();
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  for (const kz of KILLZONES) {
    if (minutes >= minutesOf(kz.startUtc) && minutes < minutesOf(kz.endUtc)) {
      return { ...kz, active: true };
    }
  }
  return null;
}

export function listKillzones(timeSec: number | null = null): KillzoneInfo[] {
  const active = activeKillzone(timeSec);
  return KILLZONES.map((kz) => ({ ...kz, active: active?.key === kz.key }));
}
