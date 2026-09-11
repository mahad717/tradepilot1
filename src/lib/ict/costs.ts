// Realistic, separated trading-cost model (spec #28).
// Spread, slippage and commission are tracked independently and converted
// into R using the trade's INITIAL risk — never the moved (breakeven) stop.
import type { CostModel } from "./types";
import type { SymbolKey } from "@/lib/market/types";

/**
 * Conservative retail spot-metal assumptions, in PRICE units:
 *  - XAUUSD: ~$0.30 spread on gold (~4300), $0.05 slippage per side,
 *    0.1 bp commission per side (raw-spread accounts).
 *  - XAGUSD: ~$0.03 spread on silver (~54), $0.01 slippage per side,
 *    0.1 bp commission per side.
 */
export const DEFAULT_COSTS: Record<SymbolKey, CostModel> = {
  XAUUSD: { spread: 0.3, slippagePerSide: 0.05, commissionPctPerSide: 0.00001 },
  XAGUSD: { spread: 0.03, slippagePerSide: 0.01, commissionPctPerSide: 0.00001 },
};

export interface SideCost {
  /** spread + slippage + commission for one fill at `price` */
  priceUnits: number;
}

/** Cost of ONE fill (entry or exit) at `price` for `share` of the position. */
export function fillCost(
  costs: CostModel,
  price: number,
  share: number
): SideCost {
  const commission = costs.commissionPctPerSide * price * share;
  return {
    priceUnits: (costs.spread + costs.slippagePerSide) * share + commission,
  };
}

/**
 * Round-trip cost for a leg: entry fill on the leg's share + exit fill.
 * Expressed in price units; divide by initial risk per unit to get R.
 */
export function legRoundTripCost(
  costs: CostModel,
  entryPrice: number,
  exitPrice: number,
  share: number
): number {
  return (
    fillCost(costs, entryPrice, share).priceUnits +
    fillCost(costs, exitPrice, share).priceUnits
  );
}

/** Full-position round-trip cost in R given the initial risk per unit. */
export function roundTripCostR(
  costs: CostModel,
  entryPrice: number,
  riskPerUnit: number
): number {
  const half = fillCost(costs, entryPrice, 1).priceUnits;
  return (2 * half) / riskPerUnit;
}

export function describeCosts(costs: CostModel): string {
  return `spread ${costs.spread} + slippage ${costs.slippagePerSide}/side + commission ${(costs.commissionPctPerSide * 1e4).toFixed(1)} bp/side (price units)`;
}
