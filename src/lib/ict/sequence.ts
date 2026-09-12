// Model-aware ICT setup builder (spec §5, §6) — the core of engine v3.
//
// INSTEAD of one giant mandatory rule chain, this builder implements the
// spec's confluence hierarchy:
//
//   CORE (required by every model):
//     HTF context + liquidity event* + MSS/CHOCH (structure break) +
//     displacement + entry zone + structural SL + valid target
//     (*Model B — FVG continuation — trades WITH the trend off a BOS and
//      needs no sweep; "liquidity event" is satisfied by the BOS leg.)
//
//   OPTIONAL (score confluence only, never hard gates by default):
//     SMT, kill zone, FVG+OB overlap, premium/discount, session liquidity
//
// SETUP MODELS (spec §6):
//   A — Liquidity Sweep Reversal : HTF → sweep → MSS → displacement → FVG
//   B — FVG Continuation         : HTF → displacement → BOS → FVG retrace
//   C — Order Block Reversal     : HTF → sweep → MSS → displacement → OB
//   D — FVG + OB Confluence      : sweep → MSS → displacement → overlap
//   E — SMT Reversal             : SMT → sweep → MSS → displacement → FVG/OB
//
// Every rejected opportunity records its PRIMARY RejectionCode (spec §2) and
// every candidate carries a full ConfluenceTrace (spec §3). The module is
// PURE (no I/O) so live signals, backtests and the validation suite execute
// identical logic.
import type {
  AmbiguityModel,
  AuditLine,
  BreakevenMode,
  Candle,
  CategoryScores,
  ConfluenceItem,
  ConfluenceTrace,
  CostModel,
  FunnelCounters,
  LiquidityPool,
  LiquiditySweep,
  MarketRegime,
  ModelKey,
  RejectedSetupSample,
  RejectionCode,
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
import { detectFvg, detectOrderBlocks, obInvalidated, firstMitigationIndex, priceTrees, type ObInvalidation } from "./zones";
import { roundTripCostR, DEFAULT_COSTS } from "./costs";
import { structureWalkSeries } from "./structure";
import { atrSeries, volRegimeSeries } from "./volatility";
import { marketRegimeSeries, type RegimeSeries } from "./regime";
import { htfBiasSeries, htfSecondsFor } from "./htf";
import { assessDisplacement, findDisplacementCandle } from "./displacement";
import { classifySweep, type SweepAssessment } from "./sweepquality";
import { fvgQuality, obQuality } from "./zonequality";
import { buildTargetLadder, prevExtremes, selectTradeTargets, type StructuralTarget } from "./targets";
import { sessionKeyAt, SESSION_LABELS } from "./sessions";
import { mulberry32 } from "./rng";
import type { IntervalKey, SymbolKey } from "@/lib/market/types";
import { intervalSeconds } from "@/lib/market/types";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type Strictness = "conservative" | "balanced" | "aggressive";

export interface EngineConfig {
  // sequence / recency (spec #6, #7)
  maxSweepAgeBars: number; // anchor sweep must be at most this old
  maxStructureAgeBars: number; // MSS/BOS must occur within this many bars
  orderExpiryBars: number; // pending limit order lifetime
  // quality gates (spec #8–#12)
  sweepQualityMin: number; // 0..1
  /** balanced/aggressive: also accept SWEEP_NO_CONFIRM at this quality (§16) */
  allowUnconfirmedSweep: boolean;
  displacementQualityMin: number; // 0..1
  zoneQualityMin: number; // 0..1
  requireHtfBias: boolean; // LONG needs HTF bullish, SHORT bearish
  /** OPTIONAL confluence (spec §5) — score bonus, not a gate, by default */
  requireDiscountPremium: boolean;
  /** Kill zone as a hard gate — default OFF (§5); sessions filter below still applies */
  requireKillzone: boolean;
  /** Aggressive (§16): Model A/C/D skipped when no sweep — Model B carries trends */
  requireSweep: boolean;

  // models (spec §6)
  models: ModelKey[];

  // risk (spec #4, #5)
  minRR: number; // at least one structural target must be this far
  minStopAtrMult: number;
  maxStopAtrMult: number;
  maxStopPctOfPrice: number;

  // tiers (spec #30) — score is a strategy-quality score, NOT a probability
  tierAPlus: number;
  tierA: number;
  tierB: number; // below → NO_TRADE

  // sessions (spec §10) — session keys allowed to trade; [] = any
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
  /** reject setups whose round-trip cost exceeds this share of 1R (0 = off) */
  maxCostPctOfR: number;
  /** limit placed at the zone proximal edge (ICT default) or zone midpoint */
  entryAnchor: "edge" | "midpoint";
  /** fill the limit when price comes within this many R of it (0 = strict touch) */
  entryToleranceR: number;
  /** execution ladder ignores structural levels farther than this many R */
  targetHorizonR: number;
  /** when a tapped order block stops being tradable (default: close through midpoint) */
  obInvalidation: ObInvalidation;
  /** OB creation threshold: displacement-candle body must exceed factor × per-bar ATR
   *  (default 1.2). Lower values create more blocks — the compare dimension
   *  "obDisplacement" scans the creation side, since diagnostics showed invalidation
   *  rules do NOT change trade sets and creation scarcity is upstream. */
  obDisplacementFactor: number;

  // statistical hygiene
  warmupBars: number;
  rangeLookbackBars: number; // trailing dealing-range window
  smtWindowBars: number; // SMT must be this recent to count (spec #14)
}

/** Strictness presets (spec §16). Compared objectively — never auto-picked. */
export const STRICTNESS_PRESETS: Record<Strictness, string> = {
  conservative: "HTF + sweep (strict rejection) + MSS + displacement + FVG/OB + P/D + RR≥2R",
  balanced: "HTF + sweep-or-liquidity-event + MSS + displacement + FVG/OB + RR (P/D, KZ optional)",
  aggressive: "HTF + MSS + displacement + FVG/OB (sweep optional via Model B, loosest quality floors)",
};

const MODEL_ORDER: ModelKey[] = ["A_SWEEP_REVERSAL", "B_FVG_CONTINUATION", "C_OB_REVERSAL", "D_FVG_OB_CONFLUENCE", "E_SMT_REVERSAL"];

export const DEFAULT_CONFIG: EngineConfig = {
  maxSweepAgeBars: 8,
  maxStructureAgeBars: 14,
  // 30 bars: round-2 sweep-verified on XAUUSD 15m (480k candles, 25k window)
  // — part of the E30+P40+T15+H12 champion: 91 trades @ 80.2% WR / +20.70R net
  // / PF 17.43 / maxDD 0.26R, and it IMPROVES both unseen walk-forward windows
  // (W2 +3.10R vs +0.42R, W3 +1.82R vs −3.11R). Round 1 shipped 24; round 2
  // found 30 still adds late fills that win. Longer validity only helps when
  // fills arrive late AND still win — re-verify per symbol.
  orderExpiryBars: 30,

  sweepQualityMin: 0.35,
  allowUnconfirmedSweep: true,
  displacementQualityMin: 0.45,
  zoneQualityMin: 0.4,
  requireHtfBias: true,
  requireDiscountPremium: false, // OPTIONAL confluence (spec §5)
  requireKillzone: false, // OPTIONAL confluence (spec §5)
  requireSweep: false, // Model B trades without a sweep (spec §6)

  models: ["A_SWEEP_REVERSAL", "B_FVG_CONTINUATION", "C_OB_REVERSAL", "D_FVG_OB_CONFLUENCE"],

  minRR: 2.0,
  minStopAtrMult: 0.15,
  maxStopAtrMult: 2.5,
  maxStopPctOfPrice: 0.02,

  tierAPlus: 90,
  tierA: 80,
  tierB: 70,

  sessions: [], // all sessions; kill zone is a score confluence (§5)

  blockedVolRegimes: ["EXTREME"],
  rangeRegimeMinScore: 80,

  minBarsBetweenSignals: 12,
  oneTradePerSweep: true,
  sameZoneCooldown: true,

  beMode: "tp1",
  beTriggerR: 1.0,
  // 40/30/30: round-2 sweep winner (with expiry 30 + tolerance 0.15 + horizon
  // 12). Taking less off at TP1 leaves more on the runners: WR rose to 80.2%
  // AND net nearly doubled (+20.70R vs +11.09R at 50/25/25) — the TP2/TP3
  // legs carry the edge, so the ladder was the bottleneck, not the entries.
  partialShares: [0.4, 0.3, 0.3],
  maxHoldBars: 96,

  ambiguity: "pessimistic",
  randomSeed: 42,
  costs: { XAUUSD: { spread: 0.3, slippagePerSide: 0.05, commissionPctPerSide: 0.00001 }, XAGUSD: { spread: 0.03, slippagePerSide: 0.01, commissionPctPerSide: 0.00001 } },
  riskMoney: 100,
  // execution-cost awareness: on XAUUSD 15m a fixed ~$0.42 round trip is
  // ~44% of gross edge when structural stops are tight — the gate rejects
  // setups where costs would eat more than 35% of the risked R.
  maxCostPctOfR: 0.35,
  entryAnchor: "edge",
  // 0.15R marketable last-look: a candle approaching within 0.15R of the edge
  // limit fills. Round-2 sweep (Task 20): 0.15 beats 0.05 on the real XAU 15m
  // file at MORE trades (88-91 vs 79) AND higher WR — the extra fills are
  // near-miss winners, not junk. Every tolerance fill is counted
  // (orderFlow.toleranceFills) and flagged on the trade (trade.toleranceFill);
  // compare → entry quantifies the assumption; walk-forward W2/W3 confirm it
  // generalizes beyond the selection window.
  entryToleranceR: 0.15,
  // 12R: execution-ladder reach — structural targets farther than this are
  // ignored when building TP2/TP3. Round-2 sweep: 12R beats 8R (+12.09R vs
  // +11.09R alone; part of the champion combo). Wider reach only matters when
  // the ladder keeps 30%+ on the runners (see partialShares above).
  targetHorizonR: 12,
  obInvalidation: "close-mid",
  obDisplacementFactor: 1.2,

  warmupBars: 60,
  rangeLookbackBars: 96,
  smtWindowBars: 20,
};

export const CONSERVATIVE_CONFIG: Partial<EngineConfig> = {
  sweepQualityMin: 0.45,
  allowUnconfirmedSweep: false,
  displacementQualityMin: 0.55,
  zoneQualityMin: 0.45,
  requireDiscountPremium: true,
  models: ["A_SWEEP_REVERSAL", "C_OB_REVERSAL", "D_FVG_OB_CONFLUENCE"],
  maxStructureAgeBars: 12,
};

export const BALANCED_CONFIG: Partial<EngineConfig> = { ...DEFAULT_CONFIG };

export const AGGRESSIVE_CONFIG: Partial<EngineConfig> = {
  sweepQualityMin: 0.3,
  allowUnconfirmedSweep: true,
  displacementQualityMin: 0.4,
  zoneQualityMin: 0.35,
  requireDiscountPremium: false,
  maxStructureAgeBars: 16,
};

export function presetFor(strictness: Strictness): Partial<EngineConfig> {
  if (strictness === "conservative") return CONSERVATIVE_CONFIG;
  if (strictness === "aggressive") return AGGRESSIVE_CONFIG;
  return BALANCED_CONFIG;
}

export function tierFor(score: number, cfg: EngineConfig): Tier {
  if (score >= cfg.tierAPlus) return "A+";
  if (score >= cfg.tierA) return "A";
  if (score >= cfg.tierB) return "B";
  return "NO_TRADE";
}

// ---------------------------------------------------------------------------
// Diagnostics sink (spec §1, §2, §9, §10, §19)
// ---------------------------------------------------------------------------

export interface RrDiagAccum {
  evaluated: number;
  withTargets: number;
  ge15: number;
  ge20: number;
  ge25: number;
  ge30: number;
  values: number[]; // capped sample of max available RR
  tp1Values: number[]; // capped sample of RR to the nearest level
  tp3Values: number[]; // capped sample of RR to the farthest in-horizon level
  targetsCappedAccum: number; // levels excluded by the horizon cap
}

export interface DiagSink {
  // market-state funnel (per bar)
  bars: number;
  biasBars: number;
  contextBars: number;
  rangeBars: number;
  poolBars: number;
  kzBars: number;
  sweepBars: number;
  structureBars: number;
  // opportunity funnel (per model evaluation)
  candidates: number;
  sweepsFound: number;
  sweepsQuality: number;
  structuresFound: number;
  displacements: number;
  fvgSeen: number;
  obSeen: number;
  zonesValid: number;
  pdOk: number;
  stopValid: number;
  costRejected: number;
  targetsValid: number;
  rrOk: number;
  smtOk: number;
  kzOk: number;
  validSetups: number;
  // order-block creation pipeline (Model C/D diagnosis)
  obZonesCreated: number;
  obZonesInvalidated: number;
  obWindowSeen: number;
  obSkipMitigated: number;
  obSkipPosition: number;
  obSkipSweepExtreme: number;
  obSkipBlacklist: number;
  // rejection accounting
  rejections: Map<RejectionCode, number>;
  primary: Map<RejectionCode, number>;
  byModel: Map<ModelKey, { opportunities: number; valid: number; rejections: Map<RejectionCode, number> }>;
  setupsBySession: Map<string, number>;
  rrDiag: RrDiagAccum;
  // rejected-opportunity samples (spec §19)
  samples: RejectedSetupSample[];
  sampleCounter: number;
}

function newDiagSink(): DiagSink {
  return {
    bars: 0, biasBars: 0, contextBars: 0, rangeBars: 0, poolBars: 0, kzBars: 0,
    sweepBars: 0, structureBars: 0,
    candidates: 0, sweepsFound: 0, sweepsQuality: 0, structuresFound: 0,
    displacements: 0, fvgSeen: 0, obSeen: 0, zonesValid: 0, pdOk: 0,
    stopValid: 0, costRejected: 0, targetsValid: 0, rrOk: 0, smtOk: 0, kzOk: 0, validSetups: 0,
    obZonesCreated: 0, obZonesInvalidated: 0, obWindowSeen: 0,
    obSkipMitigated: 0, obSkipPosition: 0, obSkipSweepExtreme: 0, obSkipBlacklist: 0,
    rejections: new Map(), primary: new Map(), byModel: new Map(),
    setupsBySession: new Map(),
    rrDiag: { evaluated: 0, withTargets: 0, ge15: 0, ge20: 0, ge25: 0, ge30: 0, values: [], tp1Values: [], tp3Values: [], targetsCappedAccum: 0 },
    samples: [],
    sampleCounter: 0,
  };
}

function bump(map: Map<RejectionCode, number>, code: RejectionCode) {
  map.set(code, (map.get(code) ?? 0) + 1);
}

/** Depth rank of a rejection — how far the candidate progressed (higher = deeper). */
export const STAGE_DEPTH: Record<RejectionCode, number> = {
  NO_HTF_BIAS: 0, REGIME_UNCLEAR: 0, VOL_BLOCKED: 0,
  OUTSIDE_SESSION: 1,
  NO_LIQUIDITY_SWEEP: 2, WEAK_SWEEP: 3,
  NO_MSS: 4, WEAK_MSS: 4,
  NO_DISPLACEMENT: 5, WEAK_DISPLACEMENT: 5,
  NO_FVG: 6, NO_ORDER_BLOCK: 6,
  INVALID_FVG: 7, INVALID_ORDER_BLOCK: 7, NO_RETRACEMENT: 7,
  WRONG_PREMIUM_DISCOUNT: 8,
  INVALID_STOP: 9,
  EXCESSIVE_COST: 9,
  NO_STRUCTURAL_TARGET: 10, NO_LIQUIDITY: 10,
  INSUFFICIENT_RR: 11,
  SMT_REQUIRED_BUT_MISSING: 12,
  DUPLICATE_SETUP: 12,
  SCORE_BELOW_TIER: 13, COOLDOWN: 13,
  SETUP_EXPIRED: 14,
};

export const STAGE_LABELS: Record<RejectionCode, string> = {
  NO_HTF_BIAS: "HTF bias", REGIME_UNCLEAR: "Regime", VOL_BLOCKED: "Volatility",
  OUTSIDE_SESSION: "Session",
  NO_LIQUIDITY_SWEEP: "Liquidity sweep", WEAK_SWEEP: "Sweep quality",
  NO_MSS: "MSS/CHOCH", WEAK_MSS: "MSS recency",
  NO_DISPLACEMENT: "Displacement", WEAK_DISPLACEMENT: "Displacement quality",
  NO_FVG: "FVG", NO_ORDER_BLOCK: "Order block",
  INVALID_FVG: "FVG validity", INVALID_ORDER_BLOCK: "OB validity",
  NO_RETRACEMENT: "Retracement",
  WRONG_PREMIUM_DISCOUNT: "Premium/discount",
  INVALID_STOP: "Structural stop",
  EXCESSIVE_COST: "Execution cost gate",
  NO_STRUCTURAL_TARGET: "Structural target", NO_LIQUIDITY: "Liquidity levels",
  INSUFFICIENT_RR: "Minimum RR",
  SMT_REQUIRED_BUT_MISSING: "SMT", DUPLICATE_SETUP: "Dedup",
  SCORE_BELOW_TIER: "Tier score", COOLDOWN: "Cooldown",
  SETUP_EXPIRED: "Order expiry",
};

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
  /** zones sorted by created index — enables O(log n) window scans */
  zoneIndex: { zone: Zone; created: number; isFvg: boolean }[];
  swingLadder: Swing[];
  sweeps: LiquiditySweep[];
  pools: LiquidityPool[];
  /** structure events pre-split by direction, index-ascending — enables O(log n) recency queries */
  structureBull: StructureEvent[];
  structureBear: StructureEvent[];
  /** pools sorted by price — enables O(log n) price-proximity queries */
  poolsByPrice: LiquidityPool[];
  smtBullishAt: (i: number) => boolean;
  smtBearishAt: (i: number) => boolean;
  rangeAt: (i: number) => TrailingRange;
  funnel: FunnelCounters;
  diag: DiagSink;
}

/** Detect FVG creation completion index (3-candle pattern completes at start+2). */
function fvgCreatedIndex(z: Zone): number {
  return z.startIndex + 2;
}
/** OB is "created" when the displacement candle after it closes (start+1). */
function obCreatedIndex(z: Zone): number {
  return z.startIndex + 1;
}

/** Binary search: zones with created index in (from, to] — sorted index. */
function zonesInWindow(
  zoneIndex: { zone: Zone; created: number; isFvg: boolean }[],
  from: number,
  to: number
): { zone: Zone; created: number; isFvg: boolean }[] {
  // find first index with created > from
  let lo = 0;
  let hi = zoneIndex.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (zoneIndex[mid].created <= from) lo = mid + 1;
    else hi = mid;
  }
  const out: { zone: Zone; created: number; isFvg: boolean }[] = [];
  for (let k = lo; k < zoneIndex.length && zoneIndex[k].created <= to; k++) {
    out.push(zoneIndex[k]);
  }
  return out;
}

/** first array position whose index value is ≥ minIdx (binary search) */
function lowerBoundByIndex<T extends { index: number }>(events: T[], minIdx: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].index < minIdx) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * OLDEST structure event with direction-matching side, index in
 * [minIdx, maxIdx] — identical result to `events.find(e => e.index >= minIdx
 * && e.index <= maxIdx && direction match)` on an ascending array, but
 * O(log n + window) instead of a full-history scan (deep-window CPU fix).
 */
function structFind(
  dirEvents: StructureEvent[],
  minIdx: number,
  maxIdx: number,
  dir: "BULLISH" | "BEARISH"
): StructureEvent | null {
  void dir; // arrays are pre-split by direction
  const k = lowerBoundByIndex(dirEvents, minIdx);
  return k < dirEvents.length && dirEvents[k].index <= maxIdx ? dirEvents[k] : null;
}

/**
 * NEWEST sweep matching side with index in [minIdx, maxIdx] — identical to
 * `[...sweeps].reverse().find(...)` without the per-bar array copy+reverse.
 * sweeps must be index-ascending (detection appends chronologically).
 */
function sweepFindNewest(
  sweeps: LiquiditySweep[],
  minIdx: number,
  maxIdx: number,
  sellSide: boolean
): LiquiditySweep | null {
  for (let s = sweeps.length - 1; s >= 0; s--) {
    const ev = sweeps[s];
    if (ev.index > maxIdx) continue;
    if (ev.index < minIdx) break; // ascending: everything older is out of window
    if ((sellSide ? ev.side === "SELL_SIDE" : ev.side === "BUY_SIDE")) return ev;
  }
  return null;
}

/** any pool within ±`distance` of `price` (binary search over price-sorted pools) */
function poolNearPrice(poolsByPrice: LiquidityPool[], price: number, distance: number): boolean {
  let lo = 0;
  let hi = poolsByPrice.length;
  const min = price - distance;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (poolsByPrice[mid].price < min) lo = mid + 1;
    else hi = mid;
  }
  return lo < poolsByPrice.length && poolsByPrice[lo].price <= price + distance;
}

/** Build every causal series the setup builder needs (pure — no I/O). */
export function buildSeriesContext(
  symbol: SymbolKey,
  interval: IntervalKey,
  candles: Candle[],
  smtEvents: { index: number; type: "BULLISH" | "BEARISH" }[] = [],
  obInvalidation: ObInvalidation = "close-mid",
  obDisplacementFactor = 1.2
): SeriesContext {
  const intervalSec = intervalSeconds(interval);
  const atrS = atrSeries(candles, 14);
  const volRegimes = volRegimeSeries(candles, atrS, 200);
  const walk = structureWalkSeries(candles, 2);
  const regime = marketRegimeSeries(candles, walk.events, atrS, 60);
  const { biasAt } = htfBiasSeries(candles, intervalSec, htfSecondsFor(intervalSec), 2);

  // zones (with global mitigation markers consumed causally by index)
  // FVG mitigation = midpoint TOUCH (zone no longer fresh — conservative).
  // OB invalidation = rule-configurable (default: CLOSE through midpoint —
  // a wick tap is the retest we trade). see zones.ts ObInvalidation.
  // ONE table set is shared by the FVG scan, the OB scan and the first-death
  // loop below — at 15k bars each build is n·log2(n)×4 numbers, and building
  // it three times per run was the deep-window memory spike.
  const priceIdx = priceTrees(candles);
  const fvgZones = detectFvg(candles, 100000, true, priceIdx);
  const obZones = detectOrderBlocks(candles, atrS, obDisplacementFactor, 100000, true, obInvalidation, priceIdx);
  const zones = [...fvgZones, ...obZones];
  const zoneMitigatedAt = new Map<string, number>();
  const zoneCreatedIndex = new Map<string, number>();
  const zoneKind = new Map<string, "FVG" | "OB">();
  const zoneIndex: { zone: Zone; created: number; isFvg: boolean }[] = [];
  // first-death range queries (same indices the linear scans found, O(log n) each)
  for (const z of zones) {
    const isFvg = z.id.startsWith("fvg");
    zoneKind.set(z.id, isFvg ? "FVG" : "OB");
    const created = isFvg ? fvgCreatedIndex(z) : obCreatedIndex(z);
    zoneCreatedIndex.set(z.id, created);
    zoneIndex.push({ zone: z, created, isFvg });
    const deathAt = firstMitigationIndex(
      isFvg ? (z.direction === "BULLISH" ? "fvg-bull" : "fvg-bear") : obInvalidation,
      z,
      z.startIndex + (isFvg ? 3 : 2),
      priceIdx
    );
    if (deathAt !== -1) zoneMitigatedAt.set(z.id, deathAt);
  }
  zoneIndex.sort((a, b) => a.created - b.created);

  const sweeps = detectSweeps(candles, 2, 100000);
  const pools = detectLiquidityPools(candles, 2, 0.0006, 100000);
  // precomputed lookback-3 swings for the structural target ladder
  const swingLadder = findSwings(candles, 3);

  // SMT lookup: any divergence of the type within the recent window.
  // O(1) per bar via prefix arrays (most recent bullish/bearish event at or
  // before each bar) — the previous per-bar .some() scan over all events was
  // O(events) × 14k candidate bars ≈ 10⁸ iterations on deep windows.
  const smtEventsSorted = [...smtEvents].sort((a, b) => a.index - b.index);
  const lastBullIdx = new Int32Array(candles.length).fill(-1);
  const lastBearIdx = new Int32Array(candles.length).fill(-1);
  {
    let bi = -1;
    let be = -1;
    let k = 0;
    for (let i = 0; i < candles.length; i++) {
      while (k < smtEventsSorted.length && smtEventsSorted[k].index <= i) {
        if (smtEventsSorted[k].type === "BULLISH") bi = smtEventsSorted[k].index;
        else be = smtEventsSorted[k].index;
        k++;
      }
      lastBullIdx[i] = bi;
      lastBearIdx[i] = be;
    }
  }
  const smtWindow = DEFAULT_CONFIG.smtWindowBars;
  const smtBullishAt = (i: number) =>
    i >= 0 && i < candles.length && lastBullIdx[i] !== -1 && i - lastBullIdx[i] <= smtWindow;
  const smtBearishAt = (i: number) =>
    i >= 0 && i < candles.length && lastBearIdx[i] !== -1 && i - lastBearIdx[i] <= smtWindow;

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

  // per-direction structure arrays + price-sorted pools: the setup scan used
  // to run full-array .find() / [...spread].reverse() PER BAR PER MODEL
  // (O(events) with no early exit — the dominant rejection path scanned the
  // entire history on every bar). Binary search over these pre-sorted arrays
  // makes every recency/proximity query O(log n). Same results, pinned by
  // the full self-test suite (truncation invariance + replay consistency).
  const structureBull: StructureEvent[] = [];
  const structureBear: StructureEvent[] = [];
  for (const e of walk.events) {
    if (e.direction === "BULLISH") structureBull.push(e);
    else structureBear.push(e);
  }
  const poolsByPrice = [...pools].sort((a, b) => a.price - b.price);

  const diag = newDiagSink();
  // OB creation pipeline — series-wide counts for the Model C/D diagnosis
  diag.obZonesCreated = obZones.length;
  for (const z of obZones) if (zoneMitigatedAt.has(z.id)) diag.obZonesInvalidated++;

  return {
    symbol, interval, candles, intervalSec, atrS, volRegimes, regime,
    structureEvents: walk.events, trendAt: walk.trendAt, biasAt,
    zones, zoneMitigatedAt, zoneCreatedIndex, zoneKind, zoneIndex,
    structureBull, structureBear, poolsByPrice,
    sweeps, pools, smtBullishAt, smtBearishAt, rangeAt, funnel, swingLadder,
    diag,
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
  /** PRIMARY rejection code of the deepest-rejected model (diagnostics §2) */
  rejection: RejectionCode | null;
}

interface Candidate {
  model: ModelKey;
  setup: Setup;
  stageDepth: number;
}

export function buildSetupAt(
  ctx: SeriesContext,
  i: number,
  cfg: EngineConfig,
  cooldown: CooldownState
): BuildResult {
  const { candles, funnel, diag } = ctx;
  funnel.barsEvaluated++;
  const c = candles[i];
  const atrI = ctx.atrS[i];
  if (atrI <= 0) return { setup: null, rejection: null };

  // ---- per-bar market-state funnel (counted once per bar) ----------------
  const bias = ctx.biasAt(i);
  const vol = ctx.volRegimes[i];
  const mkt = ctx.regime.regimeAt(i);
  const session = sessionKeyAt(c.time);
  const inKz = session !== "off-session";
  diag.bars++;
  if (bias !== "NEUTRAL") diag.biasBars++;
  if (inKz) diag.kzBars++;
  const range = ctx.rangeAt(i);
  const rangeOk = range.high - range.low >= 0.5 * atrI;
  if (rangeOk) diag.rangeBars++;
  const poolNear = poolNearPrice(ctx.poolsByPrice, c.close, 10 * atrI);
  if (poolNear) diag.poolBars++;
  const wantBullishBias = bias === "BULLISH";
  const biasSweep = sweepFindNewest(ctx.sweeps, i - cfg.maxSweepAgeBars, i - 1, wantBullishBias);
  if (biasSweep) diag.sweepBars++;
  const biasStructure = structFind(wantBullishBias ? ctx.structureBull : ctx.structureBear, i - cfg.maxStructureAgeBars, i, wantBullishBias ? "BULLISH" : "BEARISH");
  if (biasStructure) diag.structureBars++;

  // ---- side from causal HTF bias ------------------------------------------
  const side: Side | null = bias === "BULLISH" ? "LONG" : bias === "BEARISH" ? "SHORT" : null;
  if (!side) {
    recordPrimary(ctx, i, "NO_HTF_BIAS", null, 0, session, cfg, atrI);
    return { setup: null, rejection: "NO_HTF_BIAS" };
  }
  funnel.htfBiasOk++;
  if (cfg.requireHtfBias && !side) return { setup: null, rejection: "NO_HTF_BIAS" };

  // ---- regime gates -------------------------------------------------------
  if (cfg.blockedVolRegimes.includes(vol)) {
    recordPrimary(ctx, i, "VOL_BLOCKED", null, 0, session, cfg, atrI);
    return { setup: null, rejection: "VOL_BLOCKED" };
  }
  if (mkt === "UNCLEAR") {
    recordPrimary(ctx, i, "REGIME_UNCLEAR", null, 0, session, cfg, atrI);
    return { setup: null, rejection: "REGIME_UNCLEAR" };
  }
  funnel.regimeOk++;
  diag.contextBars++;

  // ---- session gate (user filter; kill zone itself is optional, §5) -------
  const sessionAllowed = cfg.sessions.length === 0 || cfg.sessions.includes(session) || ((session === "ny-am" || session === "ny-pm") && cfg.sessions.includes("ny"));
  funnel.sessionOk += sessionAllowed ? 1 : 0;
  if (!sessionAllowed) {
    recordPrimary(ctx, i, "OUTSIDE_SESSION", null, 1, session, cfg, atrI);
    return { setup: null, rejection: "OUTSIDE_SESSION" };
  }

  const wantBullish = side === "LONG";

  // ---- evaluate every enabled model, keep the best candidate -------------
  const candidates: Candidate[] = [];
  let deepest: { code: RejectionCode; depth: number } | null = null;

  for (const model of MODEL_ORDER) {
    if (!cfg.models.includes(model)) continue;
    const stat = modelStat(ctx, model);
    stat.opportunities++;
    diag.candidates++;
    const r = evaluateModel(ctx, i, cfg, cooldown, model, side, wantBullish, bias, vol, mkt, session, range, atrI);
    if (r.candidate) {
      stat.valid++;
      candidates.push({ model, setup: r.candidate, stageDepth: 99 });
    } else if (r.rejection) {
      bump(stat.rejections, r.rejection);
      bump(diag.rejections, r.rejection);
      const depth = STAGE_DEPTH[r.rejection];
      if (!deepest || depth > deepest.depth) deepest = { code: r.rejection, depth };
    }
  }

  if (candidates.length === 0) {
    // record the primary (deepest) rejection for this bar
    const code = deepest?.code ?? null;
    if (code) diag.primary.set(code, (diag.primary.get(code) ?? 0) + 1);
    funnel.scoreOk += 0;
    return { setup: null, rejection: code };
  }

  // best candidate by score (tie → first in MODEL_ORDER)
  candidates.sort((a, b) => b.setup.totalScore - a.setup.totalScore || MODEL_ORDER.indexOf(a.model) - MODEL_ORDER.indexOf(b.model));
  const best = candidates[0];
  const setup = best.setup;
  diag.validSetups++;
  diag.setupsBySession.set(session, (diag.setupsBySession.get(session) ?? 0) + 1);
  if (setup.smtAligned) diag.smtOk++;
  if (inKz) diag.kzOk++;
  funnel.scoreOk++;

  // per-bar market funnel shares (approximate attribution — documented)
  funnel.sweepFound += setup.confluence.liquiditySweep.detected ? 1 : 0;
  funnel.sweepQualityOk += setup.confluence.liquiditySweep.detected ? 1 : 0;
  funnel.structureOk += 1;
  funnel.displacementOk += 1;
  funnel.zoneFound += 1;
  funnel.zoneQualityOk += 1;
  funnel.premiumDiscountOk += setup.confluence.premiumDiscount.detected ? 1 : 0;
  funnel.rrOk += 1;

  return { setup, rejection: setup.tier === "NO_TRADE" ? "SCORE_BELOW_TIER" : null };
}

function modelStat(ctx: SeriesContext, model: ModelKey) {
  let s = ctx.diag.byModel.get(model);
  if (!s) {
    s = { opportunities: 0, valid: 0, rejections: new Map() };
    ctx.diag.byModel.set(model, s);
  }
  return s;
}

function recordPrimary(
  ctx: SeriesContext,
  i: number,
  code: RejectionCode,
  _trace: ConfluenceTrace | null,
  depth: number,
  session: string,
  cfg: EngineConfig,
  atrI: number
) {
  void i; void session; void cfg; void atrI; void depth; void _trace;
  ctx.diag.primary.set(code, (ctx.diag.primary.get(code) ?? 0) + 1);
}

// ---------------------------------------------------------------------------
// Model evaluation — one candidate per model per bar
// ---------------------------------------------------------------------------

interface ModelEval {
  candidate: Setup | null;
  rejection: RejectionCode | null;
  /** partial info for sample capture */
  partial?: {
    sweep: LiquiditySweep | null;
    sweepAssessment: SweepAssessment | null;
    structure: StructureEvent | null;
    dispIndex: number | null;
    zone: { zone: Zone; isFvg: boolean } | null;
    entry: number | null;
    initialStop: number | null;
    target: number | null;
    rr: number | null;
    maxRr: number | null;
    score: number | null;
  };
}

function evaluateModel(
  ctx: SeriesContext,
  i: number,
  cfg: EngineConfig,
  cooldown: CooldownState,
  model: ModelKey,
  side: Side,
  wantBullish: boolean,
  bias: Trend,
  vol: VolatilityRegime,
  mkt: MarketRegime,
  session: string,
  range: TrailingRange,
  atrI: number
): ModelEval {
  const { candles, diag } = ctx;
  const c = candles[i];
  const partial: NonNullable<ModelEval["partial"]> = {
    sweep: null, sweepAssessment: null, structure: null, dispIndex: null,
    zone: null, entry: null, initialStop: null, target: null, rr: null, maxRr: null, score: null,
  };
  const finish = (rejection: RejectionCode | null, candidate: Setup | null = null): ModelEval => {
    if (rejection) {
      // Reservoir sampling (Vitter R) — deterministic via a seeded counter rng.
      // Keeps inspector samples spread across the WHOLE window instead of
      // clustering on the first bars of the run (spec §19).
      const n = ++diag.sampleCounter;
      const cap = 48;
      const slot = diag.samples.length < cap ? diag.samples.length : Math.floor(mulberry32(0x9e3779b9 ^ n)() * n);
      if (slot < cap) {
        const sample = buildSample(ctx, i, cfg, model, side, rejection, partial, session);
        if (diag.samples.length < cap) diag.samples.push(sample);
        else diag.samples[slot] = sample;
      }
    }
    return { candidate, rejection };
  };

  // Model D needs both zone kinds; A wants FVG; C wants OB; E wants either.
  const wantFvg = model === "A_SWEEP_REVERSAL" || model === "B_FVG_CONTINUATION" || model === "D_FVG_OB_CONFLUENCE" || model === "E_SMT_REVERSAL";
  const wantOb = model === "C_OB_REVERSAL" || model === "D_FVG_OB_CONFLUENCE" || model === "E_SMT_REVERSAL";

  // -- 1. liquidity event ---------------------------------------------------
  let sweep: LiquiditySweep | null = null;
  let sweepAssessment: SweepAssessment | null = null;
  let structureAnchor: StructureEvent | null = null;

  if (model !== "B_FVG_CONTINUATION") {
    // reversal models REQUIRE the sweep (their identity)
    sweep = sweepFindNewest(ctx.sweeps, i - cfg.maxSweepAgeBars, i - 1, wantBullish);
    if (!sweep) return finish("NO_LIQUIDITY_SWEEP");
    diag.sweepsFound++;
    partial.sweep = sweep;
    const sweepAtr = ctx.atrS[sweep.index] || atrI;
    sweepAssessment = classifySweep(candles, sweep, sweepAtr);
    partial.sweepAssessment = sweepAssessment;
    const classOk = sweepAssessment.cls === "SWEEP_REJECTION" || (cfg.allowUnconfirmedSweep && sweepAssessment.cls === "SWEEP_NO_CONFIRM");
    if (!classOk || sweepAssessment.quality < cfg.sweepQualityMin) return finish("WEAK_SWEEP");
    diag.sweepsQuality++;
    if (cfg.oneTradePerSweep && cooldown.usedSweepKeys.has(`${sweep.index}:${sweep.level}`)) {
      return finish("DUPLICATE_SETUP");
    }
    // structure must be caused by the sweep — window (sweep.index, i] ∩
    // recency [i-K, i] (both original constraints), oldest match first
    structureAnchor = structFind(
      wantBullish ? ctx.structureBull : ctx.structureBear,
      Math.max((sweep as LiquiditySweep).index + 1, i - cfg.maxStructureAgeBars),
      i,
      wantBullish ? "BULLISH" : "BEARISH"
    );
    if (!structureAnchor) {
      // is there a matching event just outside the recency window? → WEAK vs NONE
      const stale = structFind(
        wantBullish ? ctx.structureBull : ctx.structureBear,
        (sweep as LiquiditySweep).index + 1,
        i,
        wantBullish ? "BULLISH" : "BEARISH"
      );
      return finish(stale ? "WEAK_MSS" : "NO_MSS");
    }
    diag.structuresFound++;
  } else {
    // Model B: continuation — BOS/MSS in the bias direction, no sweep needed
    const dirEvents = wantBullish ? ctx.structureBull : ctx.structureBear;
    structureAnchor = structFind(dirEvents, i - cfg.maxStructureAgeBars, i, wantBullish ? "BULLISH" : "BEARISH");
    if (!structureAnchor) {
      // any matching event at or before i at all? (oldest = first of the array)
      const stale = dirEvents.length > 0 && dirEvents[0].index <= i ? dirEvents[0] : null;
      return finish(stale ? "WEAK_MSS" : "NO_MSS");
    }
    diag.structuresFound++;
  }
  partial.structure = structureAnchor;
  const anchorIndex = structureAnchor.index;

  // -- 2. displacement leg ---------------------------------------------------
  const dispFrom = model === "B_FVG_CONTINUATION" ? Math.max(0, anchorIndex - 8) : (sweep as LiquiditySweep).index + 1;
  const dispIndex = findDisplacementCandle(candles, dispFrom, anchorIndex, wantBullish ? "BULLISH" : "BEARISH");
  if (dispIndex === null) return finish("NO_DISPLACEMENT");
  partial.dispIndex = dispIndex;
  const dispAssessment = assessDisplacement({
    candles,
    index: dispIndex,
    direction: wantBullish ? "BULLISH" : "BEARISH",
    atr: ctx.atrS[dispIndex] || atrI,
    createdFvg: true, // refined by zone selection; a zone in the window is required anyway
    brokeStructure: true,
  });
  if (dispAssessment.quality < cfg.displacementQualityMin) return finish("WEAK_DISPLACEMENT");
  diag.displacements++;

  // -- 3. entry zone(s) ------------------------------------------------------
  const windowFrom = model === "B_FVG_CONTINUATION" ? Math.max(0, anchorIndex - 9) : (sweep as LiquiditySweep).index;
  const windowTo = Math.min(i, anchorIndex + 3);
  const zoneWindow = zonesInWindow(ctx.zoneIndex, windowFrom, windowTo);
  const sweepExtreme = sweep ? sweep.extreme : null;

  let fvgPick: { zone: Zone; quality: number; notes: string[] } | null = null;
  let obPick: { zone: Zone; quality: number; notes: string[] } | null = null;
  let fvgInWindow = 0;
  let obInWindow = 0;
  const legEq = legEquilibrium(candles, sweep, i, wantBullish, anchorIndex);

  for (const entry of zoneWindow) {
    const { zone, isFvg } = entry;
    if (zone.direction !== (wantBullish ? "BULLISH" : "BEARISH")) continue;
    if (!isFvg) diag.obWindowSeen++;
    const mit = ctx.zoneMitigatedAt.get(zone.id);
    if (mit !== undefined && mit <= i) {
      if (!isFvg) diag.obSkipMitigated++;
      continue; // silently skip mitigated
    }
    if (isFvg) fvgInWindow++;
    else obInWindow++;
    // order must rest beyond price: long → zone strictly below close
    if (wantBullish && zone.top >= c.close) {
      if (!isFvg) diag.obSkipPosition++;
      continue; // limit would cross / consumed
    }
    if (!wantBullish && zone.bottom <= c.close) {
      if (!isFvg) diag.obSkipPosition++;
      continue;
    }
    // zone sane relative to the swept extreme
    if (sweepExtreme !== null) {
      if (wantBullish && zone.bottom < sweepExtreme - 0.75 * atrI) {
        if (!isFvg) diag.obSkipSweepExtreme++;
        continue;
      }
      if (!wantBullish && zone.top > sweepExtreme + 0.75 * atrI) {
        if (!isFvg) diag.obSkipSweepExtreme++;
        continue;
      }
    }
    if (cfg.sameZoneCooldown && cooldown.blacklistedZones.has(zone.id)) {
      if (!isFvg) diag.obSkipBlacklist++;
      continue;
    }
    const mid = (zone.top + zone.bottom) / 2;
    const inCorrectHalf = wantBullish ? mid < legEq.equilibrium : mid > legEq.equilibrium;
    const q = isFvg
      ? fvgQuality({
          candles, zone, atr: atrI, currentIndex: i,
          sweepIndex: sweep ? sweep.index : null, mssIndex: anchorIndex,
          displacementIndex: dispIndex, inCorrectRangeHalf: inCorrectHalf,
          htfAligned: wantBullish ? bias === "BULLISH" : bias === "BEARISH",
        })
      : obQuality({
          candles, zone, atr: atrI, currentIndex: i,
          sweepIndex: sweep ? sweep.index : null, mssIndex: anchorIndex,
          inCorrectRangeHalf: inCorrectHalf,
        });
    if (isFvg) {
      if (!fvgPick || q.score > fvgPick.quality) fvgPick = { zone, quality: q.score, notes: q.notes };
    } else {
      if (!obPick || q.score > obPick.quality) obPick = { zone, quality: q.score, notes: q.notes };
    }
  }

  if (wantFvg && fvgInWindow > 0) diag.fvgSeen++;
  if (wantOb && obInWindow > 0) diag.obSeen++;

  // model-specific zone requirements
  let pick: { zone: Zone; quality: number; notes: string[]; isFvg: boolean; overlap: boolean } | null = null;
  if (model === "A_SWEEP_REVERSAL" || model === "B_FVG_CONTINUATION") {
    if (fvgInWindow === 0) return finish("NO_FVG");
    if (!fvgPick) return finish("INVALID_FVG");
    if (fvgPick.quality < cfg.zoneQualityMin) return finish("INVALID_FVG");
    pick = { ...fvgPick, isFvg: true, overlap: false };
  } else if (model === "C_OB_REVERSAL") {
    if (obInWindow === 0) return finish("NO_ORDER_BLOCK");
    if (!obPick) return finish("INVALID_ORDER_BLOCK");
    if (obPick.quality < cfg.zoneQualityMin) return finish("INVALID_ORDER_BLOCK");
    pick = { ...obPick, isFvg: false, overlap: false };
  } else if (model === "D_FVG_OB_CONFLUENCE") {
    if (fvgInWindow === 0) return finish("NO_FVG");
    if (obInWindow === 0) return finish("NO_ORDER_BLOCK");
    if (!fvgPick || !obPick) return finish(fvgPick ? "INVALID_ORDER_BLOCK" : "INVALID_FVG");
    // overlap in price between the best FVG and the best OB
    const lo = Math.max(fvgPick.zone.bottom, obPick.zone.bottom);
    const hi = Math.min(fvgPick.zone.top, obPick.zone.top);
    const smaller = Math.min(fvgPick.zone.top - fvgPick.zone.bottom, obPick.zone.top - obPick.zone.bottom);
    const overlapHeight = hi - lo;
    if (overlapHeight <= 0.1 * Math.max(1e-9, smaller)) {
      return finish("INVALID_FVG"); // both exist but no usable confluence
    }
    const quality = (fvgPick.quality + obPick.quality) / 2;
    if (quality < cfg.zoneQualityMin) return finish("INVALID_FVG");
    pick = {
      zone: {
        ...fvgPick.zone,
        id: `d-${fvgPick.zone.id}-${obPick.zone.id}`,
        top: hi, bottom: lo, // overlap region is the entry zone
      },
      quality, notes: [...fvgPick.notes, ...obPick.notes, "FVG and OB overlap (confluence)"],
      isFvg: true, overlap: true,
    };
  } else {
    // E_SMT_REVERSAL: FVG or OB, SMT required
    if (fvgInWindow === 0 && obInWindow === 0) return finish("NO_FVG");
    const smtAligned = wantBullish ? ctx.smtBullishAt(i) : ctx.smtBearishAt(i);
    if (!smtAligned) return finish("SMT_REQUIRED_BUT_MISSING");
    const bestBoth = pickBest(fvgPick, obPick);
    if (!bestBoth) return finish(fvgInWindow ? "INVALID_FVG" : "INVALID_ORDER_BLOCK");
    if (bestBoth.quality < cfg.zoneQualityMin) return finish(bestBoth === fvgPick ? "INVALID_FVG" : "INVALID_ORDER_BLOCK");
    pick = { ...bestBoth, isFvg: bestBoth === fvgPick, overlap: false };
  }

  diag.zonesValid++;
  partial.zone = { zone: pick.zone, isFvg: pick.isFvg };
  const zone = pick.zone;
  const zoneMid = (zone.top + zone.bottom) / 2;

  // -- 4. premium/discount within the sequence LEG (optional confluence) ----
  const depth = wantBullish
    ? (legEq.equilibrium - zoneMid) / Math.max(1e-9, legEq.equilibrium - legEq.low)
    : (zoneMid - legEq.equilibrium) / Math.max(1e-9, legEq.high - legEq.equilibrium);
  const depth01 = Math.max(0, Math.min(1, depth));
  const pdOk = wantBullish ? zoneMid < legEq.equilibrium : zoneMid > legEq.equilibrium;
  if (pdOk) diag.pdOk++;
  if (cfg.requireDiscountPremium && !pdOk) return finish("WRONG_PREMIUM_DISCOUNT");

  // -- 5. entry / structural stop -------------------------------------------
  // entryAnchor: proximal edge (ICT default) or zone midpoint (deeper limit,
  // higher fill odds, worse average location — compareable via diagnostics)
  const entry = cfg.entryAnchor === "midpoint" ? zoneMid : wantBullish ? zone.top : zone.bottom;
  partial.entry = entry;
  const buffer = 0.1 * atrI;
  let protectedExtreme: number;
  if (sweep) {
    protectedExtreme = sweep.extreme;
  } else {
    // Model B: protect the most recent confirmed swing against the trade
    const swing = [...ctx.swingLadder].reverse().find((s) => s.index + 3 <= i && (wantBullish ? s.type === "LOW" : s.type === "HIGH"));
    protectedExtreme = swing ? swing.price : wantBullish ? zone.bottom : zone.top;
  }
  const initialStop = wantBullish
    ? Math.min(zone.bottom, protectedExtreme) - buffer
    : Math.max(zone.top, protectedExtreme) + buffer;
  partial.initialStop = initialStop;
  const riskPerUnit = Math.abs(entry - initialStop);
  if (riskPerUnit < cfg.minStopAtrMult * atrI) return finish("INVALID_STOP");
  if (riskPerUnit > cfg.maxStopAtrMult * atrI) return finish("INVALID_STOP");
  if (riskPerUnit / entry > cfg.maxStopPctOfPrice) return finish("INVALID_STOP");
  diag.stopValid++;

  // -- 5b. execution-feasibility gate: round-trip cost share of 1R ----------
  // A fixed ~$0.42 round trip on XAUUSD eats 44% of gross edge when stops
  // are tight. When the gate is on, setups that would donate more than
  // maxCostPctOfR of their risk to costs are declined BEFORE the RR gate.
  if (cfg.maxCostPctOfR > 0) {
    const estCostR = roundTripCostR(cfg.costs[ctx.symbol] ?? DEFAULT_COSTS[ctx.symbol], entry, riskPerUnit);
    if (estCostR > cfg.maxCostPctOfR) {
      diag.costRejected++;
      return finish("EXCESSIVE_COST");
    }
  }

  // -- 6. structural target ladder + minimum RR gate ------------------------
  diag.rrDiag.evaluated++;
  const prev = prevExtremes(candles, i, ctx.intervalSec);
  const ladderFull = buildTargetLadder({
    candles, index: i, side, entry, riskPerUnit,
    pools: ctx.pools, rangeHigh: range.high, rangeLow: range.low,
    prev, clusterAtr: atrI, swings: ctx.swingLadder,
  });
  if (ladderFull.length === 0) {
    // no levels at all → no liquidity; some levels but all on the wrong side
    return finish(rawCandidateCount(candles, i, side, ctx.pools) === 0 ? "NO_LIQUIDITY" : "NO_STRUCTURAL_TARGET");
  }
  diag.rrDiag.withTargets++;
  const tt = selectTradeTargets(ladderFull, entry, riskPerUnit, cfg.targetHorizonR);
  diag.rrDiag.targetsCappedAccum += tt.capped;
  partial.maxRr = round2(tt.maxRR);
  const rrSample = diag.rrDiag.values;
  if (rrSample.length < 4000) rrSample.push(round2(tt.maxRR));
  if (tt.maxRR >= 1.5) diag.rrDiag.ge15++;
  if (tt.maxRR >= 2) diag.rrDiag.ge20++;
  if (tt.maxRR >= 2.5) diag.rrDiag.ge25++;
  if (tt.maxRR >= 3) diag.rrDiag.ge30++;
  if (diag.rrDiag.tp1Values.length < 4000) diag.rrDiag.tp1Values.push(round2(tt.rrToTp1));
  if (diag.rrDiag.tp3Values.length < 4000) diag.rrDiag.tp3Values.push(round2(tt.maxRR));
  diag.targetsValid++;
  if (tt.maxRR < cfg.minRR) return finish("INSUFFICIENT_RR");
  diag.rrOk++;
  partial.target = tt.tp3 ? tt.tp3.price : null;
  partial.rr = round2(tt.maxRR);

  // -- 7. optional confluence flags -----------------------------------------
  const smtAligned = wantBullish ? ctx.smtBullishAt(i) : ctx.smtBearishAt(i);
  const inKillzone = sessionKeyAt(c.time) !== "off-session";
  const sweepInKz = sweep ? sessionKeyAt(sweep.time) !== "off-session" : false;

  // -- 8. scoring ------------------------------------------------------------
  const sweepAge = sweep ? i - sweep.index : 0;
  const scores = scoreSetup({
    cfg, side, bias, depth01,
    sweep: sweep && sweepAssessment ? { assessment: sweepAssessment, age: sweepAge } : null,
    structureType: structureAnchor.type,
    structureAge: i - structureAnchor.index,
    dispQuality: dispAssessment.quality,
    zoneKind: pick.isFvg ? (pick.overlap ? "FVG+OB" : "FVG") : "OB",
    zoneQuality: pick.quality,
    zoneFresh: isZoneFresh(ctx, zone, i),
    inKillzone,
    sweepInKillzone: sweepInKz,
    smtAligned,
    rrToFinal: tt.maxRR,
    stopStructural: wantBullish
      ? initialStop <= Math.min(zone.bottom, sweep ? sweep.extreme : zone.bottom)
      : initialStop >= Math.max(zone.top, sweep ? sweep.extreme : zone.top),
    targetStructural: ladderFull.some((t) => t.weight >= 0.7),
    mktRegime: mkt,
  });
  const totalScore = scores.context + scores.liquidity + scores.structure + scores.entry + scores.confirmation + scores.risk;
  partial.score = totalScore;
  let tier = tierFor(totalScore, cfg);
  if (mkt === "RANGE" && totalScore < cfg.rangeRegimeMinScore) {
    tier = "NO_TRADE";
  }

  // -- confluence trace (spec §3) -------------------------------------------
  const tfLabel = intervalLabelOf(ctx);
  const rangeOkLocal = range.high - range.low >= 0.5 * atrI;
  const confluence = buildTrace({
    ctx, i, cfg, bias, range, rangeOk: rangeOkLocal,
    sweep, sweepAssessment, structureAnchor, dispIndex, dispAssessment,
    zone, zoneQuality: pick.quality, isFvg: pick.isFvg, overlap: pick.overlap,
    fvgInWindow, obInWindow, wantFvg, wantOb,
    session, smtAligned, pdOk, depth01,
    entry, initialStop, riskPerUnit, tt, minRR: cfg.minRR,
    totalScore, tier, tfLabel, atrI, vol, mkt,
  });

  // -- assemble ---------------------------------------------------------------
  const events: SetupEvent[] = [];
  events.push({ kind: "HTF_BIAS", index: i, time: c.time, detail: `HTF bias ${bias} (${tfLabel})` });
  if (sweep && sweepAssessment) {
    events.push({ kind: "LIQUIDITY_SWEEP", index: sweep.index, time: sweep.time, detail: `${sweep.side === "SELL_SIDE" ? "Sellside" : "Buyside"} sweep @ ${sweep.level.toFixed(2)} (${sweepAssessment.cls}, q=${sweepAssessment.quality.toFixed(2)})` });
  }
  events.push({ kind: "DISPLACEMENT", index: dispIndex, time: candles[dispIndex].time, detail: `displacement q=${dispAssessment.quality.toFixed(2)} (${dispAssessment.rangeAtrMult}x ATR, body ${(dispAssessment.bodyRatio * 100).toFixed(0)}%)` });
  events.push({ kind: structureAnchor.type === "MSS" ? "MSS" : "BOS", index: anchorIndex, time: structureAnchor.time, detail: `${structureAnchor.type} ${structureAnchor.direction} @ ${structureAnchor.level.toFixed(2)}` });
  events.push({ kind: "ZONE_CREATED", index: ctx.zoneCreatedIndex.get(zone.id) ?? zone.startIndex, time: candles[ctx.zoneCreatedIndex.get(zone.id) ?? zone.startIndex]?.time ?? c.time, detail: `${pick.overlap ? "FVG+OB overlap" : pick.isFvg ? "FVG" : "OB"} ${zone.direction} [${zone.bottom.toFixed(2)}–${zone.top.toFixed(2)}] q=${pick.quality.toFixed(2)}` });
  events.push({ kind: "PREMIUM_DISCOUNT", index: i, time: c.time, detail: pdOk ? `zone in ${wantBullish ? "discount" : "premium"} (depth ${(depth01 * 100).toFixed(0)}%)` : `zone NOT in ${wantBullish ? "discount" : "premium"} (optional confluence, score only)` });
  events.push({ kind: "ENTRY_RETRACE", index: i, time: c.time, detail: `limit @ ${entry.toFixed(2)} (proximal edge)` });

  const modelLabel = modelLabelFor(model);
  const rationale = [
    `${modelLabel}: ${sweep ? "sweep → " : ""}${structureAnchor.type} → displacement → ${pick.overlap ? "FVG+OB overlap" : pick.isFvg ? "FVG" : "OB"} retracement.`,
    pdOk ? "Premium/discount confluence present." : "Premium/discount NOT aligned (optional confluence, no gate).",
    smtAligned ? "SMT divergence with the companion series confirms." : "No SMT confirmation (optional).",
    inKillzone ? `Inside ${SESSION_LABELS[session as keyof typeof SESSION_LABELS] ?? session}.` : "Outside kill zones (optional confluence, no gate).",
    ...pick.notes.map((n) => `Zone: ${n}`),
  ];
  const rejections = tier === "NO_TRADE" ? [`score ${totalScore} below ${cfg.tierB} threshold`] : [];

  const setup: Setup = {
    side,
    decidedIndex: i,
    decidedTime: c.time,
    model,
    entry,
    initialStop,
    riskPerUnit,
    events,
    confluence,
    zone: {
      id: zone.id, kind: pick.overlap ? "FVG" : pick.isFvg ? "FVG" : "OB", direction: zone.direction,
      top: zone.top, bottom: zone.bottom,
      createdIndex: ctx.zoneCreatedIndex.get(zone.id) ?? zone.startIndex,
      quality: pick.quality, notes: pick.notes,
    },
    targets: [tt.tp1, tt.tp2, tt.tp3].filter((t): t is StructuralTarget => t !== null).map((t) => ({
      price: t.price, source: t.source,
      rr: round2(Math.abs(t.price - entry) / riskPerUnit),
    })),
    rrToFinal: round2(tt.maxRR),
    rrToTp1: round2(tt.rrToTp1),
    scores,
    totalScore,
    tier,
    session: session as Setup["session"],
    htfBias: bias,
    volRegime: vol,
    mktRegime: mkt,
    smtAligned,
    sweepKey: sweep ? `${sweep.index}:${sweep.level}` : `bos:${anchorIndex}`,
    rationale,
    rejections,
  };

  return finish(tier === "NO_TRADE" ? "SCORE_BELOW_TIER" : null, setup);
}

function pickBest(a: { zone: Zone; quality: number; notes: string[] } | null, b: { zone: Zone; quality: number; notes: string[] } | null) {
  if (!a) return b;
  if (!b) return a;
  return a.quality >= b.quality ? a : b;
}

function modelLabelFor(model: ModelKey): string {
  switch (model) {
    case "A_SWEEP_REVERSAL": return "Model A — Liquidity Sweep Reversal";
    case "B_FVG_CONTINUATION": return "Model B — FVG Continuation";
    case "C_OB_REVERSAL": return "Model C — Order Block Reversal";
    case "D_FVG_OB_CONFLUENCE": return "Model D — FVG+OB Confluence";
    case "E_SMT_REVERSAL": return "Model E — SMT Reversal";
  }
}

/** Dealing range of the sequence LEG: sweep extreme → post-displacement extreme. */
function legEquilibrium(
  candles: Candle[],
  sweep: LiquiditySweep | null,
  i: number,
  wantBullish: boolean,
  anchorIndex: number
): { high: number; low: number; equilibrium: number } {
  const from = sweep ? sweep.index : Math.max(0, anchorIndex - 8);
  let legExtreme = wantBullish ? -Infinity : Infinity;
  for (let k = from; k <= i; k++) {
    if (wantBullish) legExtreme = Math.max(legExtreme, candles[k].high);
    else legExtreme = Math.min(legExtreme, candles[k].low);
  }
  const legLow = wantBullish ? (sweep ? sweep.extreme : legExtreme) : legExtreme;
  const legHigh = wantBullish ? legExtreme : sweep ? sweep.extreme : legExtreme;
  // fall back when no sweep anchors the leg
  const lo = Number.isFinite(legLow) ? legLow : Math.min(legHigh, legExtreme);
  const hi = Number.isFinite(legHigh) ? legHigh : Math.max(lo, legExtreme);
  return { high: hi, low: lo, equilibrium: (hi + lo) / 2 };
}

function rawCandidateCount(candles: Candle[], i: number, side: Side, pools: LiquidityPool[]): number {
  // crude: any pool or any candle extreme beyond entry on the trade side
  void candles; void i;
  return pools.length > 0 ? pools.length : 0;
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

function intervalLabelOf(ctx: SeriesContext): string {
  const s = ctx.intervalSec;
  if (s <= 300) return "5m";
  if (s <= 900) return "15m";
  if (s <= 3600) return "1H";
  if (s <= 14400) return "4H";
  return "1D";
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

// ---------------------------------------------------------------------------
// Confluence trace construction (spec §3)
// ---------------------------------------------------------------------------

function item(detected: boolean, opts: Partial<ConfluenceItem> & { reason: string }): ConfluenceItem {
  return {
    detected,
    timestamp: opts.timestamp ?? null,
    price: opts.price ?? null,
    range: opts.range ?? null,
    timeframe: opts.timeframe ?? "—",
    reason: opts.reason,
  };
}

function buildTrace(a: {
  ctx: SeriesContext;
  i: number;
  cfg: EngineConfig;
  bias: Trend;
  range: TrailingRange;
  rangeOk: boolean;
  sweep: LiquiditySweep | null;
  sweepAssessment: SweepAssessment | null;
  structureAnchor: StructureEvent;
  dispIndex: number | null;
  dispAssessment: { quality: number; rangeAtrMult: number; bodyRatio: number } | null;
  zone: Zone;
  zoneQuality: number;
  isFvg: boolean;
  overlap: boolean;
  fvgInWindow: number;
  obInWindow: number;
  wantFvg: boolean;
  wantOb: boolean;
  session: string;
  smtAligned: boolean;
  pdOk: boolean;
  depth01: number;
  entry: number;
  initialStop: number;
  riskPerUnit: number;
  tt: { tp1: StructuralTarget | null; tp2: StructuralTarget | null; tp3: StructuralTarget | null; maxRR: number };
  minRR: number;
  totalScore: number;
  tier: Tier;
  tfLabel: string;
  atrI: number;
  vol: VolatilityRegime;
  mkt: MarketRegime;
}): ConfluenceTrace {
  const tf = a.tfLabel;
  const c = a.ctx.candles[a.i];
  const sweep = a.sweep;
  const poolNear = a.ctx.pools.some((p) => Math.abs(p.price - c.close) <= 10 * a.atrI);
  return {
    htfBias: item(a.bias !== "NEUTRAL", {
      timestamp: c.time, price: c.close, timeframe: tf,
      reason: `4H/1H structure walk on closed candles says ${a.bias}; trading ${a.bias === "BULLISH" ? "LONG" : a.bias === "BEARISH" ? "SHORT" : "no side"}.`,
    }),
    dealingRange: item(a.rangeOk, {
      price: a.range.equilibrium, range: `${a.range.low.toFixed(2)}–${a.range.high.toFixed(2)}`, timeframe: tf,
      reason: `Trailing ${96}-bar dealing range width ${(a.range.high - a.range.low).toFixed(2)} (≥ 0.5 ATR = valid).`,
    }),
    premiumDiscount: item(a.pdOk, {
      price: a.zone.top !== undefined ? (a.zone.top + a.zone.bottom) / 2 : null, timeframe: tf,
      reason: a.pdOk
        ? `Entry zone in the ${a.bias === "BULLISH" ? "discount" : "premium"} half of the sequence leg (depth ${(a.depth01 * 100).toFixed(0)}%).`
        : `Entry zone NOT in the ${a.bias === "BULLISH" ? "discount" : "premium"} half — optional confluence, contributes no score bonus (gate ${a.cfg.requireDiscountPremium ? "ON" : "OFF"}).`,
    }),
    liquidityPool: item(poolNear, {
      timeframe: tf,
      reason: poolNear
        ? "Equal-high/low pool(s) exist within 10 ATR of price (resting liquidity)."
        : "No equal-high/low pool within 10 ATR — targets rely on swings/session/previous-period liquidity.",
    }),    liquiditySweep: item(!!sweep, {
      timestamp: sweep?.time ?? null, price: sweep?.level ?? null, timeframe: tf,
      reason: sweep && a.sweepAssessment
        ? `${sweep.side === "SELL_SIDE" ? "Sell-side" : "Buy-side"} sweep at ${sweep.level.toFixed(2)}: ${a.sweepAssessment.cls}, quality ${a.sweepAssessment.quality.toFixed(2)} (min ${a.cfg.sweepQualityMin}), wick ${a.sweepAssessment.wickBeyondAtr}× ATR beyond level, close-back ${(a.sweepAssessment.closeBackRatio * 100).toFixed(0)}%.`
        : "No recent sweep required — this candidate comes from the continuation model (BOS leg provides the liquidity event).",
    }),
    mss: item(true, {
      timestamp: a.structureAnchor.time, price: a.structureAnchor.level, timeframe: tf,
      reason: `${a.structureAnchor.type} ${a.structureAnchor.direction} confirmed at index ${a.structureAnchor.index} (within ${a.cfg.maxStructureAgeBars}-bar recency window).`,
    }),
    displacement: item(a.dispIndex !== null, {
      timestamp: a.dispIndex !== null ? a.ctx.candles[a.dispIndex].time : null, timeframe: tf,
      reason: a.dispAssessment
        ? `Displacement candle #${a.dispIndex}: quality ${a.dispAssessment.quality.toFixed(2)} (min ${a.cfg.displacementQualityMin}), ${a.dispAssessment.rangeAtrMult}× ATR range, ${(a.dispAssessment.bodyRatio * 100).toFixed(0)}% body.`
        : "No displacement candle found in the leg.",
    }),
    fvg: item(a.wantFvg && a.fvgInWindow > 0, {
      timestamp: a.ctx.candles[a.zone.startIndex]?.time ?? null,
      range: `${a.zone.bottom.toFixed(2)}–${a.zone.top.toFixed(2)}`, timeframe: tf,
      reason: a.wantFvg
        ? a.overlap
          ? `FVG present and OVERLAPS the order block (confluence entry), quality ${a.zoneQuality.toFixed(2)}.`
          : `FVG selected as entry zone (fresh, created by the displacement leg), quality ${a.zoneQuality.toFixed(2)}.`
        : "Model does not use FVG entries.",
    }),
    orderBlock: item(a.wantOb && a.obInWindow > 0, {
      timestamp: a.ctx.candles[a.zone.startIndex]?.time ?? null,
      range: a.overlap ? `${a.zone.bottom.toFixed(2)}–${a.zone.top.toFixed(2)}` : null,
      timeframe: tf,
      reason: a.wantOb
        ? a.overlap
          ? `OB present and OVERLAPS the FVG (confluence entry).`
          : `OB selected as entry zone, quality ${a.zoneQuality.toFixed(2)}.`
        : "Model does not use OB entries (FVG entry preferred).",
    }),
    session: item(a.session !== "off-session", {
      timestamp: c.time, timeframe: tf,
      reason: `${SESSION_LABELS[a.session as keyof typeof SESSION_LABELS] ?? a.session} — kill zone is an OPTIONAL score confluence (gate ${a.cfg.requireKillzone ? "ON" : "OFF"}); sessions filter: ${a.cfg.sessions.length ? a.cfg.sessions.join(", ") : "all"}.`,
    }),
    smt: item(a.smtAligned, {
      timestamp: c.time, timeframe: tf,
      reason: a.smtAligned
        ? "Companion SMT divergence aligned within the 20-bar window (see the SMT companion panel for the series used)."
        : "No aligned SMT divergence in the window — optional confluence, not required.",
    }),
    structuralStop: item(true, {
      price: a.initialStop, timeframe: tf,
      reason: `Initial stop ${(Math.abs(a.entry - a.initialStop) / Math.max(1e-9, a.atrI)).toFixed(2)}× ATR beyond the protected extreme (sweep low/high or confirmed swing) — sanity band ${a.cfg.minStopAtrMult}–${a.cfg.maxStopAtrMult}× ATR.`,
    }),
    structuralTarget: item(!!a.tt.tp1, {
      price: a.tt.tp1?.price ?? null, timeframe: tf,
      reason: a.tt.tp1
        ? `Ladder: TP1 ${a.tt.tp1.source} @ ${a.tt.tp1.price.toFixed(2)}${a.tt.tp2 ? `, TP2 ${a.tt.tp2.source} @ ${a.tt.tp2.price.toFixed(2)}` : ""}${a.tt.tp3 ? `, TP3 ${a.tt.tp3.source} @ ${a.tt.tp3.price.toFixed(2)}` : ""}.`
        : "No structural liquidity level beyond entry.",
    }),
    rr: item(a.tt.maxRR >= a.minRR, {
      price: a.tt.tp3?.price ?? null, timeframe: tf,
      reason: `Max available structural RR ${a.tt.maxRR.toFixed(2)}R vs required ${a.minRR}R (TP1 ${a.tt.tp1 ? (Math.abs(a.tt.tp1.price - a.entry) / Math.max(1e-9, a.riskPerUnit)).toFixed(2) : "—"}R).`,
    }),
    score: item(a.tier !== "NO_TRADE", {
      timeframe: tf,
      reason: `Total score ${a.totalScore}/100 → tier ${a.tier} (thresholds A+ ${a.cfg.tierAPlus} / A ${a.cfg.tierA} / B ${a.cfg.tierB}).`,
    }),
  };
}

// ---------------------------------------------------------------------------
// Live strategy-state probe (spec §4 — "WHY NO TRADE?")
// ---------------------------------------------------------------------------

export interface ProbeCondition {
  key: string;
  label: string;
  core: boolean; // core requirement (§5) vs optional confluence
  detected: boolean;
  timestamp: number | null;
  price: number | null;
  reason: string;
}

export interface ProbeResult {
  side: Side | null;
  conditions: ProbeCondition[];
  waitingFor: string[];
  perModel: { model: ModelKey; rejection: RejectionCode | null }[];
  barTime: number;
}

/**
 * Evaluate every confluence condition on a bar WITHOUT building a trade —
 * used by the live "WHY NO TRADE?" panel so the checklist reflects the
 * actual strategy state, not a hardcoded message.
 */
export function probeSetupState(ctx: SeriesContext, i: number, cfg: EngineConfig): ProbeResult {
  const { candles } = ctx;
  const c = candles[i];
  const atrI = ctx.atrS[i];
  const bias = ctx.biasAt(i);
  const side: Side | null = bias === "BULLISH" ? "LONG" : bias === "BEARISH" ? "SHORT" : null;
  const wantBullish = bias === "BULLISH";
  const session = sessionKeyAt(c.time);
  const conditions: ProbeCondition[] = [];
  const push = (key: string, label: string, core: boolean, detected: boolean, reason: string, timestamp: number | null = null, price: number | null = null) =>
    conditions.push({ key, label, core, detected, reason, timestamp, price });

  push("htfBias", "HTF bias", true, bias !== "NEUTRAL",
    bias === "NEUTRAL" ? "No 4H/1H structure break on closed candles yet — no directional context." : `HTF structure says ${bias}.`, c.time, c.close);

  const range = ctx.rangeAt(i);
  const rangeOk = atrI > 0 && range.high - range.low >= 0.5 * atrI;
  push("dealingRange", "Dealing range", true, rangeOk,
    rangeOk ? `Trailing range ${range.low.toFixed(2)}–${range.high.toFixed(2)} (EQ ${range.equilibrium.toFixed(2)}).` : "Trailing range too narrow vs volatility — no meaningful dealing range.", c.time, range.equilibrium);

  const poolNear = atrI > 0 && poolNearPrice(ctx.poolsByPrice, c.close, 10 * atrI);
  push("liquidityPool", "Liquidity pool identified", true, poolNear,
    poolNear ? "Equal-high/low pool(s) within 10 ATR of price." : "No equal-high/low pool near price — waiting for liquidity to build.", c.time, null);

  push("session", "Kill zone / session", false, session !== "off-session",
    `${session === "off-session" ? "Outside all kill zones" : `Inside ${SESSION_LABELS[session]}`} — kill zone is an optional score confluence.`, c.time, null);

  const sweep = side
    ? sweepFindNewest(ctx.sweeps, i - cfg.maxSweepAgeBars, i - 1, wantBullish)
    : null;
  const sweepAssessment = sweep ? classifySweep(candles, sweep, ctx.atrS[sweep.index] || atrI) : null;
  const sweepOk = !!sweep && !!sweepAssessment && (sweepAssessment.cls === "SWEEP_REJECTION" || (cfg.allowUnconfirmedSweep && sweepAssessment.cls === "SWEEP_NO_CONFIRM")) && sweepAssessment.quality >= cfg.sweepQualityMin;
  push("liquiditySweep", "Liquidity sweep", true, sweepOk,
    !sweep
      ? side
        ? `No recent ${wantBullish ? "sell-side (low)" : "buy-side (high)"} sweep within ${cfg.maxSweepAgeBars} bars.`
        : "No tradeable side yet (HTF bias unclear)."
      : !sweepAssessment
        ? "Sweep could not be classified."
        : `${sweepAssessment.cls} at ${sweep.level.toFixed(2)} — quality ${sweepAssessment.quality.toFixed(2)} vs min ${cfg.sweepQualityMin}${sweepOk ? "" : " (below threshold)"}.`,
    sweep?.time ?? null, sweep?.level ?? null);

  const structure = side
    ? structFind(wantBullish ? ctx.structureBull : ctx.structureBear, i - cfg.maxStructureAgeBars, i, wantBullish ? "BULLISH" : "BEARISH")
    : null;
  push("mss", "MSS / CHOCH", true, !!structure,
    structure
      ? `${structure.type} ${structure.direction} @ ${structure.level.toFixed(2)} within the recency window.`
      : side
        ? `No ${wantBullish ? "bullish" : "bearish"} MSS/BOS within ${cfg.maxStructureAgeBars} bars.`
        : "Waiting for HTF bias before structure matters.",
    structure?.time ?? null, structure?.level ?? null);

  let dispOk = false;
  let dispReason = side ? "Waiting for a sweep/structure anchor first." : "No tradeable side yet.";
  if (side && structure) {
    const from = sweep ? sweep.index + 1 : Math.max(0, structure.index - 8);
    const dispIndex = findDisplacementCandle(candles, from, structure.index, wantBullish ? "BULLISH" : "BEARISH");
    if (dispIndex !== null) {
      const da = assessDisplacement({ candles, index: dispIndex, direction: wantBullish ? "BULLISH" : "BEARISH", atr: ctx.atrS[dispIndex] || atrI, createdFvg: true, brokeStructure: true });
      dispOk = da.quality >= cfg.displacementQualityMin;
      dispReason = dispOk
        ? `Displacement quality ${da.quality.toFixed(2)} (${da.rangeAtrMult}× ATR).`
        : `Displacement too weak: ${da.quality.toFixed(2)} vs min ${cfg.displacementQualityMin}.`;
    } else {
      dispReason = "No directional burst between the liquidity event and the structure break.";
    }
  }
  push("displacement", "Displacement", true, dispOk, dispReason);

  // fresh zones created by the most recent sequence window
  const windowFrom = sweep ? sweep.index : Math.max(0, i - 12);
  const zoneWindow = zonesInWindow(ctx.zoneIndex, windowFrom, Math.min(i, (structure?.index ?? i) + 3));
  let fvgOk = false;
  let obOk = false;
  let fvgReason = "No fresh FVG created by the sequence leg.";
  let obReason = "No fresh order block created by the sequence leg.";
  for (const { zone, isFvg } of zoneWindow) {
    if (zone.direction !== (wantBullish ? "BULLISH" : "BEARISH")) continue;
    const mit = ctx.zoneMitigatedAt.get(zone.id);
    if (mit !== undefined && mit <= i) continue;
    if (wantBullish ? zone.top >= c.close : zone.bottom <= c.close) continue;
    if (isFvg && !fvgOk) {
      fvgOk = true;
      fvgReason = `Fresh FVG ${zone.bottom.toFixed(2)}–${zone.top.toFixed(2)} waiting for retracement.`;
    }
    if (!isFvg && !obOk) {
      obOk = true;
      obReason = `Fresh OB ${zone.bottom.toFixed(2)}–${zone.top.toFixed(2)} waiting for retracement.`;
    }
  }
  push("fvg", "FVG (entry zone)", true, fvgOk, fvgReason);
  push("orderBlock", "Order block (entry zone)", true, obOk, obReason);

  const smtAligned = side ? (wantBullish ? ctx.smtBullishAt(i) : ctx.smtBearishAt(i)) : false;
  push("smt", "SMT divergence (companion)", false, smtAligned,
    smtAligned ? "Companion SMT divergence aligned within the 20-bar window." : "No aligned SMT divergence — optional confirmation, never required.");

  // per-model outcome for the "what blocked each model" footer
  const perModel: ProbeResult["perModel"] = [];
  if (atrI > 0 && side && cfg.models.length > 0) {
    const cooldown: CooldownState = { usedSweepKeys: new Set(), blacklistedZones: new Set(), lastSignalIndex: -Infinity };
    for (const model of MODEL_ORDER) {
      if (!cfg.models.includes(model)) continue;
      const r = evaluateModel(ctx, i, cfg, cooldown, model, side, wantBullish, bias, ctx.volRegimes[i], ctx.regime.regimeAt(i), session, range, atrI);
      perModel.push({ model, rejection: r.rejection });
    }
  }

  // what must happen next — the first failed CORE conditions in chain order
  const waitingFor: string[] = [];
  if (!side) {
    waitingFor.push("A 4H/1H structure break to establish directional bias");
  } else {
    if (!sweepOk) waitingFor.push(`${wantBullish ? "Sell-side (low)" : "Buy-side (high)"} liquidity sweep with rejection`);
    if (!structure) waitingFor.push(`${wantBullish ? "Bullish" : "Bearish"} MSS/CHOCH`);
    if (!dispOk) waitingFor.push("Displacement leg");
    if (!fvgOk && !obOk) waitingFor.push("Fresh FVG/OB created by the displacement leg");
    else waitingFor.push("Retracement into the entry zone");
  }

  return { side, conditions, waitingFor, perModel, barTime: c.time };
}

function buildSample(
  ctx: SeriesContext,
  i: number,
  cfg: EngineConfig,
  model: ModelKey,
  side: Side,
  rejection: RejectionCode,
  partial: NonNullable<ModelEval["partial"]>,
  session: string
): RejectedSetupSample {
  const { candles } = ctx;
  const win = 20;
  const from = Math.max(0, i - win);
  const to = Math.min(candles.length - 1, i + win);
  const window: RejectedSetupSample["candles"] = [];
  for (let k = from; k <= to; k++) {
    const cc = candles[k];
    window.push({ t: cc.time, o: cc.open, h: cc.high, l: cc.low, c: cc.close });
  }
  return {
    time: candles[i].time,
    index: i,
    model,
    side,
    rejection,
    stageReached: STAGE_LABELS[rejection],
    session,
    entry: partial.entry !== null ? round2(partial.entry) : null,
    initialStop: partial.initialStop !== null ? round2(partial.initialStop) : null,
    target: partial.target,
    rr: partial.rr,
    maxRrAvailable: partial.maxRr,
    score: partial.score,
    trace: null, // trace is built only for valid candidates; partial info lives in the fields above
    candles: window,
    candleStartIndex: from,
  };
}

// ---------------------------------------------------------------------------
// Scoring model (spec #18) — six capped categories
// ---------------------------------------------------------------------------

export function scoreSetup(args: {
  cfg: EngineConfig;
  side: Side;
  bias: Trend;
  depth01: number;
  /** null for Model B (continuation has no sweep) */
  sweep: { assessment: SweepAssessment; age: number } | null;
  structureType: "BOS" | "MSS";
  structureAge: number;
  dispQuality: number;
  zoneKind: "FVG" | "OB" | "FVG+OB";
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
    depth01, sweep, structureType, structureAge, dispQuality,
    zoneKind, zoneQuality, zoneFresh, inKillzone, sweepInKillzone,
    smtAligned, rrToFinal, stopStructural, targetStructural, cfg,
  } = args;

  // CONTEXT (cap 20): HTF bias is a hard gate (all survivors aligned) → 12;
  // dealing-range depth of the entry zone → up to 8
  const context = 12 + Math.round(4 + depth01 * 4);

  // LIQUIDITY (cap 20): sweep quality ≤12, recency ≤4, close-back ≤4.
  // Continuation candidates score on structure recency + displacement instead.
  let liquidity: number;
  if (sweep) {
    const recency = Math.max(0, 1 - sweep.age / cfg.maxSweepAgeBars);
    liquidity = Math.min(
      20,
      Math.round(sweep.assessment.quality * 12 + recency * 4 + (sweep.assessment.closeBackRatio >= 0.7 ? 4 : 2))
    );
  } else {
    const structureRecency = Math.max(0, 1 - structureAge / cfg.maxStructureAgeBars);
    liquidity = Math.min(20, Math.round(structureRecency * 8 + dispQuality * 12));
  }

  // STRUCTURE (cap 20): MSS 12 / BOS 8, displacement quality ≤8
  const structure = Math.min(20, (structureType === "MSS" ? 12 : 8) + Math.round(dispQuality * 8));

  // ENTRY (cap 20): zone kind ≤10 (FVG 8 / OB 6 / FVG+OB overlap 10),
  // zone quality ≤4, freshness ≤4, size sanity folded into quality.
  const entry = Math.min(
    20,
    Math.round((zoneKind === "FVG+OB" ? 10 : zoneKind === "FVG" ? 8 : 6) + zoneQuality * 4 + (zoneFresh ? 4 : 2) + (zoneQuality >= 0.8 ? 2 : 0))
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
