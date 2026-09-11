// ICT / Smart Money Concepts core types and analysis results.
// Pure TypeScript — safe to import on both server and client.

import type { Candle, DataSource } from "@/lib/market/types";

// Re-export market primitives so every engine module can import them from
// this single pure entry point.
export type { Candle, DataSource };
export type { SymbolKey, IntervalKey } from "@/lib/market/types";

export type Trend = "BULLISH" | "BEARISH" | "NEUTRAL";

export interface Swing {
  index: number;
  time: number;
  price: number;
  type: "HIGH" | "LOW";
}

export interface StructureEvent {
  index: number;
  time: number;
  type: "BOS" | "MSS";
  direction: "BULLISH" | "BEARISH";
  /** the swing level that was broken */
  level: number;
}

export interface StructureResult {
  trend: Trend;
  events: StructureEvent[];
  lastSwingHigh: Swing | null;
  lastSwingLow: Swing | null;
}

export interface Zone {
  id: string;
  top: number;
  bottom: number;
  /** candle time where the zone originated */
  startTime: number;
  /** index of originating candle */
  startIndex: number;
  kind: "FVG" | "OB";
  direction: "BULLISH" | "BEARISH";
  mitigated: boolean;
}

export interface LiquiditySweep {
  index: number;
  time: number;
  side: "BUY_SIDE" | "SELL_SIDE";
  /** the liquidity level that was swept */
  level: number;
  /** the candle's extreme (wick) that took the level */
  extreme: number;
  close: number;
  label: string;
}

export interface LiquidityPool {
  time: number;
  price: number;
  type: "EQH" | "EQL";
}

export interface DealingRange {
  high: number;
  low: number;
  equilibrium: number;
  zone: "PREMIUM" | "DISCOUNT" | "EQUILIBRIUM";
  positionPct: number;
  oteTop: number;
  oteBottom: number;
}

export interface KillzoneInfo {
  key: string;
  name: string;
  startUtc: string;
  endUtc: string;
  active: boolean;
  description: string;
}

export interface AnalysisSnapshot {
  symbol: string;
  interval: string;
  source: DataSource;
  generatedAt: number;
  lastPrice: number;
  structure: StructureResult;
  fvg: Zone[];
  orderBlocks: Zone[];
  sweeps: LiquiditySweep[];
  pools: LiquidityPool[];
  range: DealingRange | null;
  killzone: KillzoneInfo | null;
  atr: number;
}

export interface SignalCandidate {
  id: string;
  symbol: string;
  interval: string;
  side: "LONG" | "SHORT";
  entry: number;
  stopLoss: number;
  targets: number[];
  targetSources: string[];
  rrToTarget2: number;
  rrToFinal: number;
  confidence: number;
  grade: "A" | "B" | "C";
  tier: Tier;
  scores: CategoryScores;
  sequence: SetupEvent[];
  volRegime: VolatilityRegime;
  mktRegime: MarketRegime;
  rationale: string[];
  htfTrend: Trend;
  createdAt: number;
  killzone: string | null;
  smtAligned: boolean;
}

export interface SmtDivergence {
  type: "BULLISH" | "BEARISH";
  windowStart: number;
  windowEnd: number;
  goldDescription: string;
  silverDescription: string;
  detail: string;
}

export interface SmtResult {
  divergences: SmtDivergence[];
  goldSource: DataSource;
  silverSource: DataSource;
  note: string;
}

// ---------------------------------------------------------------------------
// Engine v2 — quality-scored ICT setups, honest trade accounting and
// statistical validation. Shared by the live signal generator and the
// backtester so live signals and historical replay use identical logic.
// ---------------------------------------------------------------------------

export type Side = "LONG" | "SHORT";

export type Tier = "A+" | "A" | "B" | "NO_TRADE";

export type SessionKey =
  | "asia"
  | "london"
  | "ny-am"
  | "london-close"
  | "ny-pm"
  | "off-session";

export type VolatilityRegime = "LOW" | "NORMAL" | "HIGH" | "EXTREME";

export type MarketRegime =
  | "TREND_UP"
  | "TREND_DOWN"
  | "RANGE"
  | "EXPANSION"
  | "CONSOLIDATION"
  | "UNCLEAR";

export type BreakevenMode = "off" | "tp1" | "risk1" | "structural";

export type AmbiguityModel = "pessimistic" | "optimistic" | "randomized" | "ltf";

/** Separated trading costs in PRICE units (e.g. USD per ounce). */
export interface CostModel {
  /** full bid/ask spread in price units */
  spread: number;
  /** slippage per fill side in price units */
  slippagePerSide: number;
  /** commission as fraction of price per side (e.g. 0.00002 = 0.2 bp) */
  commissionPctPerSide: number;
}

/** Categorized 0–100 scoring (spec #18). Each category is capped independently. */
export interface CategoryScores {
  context: number; // HTF bias, dealing range, premium/discount — cap 20
  liquidity: number; // pool quality, sweep quality/recency — cap 20
  structure: number; // MSS/BOS, displacement — cap 20
  entry: number; // FVG/OB quality, retracement — cap 20
  confirmation: number; // SMT, kill zone — cap 10
  risk: number; // structural SL/target, RR — cap 10
}

export type SetupEventKind =
  | "HTF_BIAS"
  | "PREMIUM_DISCOUNT"
  | "LIQUIDITY_SWEEP"
  | "DISPLACEMENT"
  | "MSS"
  | "BOS"
  | "ZONE_CREATED"
  | "ENTRY_RETRACE";

/** One step of the required setup sequence, with its timestamp (spec #6/#7). */
export interface SetupEvent {
  kind: SetupEventKind;
  index: number;
  time: number;
  detail: string;
}

export interface SetupZoneInfo {
  id: string;
  kind: "FVG" | "OB";
  direction: "BULLISH" | "BEARISH";
  top: number;
  bottom: number;
  createdIndex: number;
  quality: number; // 0–1
  notes: string[];
}

/** A fully-qualified, sequence-verified setup decided on bar close `index`. */
export interface Setup {
  side: Side;
  decidedIndex: number;
  decidedTime: number;
  entry: number; // limit order (proximal edge of the entry zone)
  initialStop: number;
  riskPerUnit: number; // |entry − initialStop|, price units
  events: SetupEvent[]; // ordered, timestamped chain
  zone: SetupZoneInfo;
  targets: { price: number; source: string; rr: number }[]; // structural ladder
  rrToFinal: number;
  rrToTp1: number;
  scores: CategoryScores;
  totalScore: number;
  tier: Tier;
  session: SessionKey;
  htfBias: Trend;
  volRegime: VolatilityRegime;
  mktRegime: MarketRegime;
  smtAligned: boolean;
  sweepKey: string; // identity of the liquidity event (one trade per event)
  rationale: string[];
  rejections: string[]; // why this setup would be NO_TRADE (if it is)
}

export type OutcomeKind =
  | "TP3"
  | "TP2_TP1"
  | "TP1_BE"
  | "TP1_TIMEOUT"
  | "TP1_STRUCT_BE"
  | "SL"
  | "BE_STOP"
  | "TIMEOUT_WIN"
  | "TIMEOUT_LOSS"
  | "EOD";

/** One weighted partial exit (spec #3: legs are accounted separately). */
export interface TradeLeg {
  label: "TP1" | "TP2" | "TP3" | "INITIAL_SL" | "BREAKEVEN_STOP" | "STRUCTURE_STOP" | "TIMEOUT" | "END_OF_DATA";
  share: number; // fraction of the ORIGINAL position closed on this leg
  exitIndex: number;
  exitTime: number;
  exitPrice: number;
  grossR: number; // signed price move / initial risk (before costs)
  costR: number; // attributable costs in R (spread + slippage + commission)
  netR: number;
}

/** Per-trade lifecycle audit trail (spec #1). */
export interface AuditLine {
  time: number;
  event: string;
  detail: string;
}

/** A completed, fully-accounted trade. `stop` is the INITIAL stop, always. */
export interface TradeRecord {
  id: string;
  symbol: string;
  interval: string;
  side: Side;
  tier: Tier;
  totalScore: number;
  scores: CategoryScores;

  // levels
  entry: number;
  initialStop: number;
  currentStop: number; // stop as of trade close (may equal breakeven)
  breakevenStop: number | null; // null when BE never activated
  finalExitPrice: number;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;

  // timing
  signalTime: number;
  orderPlacedTime: number;
  entryTime: number;
  entryIndex: number;
  exitTime: number;
  exitIndex: number;
  barsHeld: number;
  beActivatedTime: number | null;

  // risk & size (spec #3)
  riskPerUnit: number; // price units — initial entry→initialStop distance
  positionSizeUnits: number; // e.g. ounces (riskMoney / riskPerUnit)
  riskMoney: number; // 1R in account currency
  plannedRR: number;

  // accounting
  legs: TradeLeg[];
  grossR: number; // share-weighted gross
  costR: number; // total costs in R
  netR: number; // what the trade actually returned
  outcome: OutcomeKind;

  // excursion (spec #25) — signed: MFE ≥ 0, MAE ≤ 0
  mfeR: number;
  maeR: number;

  // context
  session: SessionKey;
  htfBias: Trend;
  volRegime: VolatilityRegime;
  mktRegime: MarketRegime;
  smtAligned: boolean;
  sweepKey: string;
  zoneId: string;
  zoneKind: "FVG" | "OB";
  rationale: string[];
  lossReasons: string[]; // diagnostics tags (populated for losers)
  audit: AuditLine[];
}

export interface BacktestMetricsV2 {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  grossR: number;
  costsR: number;
  netR: number;
  expectancyR: number; // net
  expectancyGrossR: number;
  avgWinR: number;
  avgLossR: number;
  profitFactor: number; // net
  maxDrawdownR: number;
  bestStreak: number;
  worstStreak: number;
  avgMfeWinners: number;
  avgMfeLosers: number;
  avgMaeWinners: number;
  avgMaeLosers: number;
}

export interface FunnelCounters {
  barsEvaluated: number;
  htfBiasOk: number;
  premiumDiscountOk: number;
  sweepFound: number;
  sweepQualityOk: number;
  displacementOk: number;
  structureOk: number;
  zoneFound: number;
  zoneQualityOk: number;
  rrOk: number;
  scoreOk: number;
  sessionOk: number;
  regimeOk: number;
  cooldownOk: number;
  ordersPlaced: number;
  ordersFilled: number;
  ordersExpired: number;
  tradesClosed: number;
}
