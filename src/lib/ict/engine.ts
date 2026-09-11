// Analysis engine — orchestrates swing/structure/FVG/OB/liquidity/range/killzone
// modules into a single AnalysisSnapshot for a symbol+interval.
import "server-only";
import { getCandles } from "@/lib/market";
import type { IntervalKey, SymbolKey } from "@/lib/market/types";
import { atr, findSwings } from "./swings";
import { analyzeStructure } from "./structure";
import { detectFvg, detectOrderBlocks } from "./zones";
import { detectLiquidityPools, detectSweeps } from "./liquidity";
import { activeKillzone, computeDealingRange } from "./range";
import type { AnalysisSnapshot } from "./types";

const HTF_MAP: Record<IntervalKey, IntervalKey> = {
  "5min": "1h",
  "15min": "4h",
  "1h": "4h",
  "4h": "1day",
  "1day": "1day",
};

export async function analyze(
  symbol: SymbolKey,
  interval: IntervalKey,
  outputsize = 300
): Promise<{ snapshot: AnalysisSnapshot; htfTrend: AnalysisSnapshot["structure"]["trend"] }> {
  const { candles, source } = await getCandles(symbol, interval, outputsize);
  const { candles: htfCandles } = await getCandles(symbol, HTF_MAP[interval], 200);

  if (candles.length < 30) {
    throw new Error("Insufficient candles for analysis");
  }

  const atrValue = atr(candles, 14);
  const structure = analyzeStructure(candles, 2);
  const htfStructure = analyzeStructure(htfCandles, 2);
  const fvg = detectFvg(candles, 8, false);
  const orderBlocks = detectOrderBlocks(candles, atrValue, 1.8, 6, false);
  const sweeps = detectSweeps(candles);
  const pools = detectLiquidityPools(candles);
  const range = computeDealingRange(candles);
  const killzone = activeKillzone();

  const snapshot: AnalysisSnapshot = {
    symbol,
    interval,
    source,
    generatedAt: Date.now(),
    lastPrice: candles[candles.length - 1].close,
    structure,
    fvg,
    orderBlocks,
    sweeps,
    pools,
    range,
    killzone,
    atr: atrValue,
  };

  return { snapshot, htfTrend: htfStructure.trend };
}

export { findSwings };
