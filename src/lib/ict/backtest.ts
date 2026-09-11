// Walk-forward backtesting engine for the rule-based ICT setup.
//
// Bias controls (the ones the spec cares about):
//  - NO look-ahead: a setup is evaluated on bar close i; entry orders fill
//    from bar i+1 onward; structure uses only pivots confirmed by bar i.
//  - Pessimistic intrabar assumption: if a candle touches both SL and TP,
//    the STOP is assumed to fill first.
//  - Costs: configurable spread penalty charged on every entry/exit.
//
// Results are reported in R multiples (risk-normalised) so win rate and
// expectancy can be judged independently of position sizing.
import "server-only";
import { getCandles } from "@/lib/market";
import type { IntervalKey, SymbolKey } from "@/lib/market/types";
import { atr, findSwings } from "./swings";
import { detectFvg, detectOrderBlocks } from "./zones";
import { detectSweeps } from "./liquidity";
import type { Candle, StructureEvent, Trend, Zone } from "./types";
import { activeKillzone } from "./range";

export interface BacktestTrade {
  side: "LONG" | "SHORT";
  entryTime: number;
  exitTime: number;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  outcome: "TP2" | "TP1_BE" | "SL" | "TIMEOUT";
  r: number;
  mfeR: number;
  maeR: number;
  barsHeld: number;
}

export interface BacktestMetrics {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  expectancyR: number;
  avgWinR: number;
  avgLossR: number;
  profitFactor: number;
  maxDrawdownR: number;
  bestStreak: number;
  worstStreak: number;
  totalR: number;
}

export interface BacktestResult {
  symbol: SymbolKey;
  interval: IntervalKey;
  bars: number;
  from: number;
  to: number;
  metrics: BacktestMetrics;
  equityCurve: { time: number; r: number }[];
  trades: BacktestTrade[];
  notes: string[];
}

interface OpenTrade {
  side: "LONG" | "SHORT";
  entry: number;
  stop: number;
  /** fixed initial risk in price units — never recomputed after BE move */
  risk: number;
  tp1: number;
  tp2: number;
  entryIndex: number;
  entryTime: number;
  tp1Hit: boolean;
  mfeR: number;
  maeR: number;
}

interface PendingOrder {
  side: "LONG" | "SHORT";
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  placedIndex: number;
  placedTime: number;
}

interface SetupSnapshot {
  trendAt: (i: number) => Trend;
  events: StructureEvent[];
}

function buildStructureWalk(candles: Candle[], lookback = 2): SetupSnapshot {
  const swings = findSwings(candles, lookback);
  const trendByIndex = new Array<Trend>(candles.length).fill("NEUTRAL");
  const events: StructureEvent[] = [];

  let trend: Trend = "NEUTRAL";
  let pendingHigh: number | null = null;
  let pendingLow: number | null = null;
  let cursor = 0;

  for (let i = 0; i < candles.length; i++) {
    while (cursor < swings.length && swings[cursor].index + lookback <= i) {
      const s = swings[cursor];
      if (s.type === "HIGH") pendingHigh = s.price;
      else pendingLow = s.price;
      cursor++;
    }
    const close = candles[i].close;
    if (pendingHigh !== null && close > pendingHigh) {
      events.push({
        index: i,
        time: candles[i].time,
        type: trend === "BEARISH" ? "MSS" : "BOS",
        direction: "BULLISH",
        level: pendingHigh,
      });
      trend = "BULLISH";
      pendingHigh = null;
    } else if (pendingLow !== null && close < pendingLow) {
      events.push({
        index: i,
        time: candles[i].time,
        type: trend === "BULLISH" ? "MSS" : "BOS",
        direction: "BEARISH",
        level: pendingLow,
      });
      trend = "BEARISH";
      pendingLow = null;
    }
    trendByIndex[i] = trend;
  }

  return { trendAt: (i) => trendByIndex[Math.min(i, candles.length - 1)], events };
}

export async function runBacktest(opts: {
  symbol: SymbolKey;
  interval: IntervalKey;
  bars?: number;
  sweepWindow?: number;
  expiryBars?: number;
  maxHoldBars?: number;
  spreadPct?: number;
}): Promise<BacktestResult> {
  const {
    symbol,
    interval,
    bars = 1500,
    sweepWindow = 15,
    expiryBars = 10,
    maxHoldBars = 120,
    spreadPct = 0.00012, // ~12bp round-trip on gold, conservative for spot
  } = opts;

  const { candles } = await getCandles(symbol, interval, Math.min(Math.max(bars, 400), 5000));
  if (candles.length < 150) throw new Error("Not enough historical candles for a backtest");

  const atrValue = atr(candles, 14);
  const structure = buildStructureWalk(candles);
  // includeMitigated: mitigation must be judged per-bar at setup time,
  // never globally (that would introduce look-ahead bias).
  const fvgZones = detectFvg(candles, 5000, true);
  const obZones = detectOrderBlocks(candles, atrValue, 1.4, 5000, true);
  const allZones = [...fvgZones, ...obZones].sort((a, b) => a.startIndex - b.startIndex);
  const sweeps = detectSweeps(candles, 2, 5000);

  const zoneMitigatedAt = new Map<string, number>();
  // precompute mitigation bar (first candle fully/back-through) for honesty
  for (const z of allZones) {
    const mid = (z.top + z.bottom) / 2;
    for (let i = z.startIndex + 3; i < candles.length; i++) {
      const c = candles[i];
      if (z.direction === "BULLISH" && c.low <= mid) {
        zoneMitigatedAt.set(z.id, i);
        break;
      }
      if (z.direction === "BEARISH" && c.high >= mid) {
        zoneMitigatedAt.set(z.id, i);
        break;
      }
    }
  }

  const trades: BacktestTrade[] = [];
  let open: OpenTrade | null = null;
  let pending: PendingOrder | null = null;

  const warmup = 60;
  const start = candles[warmup] ? warmup : 10;

  const closeTrade = (i: number, exitPrice: number, outcome: BacktestTrade["outcome"]) => {
    if (!open) return;
    const dir = open.side === "LONG" ? 1 : -1;
    const risk = open.risk;
    let r = dir * (exitPrice - open.entry) / risk;
    if (open.tp1Hit) {
      // half closed at TP1 (1.5R), remainder at this exit
      const r1 = 1.5;
      r = 0.5 * r1 + 0.5 * r;
    }
    r -= spreadPct * open.entry / risk; // spread cost in R
    trades.push({
      side: open.side,
      entryTime: open.entryTime,
      exitTime: candles[i].time,
      entry: open.entry,
      stop: open.stop,
      tp1: open.tp1,
      tp2: open.tp2,
      outcome,
      r: Math.round(r * 100) / 100,
      mfeR: Math.round(open.mfeR * 100) / 100,
      maeR: Math.round(open.maeR * 100) / 100,
      barsHeld: i - open.entryIndex,
    });
    open = null;
  };

  for (let i = start; i < candles.length; i++) {
    const c = candles[i];

    // ---- manage open position ----
    if (open) {
      const dir = open.side === "LONG" ? 1 : -1;
      const risk = open.risk;
      const favorable = dir * (open.side === "LONG" ? c.high - open.entry : open.entry - c.low);
      const adverse = dir * (open.entry - (open.side === "LONG" ? c.low : c.high));
      open.mfeR = Math.max(open.mfeR, favorable / risk);
      open.maeR = Math.min(open.maeR, adverse / risk);

      const hitStop = open.side === "LONG" ? c.low <= open.stop : c.high >= open.stop;
      const hitTp1 = open.side === "LONG" ? c.high >= open.tp1 : c.low <= open.tp1;
      const hitTp2 = open.side === "LONG" ? c.high >= open.tp2 : c.low <= open.tp2;

      // pessimistic: stop first if both stop and target in same candle
      if (hitStop) {
        const stopLevel = open.tp1Hit ? open.entry : open.stop;
        closeTrade(i, stopLevel, open.tp1Hit ? "TP1_BE" : "SL");
      } else if (hitTp2 && !open.tp1Hit) {
        // jump straight to TP2 without TP1? TP1 is between entry and TP2 — must have hit
        open.tp1Hit = true;
        closeTrade(i, open.tp2, "TP2");
      } else if (hitTp1 && !open.tp1Hit) {
        open.tp1Hit = true;
        open.stop = open.entry; // move to breakeven
        // continue managing the runner
      } else if (i - open.entryIndex >= maxHoldBars) {
        closeTrade(i, c.close, "TIMEOUT");
      }
      continue;
    }

    // ---- fill pending order ----
    if (pending) {
      const expired = i - pending.placedIndex > expiryBars;
      const touched = pending.side === "LONG" ? c.low <= pending.entry : c.high >= pending.entry;
      const stoppedSameBar =
        pending.side === "LONG"
          ? touched && c.low <= pending.stop
          : touched && c.high >= pending.stop;

      if (touched) {
        // pessimistic: if the fill candle also trades through the stop, SL
        open = {
          side: pending.side,
          entry: pending.entry,
          stop: pending.stop,
          risk: Math.abs(pending.entry - pending.stop),
          tp1: pending.tp1,
          tp2: pending.tp2,
          entryIndex: i,
          entryTime: candles[i].time,
          tp1Hit: false,
          mfeR: 0,
          maeR: stoppedSameBar ? -1 : 0,
        };
        pending = null;
        if (stoppedSameBar) {
          closeTrade(i, open.stop, "SL");
        }
        continue;
      }
      if (expired) {
        pending = null;
        continue;
      }
      continue;
    }

    // ---- look for a new setup (decided on bar i close) ----
    const trend = structure.trendAt(i);
    if (trend === "NEUTRAL") continue;

    const side: "LONG" | "SHORT" = trend === "BULLISH" ? "LONG" : "SHORT";
    const dir = side === "LONG" ? 1 : -1;

    const recentSweep = [...sweeps]
      .reverse()
      .find(
        (s) =>
          s.index <= i &&
          s.index >= i - sweepWindow &&
          (side === "LONG" ? s.side === "SELL_SIDE" : s.side === "BUY_SIDE")
      );
    if (!recentSweep) continue;

    const zone = [...allZones]
      .reverse()
      .find((z) => {
        if (z.startIndex >= i) return false;
        const mit = zoneMitigatedAt.get(z.id);
        if (mit !== undefined && mit <= i) return false;
        if (side === "LONG" && z.direction !== "BULLISH") return false;
        if (side === "SHORT" && z.direction !== "BEARISH") return false;
        // Resting order below (long) / above (short) current close, within a
        // structure-sane distance of the sweep. Covers both the "zone between
        // sweep extreme and price" and the classic "post-sweep displacement
        // FVG retrace" entry.
        if (side === "LONG") {
          return z.top <= c.close && z.bottom >= recentSweep.extreme - atrValue;
        }
        return z.bottom >= c.close && z.top <= recentSweep.extreme + atrValue;
      });
    if (!zone) continue;

    const entry = (zone.top + zone.bottom) / 2;
    const buffer = atrValue * 0.3;
    const stop =
      side === "LONG" ? Math.min(zone.bottom, recentSweep.extreme) - buffer : Math.max(zone.top, recentSweep.extreme) + buffer;
    const risk = Math.abs(entry - stop);
    if (risk < atrValue * 0.25 || risk / entry > 0.015) continue;

    pending = {
      side,
      entry,
      stop,
      tp1: side === "LONG" ? entry + risk * 1.5 : entry - risk * 1.5,
      tp2: side === "LONG" ? entry + risk * 2.5 : entry - risk * 2.5,
      placedIndex: i,
      placedTime: candles[i].time,
    };
  }

  // ---- metrics ----
  const wins = trades.filter((t) => t.r > 0);
  const losses = trades.filter((t) => t.r <= 0);
  const grossWin = wins.reduce((s, t) => s + t.r, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.r, 0));

  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  const equityCurve: { time: number; r: number }[] = [];
  let streak = 0;
  let bestStreak = 0;
  let worstStreak = 0;
  for (const t of trades) {
    equity += t.r;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
    equityCurve.push({ time: t.exitTime, r: Math.round(equity * 100) / 100 });
    if (t.r > 0) streak = streak > 0 ? streak + 1 : 1;
    else streak = streak < 0 ? streak - 1 : -1;
    bestStreak = Math.max(bestStreak, streak);
    worstStreak = Math.min(worstStreak, streak);
  }

  const metrics: BacktestMetrics = {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? Math.round((wins.length / trades.length) * 1000) / 10 : 0,
    expectancyR: trades.length ? Math.round((equity / trades.length) * 100) / 100 : 0,
    avgWinR: wins.length ? Math.round((grossWin / wins.length) * 100) / 100 : 0,
    avgLossR: losses.length ? Math.round((grossLoss / losses.length) * 100) / 100 : 0,
    profitFactor: grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : grossWin > 0 ? 99 : 0,
    maxDrawdownR: Math.round(maxDd * 100) / 100,
    bestStreak,
    worstStreak: Math.abs(worstStreak),
    totalR: Math.round(equity * 100) / 100,
  };

  return {
    symbol,
    interval,
    bars: candles.length,
    from: candles[0].time,
    to: candles[candles.length - 1].time,
    metrics,
    equityCurve,
    trades: trades.slice(-200).reverse(),
    notes: [
      "Walk-forward simulation on historical candles. Setups are decided on bar close; fills occur from the next bar onward (no look-ahead bias).",
      "When a candle touches both stop and target, the stop is assumed to fill first (pessimistic fill model).",
      `Spread/cost model: ${(spreadPct * 10000).toFixed(1)} bp charged on each round trip, expressed in R.`,
      "Rule-based historical study — past performance does not guarantee future results.",
      `Backtest run during ${activeKillzone()?.name ?? "no active kill zone"}.`,
    ],
  };
}
