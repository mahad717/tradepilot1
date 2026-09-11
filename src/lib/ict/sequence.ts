// Sequence-verified ICT setup builder (spec #6, #7) — the core of engine v2.
//
// A trade REQUIRES the full ordered chain, each step caused by the previous:
//   HTF bias → discount/premium location → liquidity sweep (with rejection)
//   → displacement → MSS/BOS confirmation → fresh FVG/OB created by that
//   displacement → retracement into the zone → entry.
// Every event is timestamped and must satisfy its recency window; old
// concepts cannot qualify a new trade indefinitely.
//
// The module is PURE (no I/O, no server-only) so live signals, backtests and
// the validation suite execute byte-identical logic.
import type {
  AmbiguityModel,
  AuditLine,
  BreakevenMode,
  Candle,
  CategoryScores,
  CostModel,
  FunnelCounters,
  LiquidityPool,
  LiquiditySweep,
  MarketRegime,
  Setup,
  SetupEvent,
  SetupZoneInfo,
  Side,
  StructureEvent,
  Swing,
  Tier,
  Trend,
  VolatilityRegime,
  Zone,
} from "./types";
import { detectSweeps, detectLiquidityPools } from "./liquidity";
import { findSwings } from "./swings";
import { detectFvg, detectOrderBlocks } from "./zones";
import { structureWalkSeries } from "./structure";
import { atrSeries, volRegimeSeries } from "./volatility";
import { marketRegimeSeries, type RegimeSeries } from "./regime";
import { htfBiasSeries, htfSecondsFor } from "./htf";
import { assessDisplacement, findDisplacementCandle } from "./displacement";
import { classifySweep, type SweepAssessment } from "./sweepquality";
import { fvgQuality, obQuality } from "./zonequality";
import { buildTargetLadder, prevExtremes, type StructuralTarget } from "./targets";
import { sessionKeyAt } from "./sessions";
import type { IntervalKey, SymbolKey } from "@/lib/market/types";
import { intervalSeconds } from "@/lib/market/types";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface EngineConfig {
  // sequence / recency (spec #6, #7)
  maxSweepAgeBars: number; // anchor sweep must be at most this old
  maxStructureAgeBars: number; // MSS/BOS must occur within this many bars after the sweep
  orderExpiryBars: number; // pending limit order lifetime
  // quality gates (spec #8–#12)
  sweepQualityMin: number; // 0..1
  displacementQualityMin: number; // 0..1
  zoneQualityMin: number; // 0..1
  requireHtfBias: boolean; // LONG needs HTF bullish, SHORT bearish
  requireDiscountPremium: boolean; // entry zone in the correct range half

  // risk (spec #4, #5)
  minRR: number; // structural target must be at least this far
  minStopAtrMult: number;
  maxStopAtrMult: number;
  maxStopPctOfPrice: number;

  // tiers (spec #30) — score is a strategy-quality score, NOT a probability
  tierAPlus: number;
  tierA: number;
  tierB: number; // below → NO_TRADE

  // sessions (spec #13) — session keys allowed to trade; [] = any
  sessions: string[];

  // regimes (spec #15, #16)
  blockedVolRegimes: VolatilityRegime[];
  rangeRegimeMinScore: number; // in RANGE markets require at least this score

  // cooldowns (spec #17)
  minBarsBetweenSignals: number;
  oneTradePerSweep: boolean;
  sameZoneCooldown: boolean; // zone blacklisted after a losing trade

  // trade management (spec #26, #27)
  beMode: BreakevenMode;
  beTriggerR: number;
  partialShares: [number, number, number];
  maxHoldBars: number;

  // execution realism (spec #28, #29)
  ambiguity: AmbiguityModel;
  randomSeed: number;
  costs: Record<SymbolKey, CostModel>;
  riskMoney: number; // account currency risked per trade (1R)

  // statistical hygiene
  warmupBars: number;
  rangeLookbackBars: number; // trailing dealing-range window
  smtWindowBars: number; // SMT must be this recent to count (spec #14)
}

export const DEFAULT_CONFIG: EngineConfig = {
  maxSweepAgeBars: 8,
  maxStructureAgeBars: 12,
  orderExpiryBars: 12,

  sweepQualityMin: 0.45,
  displacementQualityMin: 0.55,
  zoneQualityMin: 0.45,
  requireHtfBias: true,
  requireDiscountPremium: true,

  minRR: 2.0,
  minStopAtrMult: 0.15,
  maxStopAtrMult: 2.5,
  maxStopPctOfPrice: 0.02,

  tierAPlus: 90,
  tierA: 80,
  tierB: 70,

  sessions: ["london", "ny-am", "ny-pm"],

  blockedVolRegimes: ["EXTREME"],
  rangeRegimeMinScore: 80,

  minBarsBetweenSignals: 12,
  oneTradePerSweep: true,
  sameZoneCooldown: true,

  beMode: "tp1",
  beTriggerR: 1.0,
  partialShares: [0.5, 0.25, 0.25],
  maxHoldBars: 96,

  ambiguity: "pessimistic",
  randomSeed: 42,
  costs: { XAUUSD: { spread: 0.3, slippagePerSide: 0.05, commissionPctPerSide: 0.00001 }, XAGUSD: { spread: 0.03, slippagePerSide: 0.01, commissionPctPerSide: 0.00001 } },
  riskMoney: 100,

  warmupBars: 60,
  rangeLookbackBars: 96,
  smtWindowBars: 20,
};

export function tierFor(score: number, cfg: EngineConfig): Tier {
  if (score >= cfg.tierAPlus) return "A+";
  if (score >= cfg.tierA) return "A";
  if (score >= cfg.tierB) return "B";
  return "NO_TRADE";
}

// ---------------------------------------------------------------------------
// Precomputed causal context for one symbol/interval series
// ---------------------------------------------------------------------------

export interface TrailingRange {
  high: number;
  low: number;
  equilibrium: number;
}

export interface SeriesContext {
  symbol: SymbolKey;
  interval: IntervalKey;
  candles: Candle[];
  intervalSec: number;
  atrS: number[];
  volRegimes: VolatilityRegime[];
  regime: RegimeSeries;
  structureEvents: StructureEvent[];
  trendAt: (i: number) => Trend;
  biasAt: (i: number) => Trend;
  zones: Zone[];
  zoneMitigatedAt: Map<string, number>;
  zoneCreatedIndex: Map<string, number>;
  zoneKind: Map<string, "FVG" | "OB">;
  swingLadder: Swing[];
  sweeps: LiquiditySweep[];
  pools: LiquidityPool[];
  smtBullishAt: (i: number) => boolean;
  smtBearishAt: (i: number) => boolean;
  rangeAt: (i: number) => TrailingRange;
  funnel: FunnelCounters;
}

/** Detect FVG creation completion index (3-candle pattern completes at start+2). */
function fvgCreatedIndex(z: Zone): number {
  return z.startIndex + 2;
}
/** OB is "created" when the displacement candle after it closes (start+1). */
function obCreatedIndex(z: Zone): number {
  return z.startIndex + 1;
}

/** Build every causal series the setup builder needs (pure — no I/O). */
export function buildSeriesContext(
  symbol: SymbolKey,
  interval: IntervalKey,
  candles: Candle[],
  smtEvents: { index: number; type: "BULLISH" | "BEARISH" }[] = []
): SeriesContext {
  const intervalSec = intervalSeconds(interval);
  const atrS = atrSeries(candles, 14);
  const volRegimes = volRegimeSeries(candles, atrS, 200);
  const walk = structureWalkSeries(candles, 2);
  const regime = marketRegimeSeries(candles, walk.events, atrS, 60);
  const { biasAt } = htfBiasSeries(candles, intervalSec, htfSecondsFor(intervalSec), 2);

  // zones (with global mitigation markers consumed causally by index)
  const fvgZones = detectFvg(candles, 100000, true);
  const medianAtr = [...atrS].sort((a, b) => a - b)[Math.floor(atrS.length / 2)] || 1;
  const obZones = detectOrderBlocks(candles, medianAtr, 1.4, 100000, true);
  const zones = [...fvgZones, ...obZones];
  const zoneMitigatedAt = new Map<string, number>();
  const zoneCreatedIndex = new Map<string, number>();
  const zoneKind = new Map<string, "FVG" | "OB">();
  for (const z of zones) {
    const isFvg = z.id.startsWith("fvg");
    zoneKind.set(z.id, isFvg ? "FVG" : "OB");
    zoneCreatedIndex.set(z.id, isFvg ? fvgCreatedIndex(z) : obCreatedIndex(z));
    const mid = (z.top + z.bottom) / 2;
    for (let i = z.startIndex + (isFvg ? 3 : 2); i < candles.length; i++) {
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

  const sweeps = detectSweeps(candles, 2, 100000);
  const pools = detectLiquidityPools(candles, 2, 0.0006, 100000);
  // precomputed lookback-3 swings for the structural target ladder
  const swingLadder = findSwings(candles, 3);

  // SMT lookup: any divergence of the type within the recent window
  const smtEventsSorted = [...smtEvents].sort((a, b) => a.index - b.index);
  const smtBullishAt = (i: number) => smtEventsSorted.some((e) => e.type === "BULLISH" && e.index <= i && i - e.index <= DEFAULT_CONFIG.smtWindowBars);
  const smtBearishAt = (i: number) => smtEventsSorted.some((e) => e.type === "BEARISH" && e.index <= i && i - e.index <= DEFAULT_CONFIG.smtWindowBars);

  // trailing dealing range (incremental window max/min)
  const win = DEFAULT_CONFIG.rangeLookbackBars;
  const rangeAt = (i: number): TrailingRange => {
    const start = Math.max(0, i - win + 1);
    let hi = -Infinity;
    let lo = Infinity;
    for (let k = start; k <= i; k++) {
      if (candles[k].high > hi) hi = candles[k].high;
      if (candles[k].low < lo) lo = candles[k].low;
    }
    return { high: hi, low: lo, equilibrium: (hi + lo) / 2 };
  };

  const funnel: FunnelCounters = {
    barsEvaluated: 0, htfBiasOk: 0, premiumDiscountOk: 0, sweepFound: 0, sweepQualityOk: 0,
    displacementOk: 0, structureOk: 0, zoneFound: 0, zoneQualityOk: 0, rrOk: 0, scoreOk: 0,
    sessionOk: 0, regimeOk: 0, cooldownOk: 0, ordersPlaced: 0, ordersFilled: 0,
    ordersExpired: 0, tradesClosed: 0,
  };

  return {
    symbol, interval, candles, intervalSec, atrS, volRegimes, regime,
    structureEvents: walk.events, trendAt: walk.trendAt, biasAt,
    zones, zoneMitigatedAt, zoneCreatedIndex, zoneKind,
    sweeps, pools, smtBullishAt, smtBearishAt, rangeAt, funnel, swingLadder,
  };
}

// ---------------------------------------------------------------------------
// Orchestration state passed to the builder by the backtester
// ---------------------------------------------------------------------------

export interface CooldownState {
  usedSweepKeys: Set<string>;
  blacklistedZones: Set<string>;
  lastSignalIndex: number; // last order PLACED index
}

// ---------------------------------------------------------------------------
// The setup builder
// ---------------------------------------------------------------------------

export interface BuildResult {
  setup: Setup | null;
  /** rejection tags even when a partial sequence existed (diagnostics #23) */
  rejection: string | null;
}

export function buildSetupAt(
  ctx: SeriesContext,
  i: number,
  cfg: EngineConfig,
  cooldown: CooldownState
): BuildResult {
  const { candles, funnel } = ctx;
  funnel.barsEvaluated++;
  const c = candles[i];
  const atrI = ctx.atrS[i];
  if (atrI <= 0) return { setup: null, rejection: null };

  // -- side from causal HTF bias ------------------------------------------
  const bias = ctx.biasAt(i);
  const side: Side | null =
    bias === "BULLISH" ? "LONG" : bias === "BEARISH" ? "SHORT" : null;
  if (!side || cfg.requireHtfBias) {
    if (!side) return { setup: null, rejection: "htf-bias-unclear" };
  }
  if (side && cfg.requireHtfBias) funnel.htfBiasOk++;

  // -- regime gates (spec #15, #16) ---------------------------------------
  const vol = ctx.volRegimes[i];
  const mkt = ctx.regime.regimeAt(i);
  if (!side) return { setup: null, rejection: null };
  if (cfg.blockedVolRegimes.includes(vol)) return { setup: null, rejection: `vol-${vol.toLowerCase()}` };
  if (mkt === "UNCLEAR") return { setup: null, rejection: "regime-unclear" };
  funnel.regimeOk++;

  // -- session gate (spec #13) --------------------------------------------
  const session = sessionKeyAt(c.time);
  if (cfg.sessions.length > 0 && !cfg.sessions.includes(session)) {
    return { setup: null, rejection: "off-session" };
  }
  funnel.sessionOk++;

  const dir = side === "LONG" ? 1 : -1;
  const wantBullish = side === "LONG";

  // -- 1. anchor liquidity sweep with rejection (spec #9) ------------------
  const sweep = [...ctx.sweeps]
    .reverse()
    .find(
      (s) =>
        s.index < i &&
        i - s.index <= cfg.maxSweepAgeBars &&
        (wantBullish ? s.side === "SELL_SIDE" : s.side === "BUY_SIDE")
    );
  if (!sweep) return { setup: null, rejection: "no-recent-sweep" };
  funnel.sweepFound++;
  const sweepAtr = ctx.atrS[sweep.index] || atrI;
  const sweepAssessment = classifySweep(candles, sweep, sweepAtr);
  if (sweepAssessment.cls !== "SWEEP_REJECTION" || sweepAssessment.quality < cfg.sweepQualityMin) {
    return { setup: null, rejection: "weak-sweep" };
  }
  if (cfg.oneTradePerSweep && cooldown.usedSweepKeys.has(`${sweep.index}:${sweep.level}`)) {
    return { setup: null, rejection: "sweep-already-traded" };
  }
  funnel.sweepQualityOk++;

  // -- 2. MSS/BOS confirmation caused by the sweep (spec #6) ---------------
  const structureEvent = ctx.structureEvents.find(
    (e) =>
      e.index > sweep.index &&
      e.index <= i &&
      i - e.index <= cfg.maxStructureAgeBars &&
      e.direction === (wantBullish ? "BULLISH" : "BEARISH")
  );
  if (!structureEvent) return { setup: null, rejection: "no-structure-confirmation" };
  funnel.structureOk++;

  // -- 3. displacement between sweep and structure break (spec #8) ---------
  const dispIndex = findDisplacementCandle(candles, sweep.index + 1, structureEvent.index, wantBullish ? "BULLISH" : "BEARISH");
  if (dispIndex === null) return { setup: null, rejection: "no-displacement" };
  // provisional FVG/structure flags for scoring (zone check refines below)
  const dispAssessment = assessDisplacement({
    candles,
    index: dispIndex,
    direction: wantBullish ? "BULLISH" : "BEARISH",
    atr: ctx.atrS[dispIndex] || atrI,
    createdFvg: true, // refined by zone selection; a zone in the window is required anyway
    brokeStructure: true,
  });
  if (dispAssessment.quality < cfg.displacementQualityMin) {
    return { setup: null, rejection: "weak-displacement" };
  }
  funnel.displacementOk++;

  // -- 4. fresh FVG/OB created by the displacement leg (spec #10, #11) -----
  const candidates = ctx.zones.filter((z) => {
    if (z.direction !== (wantBullish ? "BULLISH" : "BEARISH")) return false;
    const created = ctx.zoneCreatedIndex.get(z.id) ?? z.startIndex;
    // the entry zone must be created BY this sequence: after the sweep and
    // within a few bars of the MSS/BOS (the displacement leg that caused it)
    if (created <= sweep.index || created > Math.min(i, structureEvent.index + 3)) return false;
    const mit = ctx.zoneMitigatedAt.get(z.id);
    if (mit !== undefined && mit <= i) return false;
    // order must rest beyond price: long → zone below close, short → above
    if (wantBullish && z.top >= c.close) return false;
    if (!wantBullish && z.bottom <= c.close) return false;
    // zone must be sane relative to the sweep extreme
    if (wantBullish && z.bottom < sweep.extreme - 0.75 * atrI) return false;
    if (!wantBullish && z.top > sweep.extreme + 0.75 * atrI) return false;
    if (cfg.sameZoneCooldown && cooldown.blacklistedZones.has(z.id)) return false;
    return true;
  });
  if (candidates.length === 0) return { setup: null, rejection: "no-entry-zone" };
  funnel.zoneFound++;

  // pick best zone by quality
  const range = ctx.rangeAt(i);
  let best: { zone: Zone; quality: number; qnotes: string[] } | null = null;
  for (const z of candidates) {
    const isFvg = ctx.zoneKind.get(z.id) === "FVG";
    const mid = (z.top + z.bottom) / 2;
    const inCorrectHalf = wantBullish ? mid < range.equilibrium : mid > range.equilibrium;
    const q = isFvg
      ? fvgQuality({
          candles, zone: z, atr: atrI, currentIndex: i,
          sweepIndex: sweep.index, mssIndex: structureEvent.index,
          displacementIndex: dispIndex, inCorrectRangeHalf: inCorrectHalf,
          htfAligned: wantBullish ? bias === "BULLISH" : bias === "BEARISH",
        })
      : obQuality({
          candles, zone: z, atr: atrI, currentIndex: i,
          sweepIndex: sweep.index, mssIndex: structureEvent.index,
          inCorrectRangeHalf: inCorrectHalf,
        });
    if (!best || q.score > best.quality) best = { zone: z, quality: q.score, qnotes: q.notes };
  }
  if (!best || best.quality < cfg.zoneQualityMin) {
    return { setup: null, rejection: "weak-zone" };
  }
  funnel.zoneQualityOk++;

  const zone = best.zone;
  const isFvg = ctx.zoneKind.get(zone.id) === "FVG";
  const zoneMid = (zone.top + zone.bottom) / 2;

  // -- 5. premium/discount within the sweep LEG dealing range (spec #12) ----
  // The relevant dealing range for a retracement entry is the leg produced by
  // the sequence itself: sweep extreme → post-displacement extreme. A
  // retracement into the lower half of THAT leg is a discount (longs), upper
  // half premium (shorts). A fixed lookback window would label every
  // pullback "premium" in a trending market and block all continuation
  // trades — the classic misuse of premium/discount.
  let legExtreme = wantBullish ? -Infinity : Infinity;
  for (let k = sweep.index; k <= i; k++) {
    if (wantBullish) legExtreme = Math.max(legExtreme, candles[k].high);
    else legExtreme = Math.min(legExtreme, candles[k].low);
  }
  const legLow = wantBullish ? sweep.extreme : legExtreme;
  const legHigh = wantBullish ? legExtreme : sweep.extreme;
  const legEq = (legHigh + legLow) / 2;
  const depth = wantBullish
    ? (legEq - zoneMid) / Math.max(1e-9, legEq - legLow)
    : (zoneMid - legEq) / Math.max(1e-9, legHigh - legEq);
  const depth01 = Math.max(0, Math.min(1, depth));
  if (cfg.requireDiscountPremium && !(
    wantBullish ? zoneMid < legEq : zoneMid > legEq
  )) {
    return { setup: null, rejection: "wrong-range-half" };
  }
  funnel.premiumDiscountOk++;

  // -- 6. entry / structural stop (spec #4) --------------------------------
  const entry = wantBullish ? zone.top : zone.bottom; // proximal edge
  const buffer = 0.1 * atrI;
  const protectedExtreme = sweep.extreme;
  const initialStop = wantBullish
    ? Math.min(zone.bottom, protectedExtreme) - buffer
    : Math.max(zone.top, protectedExtreme) + buffer;
  const riskPerUnit = Math.abs(entry - initialStop);
  if (riskPerUnit < cfg.minStopAtrMult * atrI) return { setup: null, rejection: "stop-too-tight" };
  if (riskPerUnit > cfg.maxStopAtrMult * atrI) return { setup: null, rejection: "stop-too-wide" };
  if (riskPerUnit / entry > cfg.maxStopPctOfPrice) return { setup: null, rejection: "stop-too-wide" };

  // -- 7. structural target ladder + minimum RR gate (spec #4, #5) ---------
  const prev = prevExtremes(candles, i, ctx.intervalSec);
  const ladder = buildTargetLadder({
    candles, index: i, side, entry, riskPerUnit,
    pools: ctx.pools, rangeHigh: range.high, rangeLow: range.low,
    prev, clusterAtr: atrI, swings: ctx.swingLadder,
  });
  if (ladder.length === 0) return { setup: null, rejection: "no-structural-target" };
  const rrToFinal = Math.abs(ladder[ladder.length - 1].price - entry) / riskPerUnit;
  const rrToTp1 = Math.abs(ladder[0].price - entry) / riskPerUnit;
  if (rrToFinal < cfg.minRR) return { setup: null, rejection: "insufficient-rr" };
  funnel.rrOk++;

  // -- 8. SMT confirmation (optional, spec #14) ----------------------------
  const smtAligned = wantBullish ? ctx.smtBullishAt(i) : ctx.smtBearishAt(i);

  // -- 9. categorized scoring (spec #18, anti-double-count caps) -----------
  const sweepAge = i - sweep.index;
  const scores = scoreSetup({
    cfg, side, bias, depth01,
    sweepAssessment, sweepAge,
    structureType: structureEvent.type,
    dispQuality: dispAssessment.quality,
    zoneKind: isFvg ? "FVG" : "OB",
    zoneQuality: best.quality,
    zoneFresh: isZoneFresh(ctx, zone, i),
    inKillzone: session !== "off-session",
    sweepInKillzone: sessionKeyAt(sweep.time) !== "off-session",
    smtAligned,
    rrToFinal,
    stopStructural: wantBullish
      ? initialStop <= Math.min(zone.bottom, sweep.extreme)
      : initialStop >= Math.max(zone.top, sweep.extreme),
    targetStructural: ladder.some((t) => t.weight >= 0.7),
    mktRegime: mkt,
  });
  const totalScore = scores.context + scores.liquidity + scores.structure + scores.entry + scores.confirmation + scores.risk;
  let tier = tierFor(totalScore, cfg);
  if (mkt === "RANGE" && totalScore < cfg.rangeRegimeMinScore) {
    tier = "NO_TRADE";
  }
  if (tier !== "NO_TRADE") funnel.scoreOk++;

  // -- assemble ------------------------------------------------------------
  const events: SetupEvent[] = [
    { kind: "HTF_BIAS", index: i, time: c.time, detail: `HTF bias ${bias}` },
    { kind: "LIQUIDITY_SWEEP", index: sweep.index, time: sweep.time, detail: `${sweep.side === "SELL_SIDE" ? "Sellside" : "Buyside"} sweep @ ${sweep.level.toFixed(2)} (${sweepAssessment.cls}, q=${sweepAssessment.quality.toFixed(2)})` },
    { kind: "DISPLACEMENT", index: dispIndex, time: candles[dispIndex].time, detail: `displacement q=${dispAssessment.quality.toFixed(2)} (${dispAssessment.rangeAtrMult}x ATR, body ${(dispAssessment.bodyRatio * 100).toFixed(0)}%)` },
    { kind: structureEvent.type === "MSS" ? "MSS" : "BOS", index: structureEvent.index, time: structureEvent.time, detail: `${structureEvent.type} ${structureEvent.direction} @ ${structureEvent.level.toFixed(2)}` },
    { kind: "ZONE_CREATED", index: ctx.zoneCreatedIndex.get(zone.id) ?? zone.startIndex, time: candles[ctx.zoneCreatedIndex.get(zone.id) ?? zone.startIndex].time, detail: `${isFvg ? "FVG" : "OB"} ${zone.direction} [${zone.bottom.toFixed(2)}–${zone.top.toFixed(2)}] q=${best.quality.toFixed(2)}` },
    { kind: "PREMIUM_DISCOUNT", index: i, time: c.time, detail: `zone in ${wantBullish ? "discount" : "premium"} (depth ${(depth01 * 100).toFixed(0)}%)` },
    { kind: "ENTRY_RETRACE", index: i, time: c.time, detail: `limit @ ${entry.toFixed(2)} (proximal edge)` },
  ];

  const rationale = [
    `Sequence verified: sweep → displacement → ${structureEvent.type} → ${isFvg ? "FVG" : "OB"} → retracement.`,
    ...best.qnotes.map((n) => `Zone: ${n}`),
    ...(smtAligned ? ["XAU/XAG SMT divergence confirms."] : []),
  ];
  const rejections = tier === "NO_TRADE" ? [`score ${totalScore} below ${cfg.tierB} threshold`] : [];

  const setup: Setup = {
    side,
    decidedIndex: i,
    decidedTime: c.time,
    entry,
    initialStop,
    riskPerUnit,
    events,
    zone: {
      id: zone.id, kind: isFvg ? "FVG" : "OB", direction: zone.direction,
      top: zone.top, bottom: zone.bottom,
      createdIndex: ctx.zoneCreatedIndex.get(zone.id) ?? zone.startIndex,
      quality: best.quality, notes: best.qnotes,
    },
    targets: ladder.map((t: StructuralTarget) => ({
      price: t.price, source: t.source,
      rr: Math.round((Math.abs(t.price - entry) / riskPerUnit) * 100) / 100,
    })),
    rrToFinal: Math.round(rrToFinal * 100) / 100,
    rrToTp1: Math.round(rrToTp1 * 100) / 100,
    scores,
    totalScore,
    tier,
    session,
    htfBias: bias,
    volRegime: vol,
    mktRegime: mkt,
    smtAligned,
    sweepKey: `${sweep.index}:${sweep.level}`,
    rationale,
    rejections,
  };

  return { setup, rejection: tier === "NO_TRADE" ? "below-tier" : null };
}

function isZoneFresh(ctx: SeriesContext, zone: Zone, i: number): boolean {
  const { candles } = ctx;
  const start = zone.startIndex + (ctx.zoneKind.get(zone.id) === "FVG" ? 3 : 2);
  for (let k = start; k <= i; k++) {
    const c = candles[k];
    if (zone.direction === "BULLISH" && c.low <= zone.top) return false;
    if (zone.direction === "BEARISH" && c.high >= zone.bottom) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Scoring model (spec #18) — six capped categories
// ---------------------------------------------------------------------------

export function scoreSetup(args: {
  cfg: EngineConfig;
  side: Side;
  bias: Trend;
  depth01: number;
  sweepAssessment: SweepAssessment;
  sweepAge: number;
  structureType: "BOS" | "MSS";
  dispQuality: number;
  zoneKind: "FVG" | "OB";
  zoneQuality: number;
  zoneFresh: boolean;
  inKillzone: boolean;
  sweepInKillzone: boolean;
  smtAligned: boolean;
  rrToFinal: number;
  stopStructural: boolean;
  targetStructural: boolean;
  mktRegime: MarketRegime;
}): CategoryScores {
  const {
    depth01, sweepAssessment, sweepAge, structureType, dispQuality,
    zoneKind, zoneQuality, zoneFresh, inKillzone, sweepInKillzone,
    smtAligned, rrToFinal, stopStructural, targetStructural, cfg,
  } = args;

  // CONTEXT (cap 20): HTF bias is a hard gate (all survivors aligned) → 12;
  // dealing-range depth of the entry zone → up to 8
  const context = 12 + Math.round(4 + depth01 * 4);

  // LIQUIDITY (cap 20): sweep quality ≤12, recency ≤4, meaningful level ≤4
  const recency = Math.max(0, 1 - sweepAge / cfg.maxSweepAgeBars);
  const liquidity = Math.min(
    20,
    Math.round(sweepAssessment.quality * 12 + recency * 4 + (sweepAssessment.closeBackRatio >= 0.7 ? 4 : 2))
  );

  // STRUCTURE (cap 20): MSS 12 / BOS 8, displacement quality ≤8
  const structure = Math.min(20, (structureType === "MSS" ? 12 : 8) + Math.round(dispQuality * 8));

  // ENTRY (cap 20): zone kind ≤10 (FVG 8 / OB 6 / both +2 handled by quality),
  // zone quality ≤4, freshness ≤4, size sanity folded into quality.
  // The displacement-creation bonus lives in STRUCTURE only — no double count.
  const entry = Math.min(
    20,
    Math.round((zoneKind === "FVG" ? 8 : 6) + zoneQuality * 4 + (zoneFresh ? 4 : 2) + (zoneQuality >= 0.8 ? 4 : 2))
  );

  // CONFIRMATION (cap 10): SMT ≤5, kill zone ≤3, sweep inside KZ ≤2
  const confirmation =
    (smtAligned ? 5 : 0) + (inKillzone ? 3 : 0) + (sweepInKillzone ? 2 : 0);

  // RISK (cap 10): structural stop ≤4, structural target ≤4, RR ≥3 bonus ≤2
  const risk =
    (stopStructural ? 4 : 2) + (targetStructural ? 4 : 2) + (rrToFinal >= 3 ? 2 : rrToFinal >= cfg.minRR ? 1 : 0);

  return {
    context: Math.min(20, context),
    liquidity: Math.min(20, liquidity),
    structure: Math.min(20, structure),
    entry: Math.min(20, entry),
    confirmation: Math.min(10, confirmation),
    risk: Math.min(10, risk),
  };
}

export type { AuditLine };
