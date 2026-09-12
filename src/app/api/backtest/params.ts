// Shared backtest parameter parsing — one source of truth for the GET route
// (TwelveData runs) and the POST /api/backtest/csv route (uploaded-history
// runs), so both endpoints validate identically and rows stay comparable.
import type { EngineConfig, Strictness } from "@/lib/ict/sequence";
import { DEFAULT_COSTS } from "@/lib/ict/costs";
import { isIntervalKey, isSymbolKey } from "@/lib/market";
import type { SymbolKey, IntervalKey } from "@/lib/market/types";

export const BE_MODES = ["off", "tp1", "tp1cost", "risk1", "structural"];
export const AMBIGUITY_MODES = ["pessimistic", "optimistic", "randomized", "ltf"];
export const SESSION_KEYS = ["asia", "london", "ny-am", "ny-pm", "london-close"];
export const STRICTNESS_LEVELS = ["conservative", "balanced", "aggressive"];
export const COMPARE_DIMENSIONS = ["strictness", "expiry", "sessions", "entry", "be", "obInvalidation", "obDisplacement"];
export const OB_INVALIDATION_MODES = ["close-mid", "wick-mid", "close-distal", "wick-distal"];
export const DEBUG_STAGES = ["fetch", "smt", "core"];

export interface BacktestParams {
  symbol: SymbolKey;
  interval: IntervalKey;
  bars: number;
  minRR: number;
  beMode: string;
  ambiguity: string;
  seed: number;
  sessions: string[];
  strictness: Strictness;
  entryAnchor: string;
  entryTolerance: number;
  costGate: number;
  horizon: number;
  obInvalidation: string;
  obDisp: number;
  tierB: number;
  spread: string | null;
  slip: string | null;
  commBp: string | null;
  compare: boolean;
  compareDim: string;
  sensitivity: string;
  stage: string;
  trim: boolean;
  smtOff: boolean;
  compact: boolean;
  tradeDetail: string | null;
  /** builds the shared EngineConfig overrides for every run in one request */
  buildConfig: (over?: Partial<EngineConfig>) => Partial<EngineConfig>;
}

type ParseOk = { ok: true; params: BacktestParams };
type ParseErr = { ok: false; error: string };

/**
 * Parse + validate the backtest query string.
 *  - requireBars (GET): bars is mandatory and bounded 400..25000.
 *    CSV route omits it — the uploaded file defines the window.
 *  - requireInterval (GET): interval is a validated IntervalKey.
 *    CSV route omits it — the interval is detected from the candle spacing.
 */
export function parseBacktestParams(
  searchParams: URLSearchParams,
  opts: { requireBars?: boolean; requireInterval?: boolean } = { requireBars: true, requireInterval: true }
): ParseOk | ParseErr {
  const { requireBars = true, requireInterval = true } = opts;
  const symbol = searchParams.get("symbol") ?? "XAUUSD";
  const intervalRaw = searchParams.get("interval") ?? "15min";
  const bars = Number(searchParams.get("bars") ?? 1500);
  const minRR = Number(searchParams.get("minRR") ?? 2.0);
  const beMode = searchParams.get("beMode") ?? "tp1";
  const ambiguity = searchParams.get("ambiguity") ?? "pessimistic";
  const seed = Number(searchParams.get("seed") ?? 42);
  const sessionsParam = searchParams.get("sessions") ?? "";
  const strictnessParam = searchParams.get("strictness") ?? "balanced";
  const entryAnchorParam = searchParams.get("entryAnchor") ?? "edge";
  const entryToleranceParam = Number(searchParams.get("entryTolerance") ?? "0.05");
  const costGateParam = Number(searchParams.get("costGate") ?? "0.35");
  const horizonParam = Number(searchParams.get("horizon") ?? "8");
  const obInvalidationParam = searchParams.get("obInvalidation") ?? "close-mid";
  const obDispParam = Number(searchParams.get("obDisp") ?? "1.2");
  const tierBParam = Number(searchParams.get("tierB") ?? "70");
  const spreadParam = searchParams.get("spread");
  const slipParam = searchParams.get("slip");
  const commBpParam = searchParams.get("commBp");
  const compare = searchParams.get("compare") === "1";
  const compareDimParam = searchParams.get("compareDim") ?? "strictness";
  const sensitivityParam = searchParams.get("sensitivity") ?? "";
  const stageParam = searchParams.get("stage") ?? "";
  const trimParam = searchParams.get("trim") === "1";
  const smtOffParam = searchParams.get("smt") === "0";
  const compactParam = searchParams.get("compact") === "1";
  const tradeDetailParam = searchParams.get("tradeDetail");

  if (!isSymbolKey(symbol)) return { ok: false, error: "Unknown symbol" };
  if (requireInterval && !isIntervalKey(intervalRaw)) return { ok: false, error: "Unknown interval" };
  if (requireBars && (!Number.isFinite(bars) || bars < 400 || bars > 25000)) {
    return { ok: false, error: "bars must be between 400 and 25000 (windows above 5000 are assembled from paginated chunks)" };
  }
  if (!requireBars && searchParams.get("bars") !== null && (!Number.isFinite(bars) || bars < 50 || bars > 25000)) {
    return { ok: false, error: "bars must be between 50 and 25000 (CSV runs default to the full uploaded window)" };
  }
  if (!Number.isFinite(minRR) || minRR < 0.5 || minRR > 10) {
    return { ok: false, error: "minRR must be between 0.5 and 10" };
  }
  if (!BE_MODES.includes(beMode)) return { ok: false, error: "Unknown beMode" };
  if (!AMBIGUITY_MODES.includes(ambiguity)) return { ok: false, error: "Unknown ambiguity model" };
  if (!STRICTNESS_LEVELS.includes(strictnessParam)) return { ok: false, error: "Unknown strictness preset" };
  if (!COMPARE_DIMENSIONS.includes(compareDimParam)) {
    return { ok: false, error: "Unknown compareDim (strictness|expiry|sessions|entry|be|obInvalidation)" };
  }
  if (!OB_INVALIDATION_MODES.includes(obInvalidationParam)) {
    return { ok: false, error: "obInvalidation must be close-mid|wick-mid|close-distal|wick-distal" };
  }
  if (!Number.isFinite(obDispParam) || obDispParam < 0.5 || obDispParam > 3) {
    return { ok: false, error: "obDisp must be between 0.5 and 3 (ATR multiples for OB creation)" };
  }
  if (spreadParam !== null && (!Number.isFinite(Number(spreadParam)) || Number(spreadParam) < 0 || Number(spreadParam) > 10)) {
    return { ok: false, error: "spread must be between 0 and 10 (price units)" };
  }
  if (slipParam !== null && (!Number.isFinite(Number(slipParam)) || Number(slipParam) < 0 || Number(slipParam) > 5)) {
    return { ok: false, error: "slip must be between 0 and 5 (price units per side)" };
  }
  if (commBpParam !== null && (!Number.isFinite(Number(commBpParam)) || Number(commBpParam) < 0 || Number(commBpParam) > 20)) {
    return { ok: false, error: "commBp must be between 0 and 20 (basis points per side)" };
  }
  if (!Number.isFinite(tierBParam) || tierBParam < 60 || tierBParam > 90) {
    return { ok: false, error: "tierB must be between 60 and 90" };
  }
  if (entryAnchorParam !== "edge" && entryAnchorParam !== "midpoint") {
    return { ok: false, error: "entryAnchor must be edge|midpoint" };
  }
  if (!Number.isFinite(entryToleranceParam) || entryToleranceParam < 0 || entryToleranceParam > 0.5) {
    return { ok: false, error: "entryTolerance must be between 0 and 0.5" };
  }
  if (!Number.isFinite(costGateParam) || costGateParam < 0 || costGateParam > 2) {
    return { ok: false, error: "costGate must be between 0 (off) and 2" };
  }
  if (!Number.isFinite(horizonParam) || horizonParam < 0 || horizonParam > 50) {
    return { ok: false, error: "horizon must be between 0 (off) and 50" };
  }

  const sessions = sessionsParam
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== "any" && SESSION_KEYS.includes(s));

  // one config builder — every run in this request (main, sensitivity,
  // comparisons) MUST share identical knobs so rows are comparable
  const buildConfig = (over: Partial<EngineConfig> = {}): Partial<EngineConfig> => {
    const cfg: Partial<EngineConfig> = {
      minRR,
      beMode: beMode as never,
      ambiguity: ambiguity as never,
      randomSeed: Number.isFinite(seed) ? seed : 42,
      sessions,
      entryAnchor: entryAnchorParam as never,
      entryToleranceR: entryToleranceParam,
      maxCostPctOfR: costGateParam,
      targetHorizonR: horizonParam,
      obInvalidation: obInvalidationParam as never,
      obDisplacementFactor: obDispParam,
      tierB: tierBParam,
      ...over,
    };
    if (spreadParam !== null || slipParam !== null || commBpParam !== null) {
      const base = DEFAULT_COSTS[symbol as keyof typeof DEFAULT_COSTS];
      cfg.costs = {
        ...DEFAULT_COSTS,
        [symbol]: {
          spread: spreadParam !== null ? Number(spreadParam) : base?.spread ?? 0,
          slippagePerSide: slipParam !== null ? Number(slipParam) : base?.slippagePerSide ?? 0,
          commissionPctPerSide: commBpParam !== null ? Number(commBpParam) / 1e4 : base?.commissionPctPerSide ?? 0,
        },
      } as never;
    }
    return cfg;
  };

  return {
    ok: true,
    params: {
      symbol,
      interval: intervalRaw as IntervalKey,
      bars,
      minRR,
      beMode,
      ambiguity,
      seed: Number.isFinite(seed) ? seed : 42,
      sessions,
      strictness: strictnessParam as Strictness,
      entryAnchor: entryAnchorParam,
      entryTolerance: entryToleranceParam,
      costGate: costGateParam,
      horizon: horizonParam,
      obInvalidation: obInvalidationParam,
      obDisp: obDispParam,
      tierB: tierBParam,
      spread: spreadParam,
      slip: slipParam,
      commBp: commBpParam,
      compare,
      compareDim: compareDimParam,
      sensitivity: sensitivityParam,
      stage: stageParam,
      trim: trimParam,
      smtOff: smtOffParam,
      compact: compactParam,
      tradeDetail: tradeDetailParam,
      buildConfig,
    },
  };
}
