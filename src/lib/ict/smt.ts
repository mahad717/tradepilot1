// SMT (Smart Money Technique) divergence — live correlation study.
//
// When two correlated instruments (canonical metals pair: gold and silver)
// disagree at a structural swing (one prints a higher high while the other
// fails to), it suggests one market is being used for liquidity rather than
// genuine repricing — an ICT convergence signal.
//
// Companion priority: AUD/USD (LIVE on the free TwelveData plan, 15m return
// correlation vs gold ≈ 0.55) → XAG/USD (canonical, paid plan only →
// SIMULATED series, labelled illustrative).
import "server-only";
import { getCandles, getCompanionCandles, SMT_COMPANIONS } from "@/lib/market";
import type { DataSource, IntervalKey, SymbolKey } from "@/lib/market/types";
import type { Candle, SmtDivergence, SmtResult } from "./types";
import { findSwings } from "./swings";

/**
 * Compare the last two confirmed swing highs / lows of both metals inside
 * each lookback window. Divergences:
 *   BEARISH: gold HH + silver LH (or gold LH + silver HH) at highs
 *   BULLISH: gold LL + silver HL (or gold HL + silver LL) at lows
 */
export async function computeSmt(
  interval: IntervalKey,
  outputsize = 200,
  maxDivergences = 4
): Promise<SmtResult> {
  const gold = await getCandles("XAUUSD" as SymbolKey, interval, outputsize);
  // prefer the LIVE companion; fall back to (simulated) silver — both labelled
  const comp = await getCompanionCandles("XAUUSD", interval, outputsize).catch(() => null);
  const compUsable = comp && !comp.error && comp.candles.length > 40 ? comp : null;
  const silver = compUsable
    ? { candles: compUsable.candles, source: "LIVE" as DataSource }
    : await getCandles("XAGUSD" as SymbolKey, interval, outputsize);
  const compName = compUsable ? "AUD/USD" : "silver";

  const divergences = findDivergences(gold.candles, silver.candles, compName);
  const silverSource: DataSource = silver.source;

  return {
    divergences: divergences.slice(-maxDivergences),
    goldSource: gold.source,
    silverSource,
    companionLabel: compUsable ? SMT_COMPANIONS.XAUUSD.label : "XAG/USD (simulated)",
    note:
      compUsable && silverSource === "LIVE"
        ? `Live gold vs ${compName} (gold-proxy FX, 15m return correlation ≈ 0.55). Silver (XAG/USD) needs a paid TwelveData plan — AUD/USD is the strongest live companion available.`
        : silverSource === "SIMULATED"
          ? "The second series is SIMULATED (XAG/USD requires a TwelveData paid plan and the AUD/USD companion was unavailable). SMT results are illustrative until a live companion is fetchable."
          : "Live gold and silver feeds.",
  };
}

export function findDivergences(gold: Candle[], silver: Candle[], compName = "silver"): SmtDivergence[] {
  if (gold.length < 40 || silver.length < 40) return [];

  // align on time intersection
  const silverByTime = new Map<number, Candle>();
  for (const c of silver) silverByTime.set(c.time, c);
  const alignedGold: Candle[] = [];
  const alignedSilver: Candle[] = [];
  for (const g of gold) {
    const s = silverByTime.get(g.time);
    if (s) {
      alignedGold.push(g);
      alignedSilver.push(s);
    }
  }
  if (alignedGold.length < 40) return [];

  const goldSwings = findSwings(alignedGold, 2);
  const silverSwings = findSwings(alignedSilver, 2);

  const out: SmtDivergence[] = [];

  const check = (
    kind: "HIGH" | "LOW",
    idx: number,
    prevIdx: number,
    type: "BULLISH" | "BEARISH"
  ) => {
    const gs = goldSwings.filter((s) => s.type === kind);
    const ss = silverSwings.filter((s) => s.type === kind);
    if (gs.length < idx + 1 || ss.length < idx + 1) return;

    const g1 = gs[gs.length - 1 - prevIdx];
    const g2 = gs[gs.length - 1 - idx];
    const s1 = ss[ss.length - 1 - prevIdx];
    const s2 = ss[ss.length - 1 - idx];

    // swings must be roughly contemporaneous (within 6 bars)
    if (Math.abs(g2.index - s2.index) > 6) return;

    const goldHH = g2.price > g1.price;
    const silverHH = s2.price > s1.price;

    if (type === "BEARISH" && goldHH !== silverHH) {
      out.push({
        type,
        windowStart: Math.min(g1.time, s1.time),
        windowEnd: Math.max(g2.time, s2.time),
        goldDescription: `gold ${goldHH ? "higher high" : "lower high"} at ${g2.price.toFixed(2)}`,
        silverDescription: `${compName} ${silverHH ? "higher high" : "lower high"} at ${s2.price.toFixed(2)}`,
        detail: `At the swing-high window, gold printed a ${goldHH ? "higher" : "lower"} high while ${compName} printed a ${silverHH ? "higher" : "lower"} high — one market failed to confirm. Classically read as buyside liquidity being taken in the leading market before a pullback.`,
      });
    }

    const goldLL = g2.price < g1.price;
    const silverLL = s2.price < s1.price;
    if (type === "BULLISH" && goldLL !== silverLL) {
      out.push({
        type,
        windowStart: Math.min(g1.time, s1.time),
        windowEnd: Math.max(g2.time, s2.time),
        goldDescription: `gold ${goldLL ? "lower low" : "higher low"} at ${g2.price.toFixed(2)}`,
        silverDescription: `${compName} ${silverLL ? "lower low" : "higher low"} at ${s2.price.toFixed(2)}`,
        detail: `At the swing-low window, gold printed a ${goldLL ? "lower" : "higher"} low while ${compName} printed a ${silverLL ? "lower" : "higher"} low — a failure to confirm. Classically read as sellside liquidity being taken before a reversal higher.`,
      });
    }
  };

  // evaluate the last two swing comparisons for both sides
  check("HIGH", 0, 1, "BEARISH");
  check("HIGH", 1, 2, "BEARISH");
  check("LOW", 0, 1, "BULLISH");
  check("LOW", 1, 2, "BULLISH");

  return out;
}
