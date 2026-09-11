// Rule-based signal generation from the ICT analysis snapshot.
//
// A candidate requires confluence of:
//   1. HTF structural bias (4H / 1D trend from BOS-MSS engine)
//   2. A recent liquidity sweep on the analysis timeframe (stop-hunt)
//   3. Price trading back into an unmitigated FVG or Order Block (entry zone)
//   4. Discount (for longs) / premium (for shorts) positioning
// Confidence is a transparent 0-100 score; every candidate carries plain-
// language rationale bullets. No guarantees — rule-based analysis only.
import "server-only";
import { analyze } from "./engine";
import { computeSmt } from "./smt";
import type { SignalCandidate, Trend, Zone } from "./types";
import type { IntervalKey, SymbolKey } from "@/lib/market/types";

interface BuildArgs {
  symbol: SymbolKey;
  interval: IntervalKey;
}

function nearestZone(
  price: number,
  zones: Zone[],
  side: "LONG" | "SHORT"
): Zone | null {
  const relevant = zones.filter((z) =>
    side === "LONG" ? z.direction === "BULLISH" : z.direction === "BEARISH"
  );
  let best: Zone | null = null;
  let bestDist = Infinity;
  for (const z of relevant) {
    const mid = (z.top + z.bottom) / 2;
    const dist = Math.abs(price - mid);
    // entry zone must be touchable: for longs below price, for shorts above
    const touchable =
      side === "LONG" ? z.bottom <= price * 1.001 && z.top <= price * 1.02 : z.top >= price * 0.999 && z.bottom >= price * 0.98;
    if (!touchable) continue;
    if (dist < bestDist) {
      best = z;
      bestDist = dist;
    }
  }
  return best;
}

export async function generateSignals({
  symbol,
  interval,
}: BuildArgs): Promise<{ candidates: SignalCandidate[]; evaluatedAt: number; note: string }> {
  const [{ snapshot, htfTrend }, smt] = await Promise.all([
    analyze(symbol, interval),
    computeSmt("15min"),
  ]);

  const price = snapshot.lastPrice;
  const candidates: SignalCandidate[] = [];

  const recentSweeps = snapshot.sweeps.filter(
    (s) => Date.now() / 1000 - s.time < 6 * 3600
  );

  for (const side of ["LONG", "SHORT"] as const) {
    const wantedDirection = side === "LONG" ? "BULLISH" : "BEARISH";
    const biasAligned = htfTrend === wantedDirection;

    const sweep = [...recentSweeps]
      .reverse()
      .find((s) => (side === "LONG" ? s.side === "SELL_SIDE" : s.side === "BUY_SIDE"));
    if (!sweep) continue;

    const zone =
      nearestZone(price, snapshot.orderBlocks, side) ??
      nearestZone(price, snapshot.fvg, side);
    if (!zone) continue;

    const inRange = snapshot.range;
    const rangeAligned =
      side === "LONG"
        ? inRange && inRange.zone !== "PREMIUM"
        : inRange && inRange.zone !== "DISCOUNT";
    if (!rangeAligned) continue;

    // --- scoring (transparent additive model) ---
    let score = 0;
    const rationale: string[] = [];

    if (biasAligned) {
      score += 30;
      rationale.push(
        `HTF structure is ${htfTrend.toLowerCase()} (latest BOS/MSS confirms continuation).`
      );
    } else if (htfTrend === "NEUTRAL") {
      score += 10;
      rationale.push("HTF structure is neutral — this is a range play, not trend continuation.");
    } else {
      rationale.push(
        `Counter-trend: HTF bias is ${htfTrend.toLowerCase()} while setup is ${wantedDirection.toLowerCase()}.`
      );
    }

    score += 20;
    rationale.push(
      `${side === "LONG" ? "Sellside" : "Buyside"} liquidity swept at ${sweep.level.toFixed(2)} — stop-hunt signature detected.`
    );

    const killzone = snapshot.killzone;
    if (killzone) {
      score += 15;
      rationale.push(`${killzone.name} is active (${killzone.startUtc}–${killzone.endUtc} UTC).`);
    } else {
      rationale.push("Outside all kill zones — timing filter is neutral.");
    }

    if (inRange) {
      const zoneOk = side === "LONG" ? inRange.zone === "DISCOUNT" : inRange.zone === "PREMIUM";
      if (zoneOk) {
        score += 15;
        rationale.push(
          `Price in ${inRange.zone.toLowerCase()} half of the dealing range (${inRange.positionPct}% of range).`
        );
      } else if (inRange.zone === "EQUILIBRIUM") {
        score += 8;
        rationale.push("Price at equilibrium of the dealing range.");
      }
    }

    const confluence = snapshot.orderBlocks.includes(zone) && snapshot.fvg.some(
      (f) =>
        f.direction === zone.direction &&
        f.bottom <= zone.top &&
        f.top >= zone.bottom
    );
    if (confluence) {
      score += 10;
      rationale.push(
        `Entry zone overlaps an unmitigated ${zone.direction.toLowerCase()} FVG and order block (confluence).`
      );
    }

    const smtAligned = smt.divergences.some(
      (d) => d.type === (side === "LONG" ? "BULLISH" : "BEARISH")
    );
    if (smtAligned) {
      score += 10;
      rationale.push(
        `XAU/XAG SMT ${side === "LONG" ? "bullish" : "bearish"} divergence supports the setup.`
      );
    }

    // --- levels ---
    const zoneMid = (zone.top + zone.bottom) / 2;
    const entry = Math.round(zoneMid * 100) / 100;
    const buffer = Math.max(snapshot.atr * 0.35, entry * 0.0004);
    const stopLoss =
      side === "LONG"
        ? Math.round(Math.min(zone.bottom, sweep.extreme) - buffer) * 100 / 100
        : Math.round((Math.max(zone.top, sweep.extreme) + buffer) * 100) / 100;

    const risk = Math.abs(entry - stopLoss);
    const opposingPool = snapshot.pools.find((p) =>
      side === "LONG" ? p.type === "EQH" && p.price > entry : p.type === "EQL" && p.price < entry
    );

    const targets = [
      Math.round((side === "LONG" ? entry + risk * 1.5 : entry - risk * 1.5) * 100) / 100,
      Math.round((side === "LONG" ? entry + risk * 2.5 : entry - risk * 2.5) * 100) / 100,
      Math.round((side === "LONG" ? entry + risk * 4 : entry - risk * 4) * 100) / 100,
    ];
    if (opposingPool) {
      // replace TP2 with the structural liquidity pool if it's between 2R and 4R
      const poolR = Math.abs(opposingPool.price - entry) / risk;
      if (poolR > 2 && poolR < 4.2) {
        targets[1] = Math.round(opposingPool.price * 100) / 100;
        rationale.push(
          `TP2 anchored to ${opposingPool.type === "EQH" ? "equal highs" : "equal lows"} pool at ${opposingPool.price.toFixed(2)}.`
        );
      }
    }

    const confidence = Math.min(100, score);
    const grade: SignalCandidate["grade"] = confidence >= 75 ? "A" : confidence >= 55 ? "B" : "C";

    candidates.push({
      id: `${symbol}-${interval}-${side}-${Math.floor(Date.now() / 60000)}`,
      symbol,
      interval,
      side,
      entry,
      stopLoss,
      targets,
      rrToTarget2: Math.round((Math.abs(targets[1] - entry) / risk) * 10) / 10,
      confidence,
      grade,
      rationale,
      htfTrend,
      createdAt: Date.now(),
      killzone: killzone?.name ?? null,
      smtAligned,
    });
  }

  candidates.sort((a, b) => b.confidence - a.confidence);

  return {
    candidates,
    evaluatedAt: Date.now(),
    note:
      "Rule-based ICT analysis, generated automatically from live chart structure. Educational information only — not financial advice. Past performance does not guarantee future results.",
  };
}
