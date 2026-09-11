// Rule-based signal generation v2 — built on the SAME sequence-verified
// setup builder as the backtester (spec #6, #36 "backtest vs replay
// consistency"). A signal exists only when the full ordered chain holds on
// the last CLOSED bar:
//   HTF bias → discount/premium → sweep+rejection → displacement → MSS/BOS
//   → fresh FVG/OB → retracement entry
// otherwise the result is an explicit NO TRADE (spec #31).
import "server-only";
import { getCandles } from "@/lib/market";
import type { IntervalKey, SymbolKey } from "@/lib/market/types";
import { buildSeriesContext, buildSetupAt, DEFAULT_CONFIG, type CooldownState } from "./sequence";
import { smtSeries } from "./smtseries";
import { SESSION_LABELS } from "./sessions";
import type { SignalCandidate, Tier } from "./types";

interface BuildArgs {
  symbol: SymbolKey;
  interval: IntervalKey;
}

function tierToGrade(tier: Tier): "A" | "B" | "C" {
  if (tier === "A+" || tier === "A") return "A";
  if (tier === "B") return "B";
  return "C";
}

export async function generateSignals({
  symbol,
  interval,
}: BuildArgs): Promise<{ candidates: SignalCandidate[]; evaluatedAt: number; note: string; noTradeReasons: string[] }> {
  const [{ candles, source }, silver] = await Promise.all([
    getCandles(symbol, interval, 400),
    getCandles("XAGUSD", interval, 400).catch(() => null),
  ]);

  if (candles.length < 120) throw new Error("Insufficient candles for analysis");

  const smtEvents = silver && silver.candles.length > 40 ? smtSeries(candles, silver.candles) : [];
  const ctx = buildSeriesContext(symbol, interval, candles, smtEvents);

  // evaluate on the last CLOSED bar (never the forming candle — no repaint)
  const intervalSec = ctx.intervalSec;
  const now = Math.floor(Date.now() / 1000);
  let barIndex = candles.length - 1;
  if (candles[barIndex].time + intervalSec > now && barIndex > 1) barIndex = barIndex - 1;

  const cooldown: CooldownState = {
    usedSweepKeys: new Set(),
    blacklistedZones: new Set(),
    lastSignalIndex: -Infinity,
  };

  const { setup, rejection } = buildSetupAt(ctx, barIndex, DEFAULT_CONFIG, cooldown);
  const candidates: SignalCandidate[] = [];

  if (setup && setup.tier !== "NO_TRADE") {
    candidates.push({
      id: `${symbol}-${interval}-${setup.side}-${Math.floor(Date.now() / 60000)}`,
      symbol,
      interval,
      side: setup.side,
      entry: Math.round(setup.entry * 100) / 100,
      stopLoss: Math.round(setup.initialStop * 100) / 100,
      targets: setup.targets.map((t) => Math.round(t.price * 100) / 100),
      targetSources: setup.targets.map((t) => t.source),
      rrToTarget2: setup.targets[1]?.rr ?? setup.rrToFinal,
      rrToFinal: setup.rrToFinal,
      confidence: setup.totalScore,
      grade: tierToGrade(setup.tier),
      tier: setup.tier,
      scores: setup.scores,
      sequence: setup.events,
      volRegime: setup.volRegime,
      mktRegime: setup.mktRegime,
      rationale: setup.rationale,
      htfTrend: setup.htfBias,
      createdAt: Date.now(),
      killzone: SESSION_LABELS[setup.session] ?? setup.session,
      smtAligned: setup.smtAligned,
    });
  }

  const noTradeReasons: string[] = [];
  if (!setup) {
    if (rejection) noTradeReasons.push(reasonLabel(rejection));
  } else if (setup.tier === "NO_TRADE") {
    noTradeReasons.push(`Sequence matched but scored ${setup.totalScore}/100 — below the tier-B (70) threshold`, ...setup.rejections);
  }

  return {
    candidates,
    evaluatedAt: Date.now(),
    note:
      source === "SIMULATED"
        ? "Simulated data — signals are illustrative only."
        : "Sequence-verified ICT setups on the last closed candle. The score is a strategy-quality grade, NOT a win probability. Educational information only — not financial advice.",
    noTradeReasons,
  };
}

function reasonLabel(rejection: string): string {
  const map: Record<string, string> = {
    "htf-bias-unclear": "HTF bias unclear — no directional context",
    "vol-extreme": "Volatility regime EXTREME — standing aside",
    "vol-high": "Volatility regime HIGH — filtered",
    "regime-unclear": "Market regime UNCLEAR — NO TRADE",
    "off-session": "Outside preferred kill zones",
    "no-recent-sweep": "No recent liquidity sweep",
    "weak-sweep": "Sweep lacked rejection quality",
    "sweep-already-traded": "Liquidity event already traded",
    "no-structure-confirmation": "No MSS/BOS confirmation after the sweep",
    "no-displacement": "No displacement leg after the sweep",
    "weak-displacement": "Displacement quality below threshold",
    "no-entry-zone": "No fresh FVG/OB created by this sequence",
    "weak-zone": "Entry zone quality below threshold",
    "wrong-range-half": "Entry zone not in discount/premium half",
    "stop-too-tight": "Structural stop too tight vs volatility",
    "stop-too-wide": "Structural stop too wide vs volatility",
    "no-structural-target": "No structural liquidity target available",
    "insufficient-rr": "Best structural target below minimum RR",
    "below-tier": "Score below tier threshold",
  };
  return map[rejection] ?? rejection;
}
