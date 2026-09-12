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
  /** what the second series actually is (e.g. "AUD/USD (gold-proxy FX)" or "XAG/USD") */
  companionLabel?: string;
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
  /** which ICT entry model produced this setup (spec §6) */
  model: ModelKey;
  entry: number; // limit order (proximal edge of the entry zone)
  initialStop: number;
  riskPerUnit: number; // |entry − initialStop|, price units
  events: SetupEvent[]; // ordered, timestamped chain
  confluence: ConfluenceTrace; // per-condition traceability (spec §3)
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
  /** bars from fill to each TP hit — null when that TP never hit (target realism) */
  barsToTp1: number | null;
  barsToTp2: number | null;
  barsToTp3: number | null;
  /** true when the entry filled only because the tolerance margin was applied */
  toleranceFill: boolean;

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
  model: ModelKey; // which ICT entry model produced the trade (spec §7)
  confluence: ConfluenceTrace; // full per-condition trace (spec §3)
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
  /** null when 0 trades — displayed as N/A, never 0% */
  winRate: number | null;
  grossR: number;
  costsR: number;
  netR: number;
  /** null when 0 trades (spec §14) */
  expectancyR: number | null; // net of costs
  expectancyGrossR: number | null; // before costs (spec §14)
  avgWinR: number;
  avgLossR: number;
  /** null when the sample has NO losing trades — "99" is banned (spec §13) */
  profitFactor: number | null; // net
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

// ---------------------------------------------------------------------------
// Spec §1–§7 diagnostics: setup models, traceable confluence, rejection
// accounting, signal-funnel stages, RR + session filter diagnostics.
// ---------------------------------------------------------------------------

/** Distinct ICT entry models (spec §6). Each has its own required chain. */
export type ModelKey =
  | "A_SWEEP_REVERSAL" //   HTF → sweep → MSS → displacement → FVG retracement
  | "B_FVG_CONTINUATION" // HTF → displacement → BOS → FVG retracement
  | "C_OB_REVERSAL" //      HTF → sweep → MSS → displacement → OB retracement
  | "D_FVG_OB_CONFLUENCE" //sweep → MSS → displacement → FVG+OB overlap
  | "E_SMT_REVERSAL"; //    SMT → sweep → MSS → displacement → FVG/OB

export const MODEL_LABELS: Record<ModelKey, string> = {
  A_SWEEP_REVERSAL: "A · Sweep Reversal (FVG)",
  B_FVG_CONTINUATION: "B · FVG Continuation (BOS)",
  C_OB_REVERSAL: "C · OB Reversal",
  D_FVG_OB_CONFLUENCE: "D · FVG + OB Confluence",
  E_SMT_REVERSAL: "E · SMT Reversal",
};

/** Rejection categories (spec §2) — PRIMARY reason per rejected opportunity. */
export type RejectionCode =
  | "NO_HTF_BIAS"
  | "WRONG_PREMIUM_DISCOUNT"
  | "NO_LIQUIDITY"
  | "NO_LIQUIDITY_SWEEP"
  | "WEAK_SWEEP"
  | "NO_MSS"
  | "WEAK_MSS"
  | "NO_DISPLACEMENT"
  | "WEAK_DISPLACEMENT"
  | "NO_FVG"
  | "INVALID_FVG"
  | "NO_ORDER_BLOCK"
  | "INVALID_ORDER_BLOCK"
  | "NO_RETRACEMENT"
  | "OUTSIDE_SESSION"
  | "SMT_REQUIRED_BUT_MISSING"
  | "INVALID_STOP"
  | "EXCESSIVE_COST"
  | "INSUFFICIENT_RR"
  | "DUPLICATE_SETUP"
  | "COOLDOWN"
  | "SETUP_EXPIRED"
  // supplementary codes (not in the spec's minimum list, needed for honesty)
  | "REGIME_UNCLEAR"
  | "VOL_BLOCKED"
  | "NO_STRUCTURAL_TARGET"
  | "SCORE_BELOW_TIER";

export const REJECTION_LABELS: Record<RejectionCode, string> = {
  NO_HTF_BIAS: "No HTF bias",
  WRONG_PREMIUM_DISCOUNT: "Wrong premium/discount half",
  NO_LIQUIDITY: "No liquidity levels available",
  NO_LIQUIDITY_SWEEP: "No liquidity sweep",
  WEAK_SWEEP: "Weak sweep (no rejection / shallow)",
  NO_MSS: "No MSS/CHOCH",
  WEAK_MSS: "MSS too old (outside window)",
  NO_DISPLACEMENT: "No displacement",
  WEAK_DISPLACEMENT: "Weak displacement",
  NO_FVG: "No FVG in sequence",
  INVALID_FVG: "FVG invalid (mitigated / consumed / stale)",
  NO_ORDER_BLOCK: "No order block in sequence",
  INVALID_ORDER_BLOCK: "OB invalid (mitigated / consumed / stale)",
  NO_RETRACEMENT: "No valid retracement (zone already consumed)",
  OUTSIDE_SESSION: "Outside selected sessions",
  SMT_REQUIRED_BUT_MISSING: "SMT required but missing",
  INVALID_STOP: "Invalid structural stop (too tight/wide)",
  EXCESSIVE_COST: "Round-trip cost above gate (share of 1R)",
  INSUFFICIENT_RR: "Insufficient RR",
  DUPLICATE_SETUP: "Duplicate setup (event already traded)",
  COOLDOWN: "Cooldown (too soon after last signal)",
  SETUP_EXPIRED: "Setup expired (order unfilled)",
  REGIME_UNCLEAR: "Market regime UNCLEAR",
  VOL_BLOCKED: "Volatility regime blocked",
  NO_STRUCTURAL_TARGET: "No structural target available",
  SCORE_BELOW_TIER: "Score below tier threshold",
};

/** One traceable confluence condition (spec §3). */
export interface ConfluenceItem {
  detected: boolean;
  /** event timestamp (unix sec) when applicable */
  timestamp: number | null;
  /** price or level when applicable */
  price: number | null;
  /** human-readable range (e.g. "4400.1–4403.8") when applicable */
  range: string | null;
  /** timeframe the condition was measured on */
  timeframe: string;
  /** WHY it was true/false — never a bare boolean */
  reason: string;
}

export interface ConfluenceTrace {
  htfBias: ConfluenceItem;
  dealingRange: ConfluenceItem;
  premiumDiscount: ConfluenceItem;
  liquidityPool: ConfluenceItem;
  liquiditySweep: ConfluenceItem;
  mss: ConfluenceItem;
  displacement: ConfluenceItem;
  fvg: ConfluenceItem;
  orderBlock: ConfluenceItem;
  session: ConfluenceItem;
  smt: ConfluenceItem;
  structuralStop: ConfluenceItem;
  structuralTarget: ConfluenceItem;
  rr: ConfluenceItem;
  score: ConfluenceItem;
}

/** Per-model opportunity/rejection accounting (spec §2, §7). */
export interface ModelStat {
  model: ModelKey;
  opportunities: number; // model evaluated on a bar with context OK
  rejections: Partial<Record<RejectionCode, number>>;
  validSetups: number; // passed every gate (before cooldown/tier)
  orders: number;
  fills: number;
  trades: number;
  wins: number;
  winRate: number | null;
  expectancyR: number | null;
  profitFactor: number | null; // null when no losing trades
  maxDrawdownR: number;
  netR: number;
}

/** RR-filter diagnostics (spec §9) — counted BEFORE the minRR gate applies. */
export interface RrDiagnostics {
  evaluated: number; // candidates that reached the target stage
  beforeFilter: number; // with a structural target ladder at all
  ge1_5: number;
  ge2: number;
  ge2_5: number;
  ge3: number;
  medianMaxRr: number | null;
  /** median RR to the NEAREST structural level (TP1) — the realistic target */
  medianTp1Rr: number | null;
  /** median RR to the farthest level WITHIN the horizon cap (TP3) */
  medianTp3Rr: number | null;
  /** levels excluded from the execution ladder by the horizon cap */
  targetsCapped: number;
  /** sample of max available RR values (capped length, for the histogram) */
  sample: number[];
  /** sample of RR-to-TP1 values (capped length) */
  tp1Sample: number[];
  /** sample of RR-to-TP3 values (capped length) */
  tp3Sample: number[];
}

/** Session-filter diagnostics (spec §10) — setups counted with NO session gate. */
export interface SessionDiagnostics {
  /** fully-valid setups per session key, counted as if all sessions allowed */
  bySession: { session: string; label: string; setups: number }[];
  note: string;
}

/** Data-quality audit of the fetched history (spec §18). */
export interface DataQuality {
  bars: number;
  duplicates: number;
  outOfOrder: number;
  gaps: number;
  invalidOhlc: number;
  largestGapBars: number;
  /** weekend candles dropped before the run (dead-market protection) */
  weekendCandles: number;
  ok: boolean;
  note: string;
  // fetch accounting — how much of the requested window actually arrived
  requestedBars?: number;
  rawFetched?: number;
  fetchRequests?: number;
  /** > 0 when the upstream delivered meaningfully less than requested */
  fetchShortfallPct?: number;
}

/**
 * Pending-order telemetry (what happened between "order placed" and
 * "filled / expired"). The trading semantics stay identical — the extra
 * observation window (48 bars) only measures what WOULD have happened.
 */
export interface OrderFlowSummary {
  placed: number;
  filled: number;
  expired: number;
  invalidated: number;
  /** orders whose entry WAS touched after the configured expiry window */
  lateFills: number;
  /** bars from decision to fill, bucketed, for FILLED orders */
  fillLatency: { le3: number; le6: number; le12: number; le24: number; le48: number };
  /** cumulative fill rate if the expiry window were 6/12/24/48 bars */
  fillRateAt: { bars6: number | null; bars12: number | null; bars24: number | null; bars48: number | null };
  /** expired orders: how close price came to the entry (in R), median */
  medianClosestApproachR: number | null;
  /** fills that happened only because the entry-tolerance margin was applied */
  toleranceFills: number;
  note: string;
}

/** Order-Block creation pipeline — where Model C/D candidates actually die. */
export interface ObPipeline {
  /** OB zones created by the detector over the whole series */
  zonesCreated: number;
  /** of those, invalidated (close through midpoint) anywhere in the series */
  zonesInvalidated: number;
  /** OBs encountered inside candidate zone windows (before skip reasons) */
  windowSeen: number;
  skippedMitigated: number;
  skippedPosition: number; // limit would cross / zone consumed by price
  skippedSweepExtreme: number; // insane vs the swept extreme
  skippedBlacklist: number; // same-zone cooldown after a loss
  /** candidates left with ≥1 usable OB in window (post-skip) */
  candidatesWithOb: number;
  /** candidates that passed every gate per Model C (context) */
  modelCValidSetups: number;
  /** active creation threshold (displacement body ≥ factor × per-bar ATR) */
  displacementFactor: number;
  note: string;
}

/** Performance of one SMT-alignment cohort (validated only when SMT is live). */
export interface SmtSplitStat {
  trades: number;
  winRate: number | null;
  expectancyR: number | null;
  netR: number;
}

/**
 * Does the +5 SMT confluence bonus actually separate outcomes? Split of
 * CLOSED trades by whether a live SMT divergence was aligned at entry.
 * null when no live companion ran — a split without SMT data would be noise.
 */
export interface SmtSplit {
  live: boolean;
  aligned: SmtSplitStat;
  notAligned: SmtSplitStat;
  note: string;
}

/** A rejected opportunity snapshot kept for the UI inspector (spec §19). */
export interface RejectedSetupSample {
  time: number;
  index: number;
  model: ModelKey;
  side: Side;
  rejection: RejectionCode;
  stageReached: string;
  session: string;
  entry: number | null;
  initialStop: number | null;
  target: number | null;
  rr: number | null;
  maxRrAvailable: number | null;
  score: number | null;
  trace: ConfluenceTrace | null;
  /** compact candle window around the decision bar for mini-chart rendering */
  candles: { t: number; o: number; h: number; l: number; c: number }[];
  candleStartIndex: number;
}

/** Strategy-state panel for the live "WHY NO TRADE?" view (spec §4). */
export interface WhyNoTradeCondition extends ConfluenceItem {
  label: string;
  core: boolean; // core requirement (§5) vs optional confluence
}

export interface WhyNoTradeState {
  side: "LONG" | "SHORT" | null; // direction the next setup would need
  conditions: WhyNoTradeCondition[]; // ordered checklist
  waitingFor: string[]; // ordered list of what must happen next
  evaluatedAt: number;
  barTime: number | null;
}
