// Rule-based signal generation v3 — built on the SAME model-aware setup
// builder as the backtester (spec §6, "backtest vs replay consistency").
// A signal exists only when a full model chain holds on the last CLOSED bar;
// otherwise the result is an explicit NO TRADE with a live "WHY NO TRADE?"
// checklist generated from the actual strategy state (spec §4).
import "server-only";
import { getCandles } from "@/lib/market";
import type { IntervalKey, SymbolKey } from "@/lib/market/types";
import {
  buildSeriesContext,
  buildSetupAt,
  probeSetupState,
  DEFAULT_CONFIG,
  type CooldownState,
} from "./sequence";
import { smtSeries } from "./smtseries";
import { SESSION_LABELS } from "./sessions";
import { REJECTION_LABELS, type SignalCandidate, type Tier, type WhyNoTradeState } from "./types";

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
}: BuildArgs): Promise<{ candidates: SignalCandidate[]; evaluatedAt: number; note: string; noTradeReasons: string[]; whyNoTrade: WhyNoTradeState | null }> {
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
  // live WHY NO TRADE checklist from the actual strategy state (spec §4)
  const probe = probeSetupState(ctx, barIndex, DEFAULT_CONFIG);
  const whyNoTrade: WhyNoTradeState = {
    side: probe.side,
    conditions: probe.conditions.map((c) => ({
      label: c.label,
      core: c.core,
      detected: c.detected,
      timestamp: c.timestamp,
      price: c.price,
      range: null,
      timeframe: c.key === "htfBias" ? "4H/1H" : interval,
      reason: c.reason,
    })),
    waitingFor: probe.waitingFor,
    evaluatedAt: Date.now(),
    barTime: probe.barTime,
  };

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
    if (rejection) noTradeReasons.push(REJECTION_LABELS[rejection] ?? rejection);
  } else if (setup.tier === "NO_TRADE") {
    noTradeReasons.push(`Sequence matched but scored ${setup.totalScore}/100 — below the tier-B (70) threshold`, ...setup.rejections);
  }

  return {
    candidates,
    evaluatedAt: Date.now(),
    note:
      source === "SIMULATED"
        ? "Simulated data — signals are illustrative only."
        : "Model-verified ICT setups on the last closed candle. The score is a strategy-quality grade, NOT a win probability. Educational information only — not financial advice.",
    noTradeReasons,
    whyNoTrade,
  };
}
