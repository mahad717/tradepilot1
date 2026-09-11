// Trade execution simulator (spec #2, #3, #26–#29).
//
// Correctness rules enforced here:
//  - initialStop NEVER mutates; currentStop may move (BE / structural)
//  - R is always measured against the INITIAL entry→initialStop distance
//  - partial exits are share-weighted legs; TP1 is never the whole position
//  - spread, slippage and commission are separated and attributed per leg
//  - same-candle SL+TP ambiguity resolved by the configured model
//    (pessimistic default: stop first); "ltf" consults 5m/1m candles
//  - breakeven moves take effect from the NEXT bar — a BE move can never
//    rescue a position inside the bar that triggered it (no intrabar
//    look-ahead)
//  - MFE ≥ 0 and MAE ≤ 0 in R, measured from entry against initial risk
//  - a full per-trade audit trail is recorded
//
// PURE function: replay-safe, no clock, no unseeded randomness.
import { mulberry32 } from "./rng";
import { fillCost } from "./costs";
import type {
  AmbiguityModel,
  AuditLine,
  BreakevenMode,
  Candle,
  CostModel,
  OutcomeKind,
  Setup,
  Side,
  TradeLeg,
  TradeRecord,
} from "./types";

export interface ExecuteConfig {
  beMode: BreakevenMode;
  beTriggerR: number;
  partialShares: [number, number, number];
  maxHoldBars: number;
  orderExpiryBars: number;
  ambiguity: AmbiguityModel;
  randomSeed: number;
  riskMoney: number;
  costs: CostModel;
}

export interface ExecuteResult {
  filled: boolean;
  trade: TradeRecord | null;
  /** index of the candle on which the last decision happened */
  endIndex: number;
}

interface LegDraft {
  label: TradeLeg["label"];
  share: number;
  exitIndex: number;
  exitTime: number;
  exitPrice: number;
  rawR: number; // signed move / initial risk, before share weighting
}

/**
 * LTF-aware ambiguity resolution with the actual levels.
 * Returns true when the stop printed before the target inside the parent
 * candle, false when the target printed first, null when LTF data is
 * unavailable or inconclusive (caller falls back to pessimistic).
 */
export function ltfStopFirst(
  ltf: Candle[],
  candle: Candle,
  side: Side,
  stopPrice: number,
  targetPrice: number,
  ltfSeconds: number,
  parentSeconds: number
): boolean | null {
  if (ltfSeconds <= 0 || parentSeconds <= 0 || ltf.length === 0) return null;
  // window = the parent candle's time span, walked at LTF granularity
  const start = candle.time;
  const end = candle.time + parentSeconds;
  const long = side === "LONG";
  let stopAt = -1;
  let targetAt = -1;
  for (const c of ltf) {
    if (c.time < start) continue;
    if (c.time >= end) break;
    const hitStop = long ? c.low <= stopPrice : c.high >= stopPrice;
    const hitTarget = long ? c.high >= targetPrice : c.low <= targetPrice;
    if (hitStop && stopAt === -1) stopAt = c.time;
    if (hitTarget && targetAt === -1) targetAt = c.time;
    if (stopAt !== -1 && targetAt !== -1) break;
  }
  if (stopAt === -1 && targetAt === -1) return null;
  if (stopAt === -1) return false;
  if (targetAt === -1) return true;
  return stopAt <= targetAt;
}

export function simulateTrade(
  candles: Candle[],
  setup: Setup,
  cfg: ExecuteConfig,
  symbol: string,
  interval: string,
  opts: { ltfCandles?: Candle[]; ltfSeconds?: number; parentSeconds?: number } = {}
): ExecuteResult {
  const long = setup.side === "LONG";
  const dir = long ? 1 : -1;
  const entry = setup.entry;
  const risk = setup.riskPerUnit;
  const audit: AuditLine[] = [];
  const [s1, s2, s3] = cfg.partialShares;
  const decidedIndex = setup.decidedIndex;

  const rand = mulberry32(cfg.randomSeed + decidedIndex);

  // ---- 1. pending order: fill / expiry / zone-invalidation ----------------
  let fillIndex = -1;
  let fillPrice = entry;
  let endIndex = decidedIndex + 1;
  for (let j = decidedIndex + 1; j <= Math.min(decidedIndex + cfg.orderExpiryBars, candles.length - 1); j++) {
    const c = candles[j];
    const invalidated = long ? c.close < setup.zone.bottom : c.close > setup.zone.top;
    if (invalidated) {
      audit.push({ time: c.time, event: "Order cancelled", detail: `zone invalidated (close ${c.close.toFixed(2)} beyond far edge)` });
      return { filled: false, trade: null, endIndex: j };
    }
    const touched = long ? c.low <= entry : c.high >= entry;
    if (touched) {
      fillPrice = long ? Math.min(entry, c.open) : Math.max(entry, c.open);
      fillIndex = j;
      endIndex = j;
      audit.push({ time: c.time, event: "Entry became valid", detail: `limit order resting @ ${entry.toFixed(2)} since bar ${decidedIndex + 1}` });
      audit.push({ time: c.time, event: "Entry filled", detail: `${setup.side} @ ${fillPrice.toFixed(2)}${fillPrice !== entry ? " (gapped fill, worse price)" : " (limit)"}` });
      break;
    }
    endIndex = j;
  }
  if (fillIndex === -1) {
    audit.push({ time: candles[endIndex].time, event: "Order expired", detail: `unfilled after ${cfg.orderExpiryBars} bars` });
    return { filled: false, trade: null, endIndex };
  }

  // ---- 2. position sizing (spec #3) ---------------------------------------
  const riskMoney = cfg.riskMoney;
  const positionSizeUnits = riskMoney / risk;
  const entryCostUnits = fillCost(cfg.costs, fillPrice, 1).priceUnits;
  audit.push({ time: candles[fillIndex].time, event: "Initial risk", detail: `${risk.toFixed(2)} price units (${((risk / entry) * 100).toFixed(3)}% of price) — frozen for the whole trade` });
  audit.push({ time: candles[fillIndex].time, event: "Position size", detail: `${positionSizeUnits.toFixed(2)} units so that 1R = ${riskMoney} account-ccy` });
  audit.push({ time: candles[fillIndex].time, event: "Stop loss", detail: `initial SL ${setup.initialStop.toFixed(2)} (structural — recorded separately from any later stop move)` });
  setup.targets.forEach((t, idx) => {
    audit.push({ time: candles[fillIndex].time, event: `TP${idx + 1}`, detail: `${t.price.toFixed(2)} — ${t.source} (${t.rr}R), closes ${(cfg.partialShares[idx] * 100).toFixed(0)}%` });
  });

  // ---- 3. manage the position ---------------------------------------------
  const legs: LegDraft[] = [];
  let currentStop = setup.initialStop;
  let stopLabel: TradeLeg["label"] = "INITIAL_SL";
  let breakevenStop: number | null = null;
  let beActivatedTime: number | null = null;
  let remainingShare = 1;
  let tp1Hit = false;
  let tp2Hit = false;
  let tp3Hit = false;
  let mfeR = 0;
  let maeR = 0;
  let exitIndex = fillIndex;
  let exitTime = candles[fillIndex].time;
  let finalExitPrice = fillPrice;

  const unfilledTargets = () => {
    const t: { price: number; share: number; label: TradeLeg["label"] }[] = [];
    if (!tp1Hit && setup.targets[0]) t.push({ price: setup.targets[0].price, share: s1, label: "TP1" });
    if (!tp2Hit && setup.targets[1]) t.push({ price: setup.targets[1].price, share: s2, label: "TP2" });
    if (!tp3Hit && setup.targets[2]) t.push({ price: setup.targets[2].price, share: s3, label: "TP3" });
    return t;
  };

  const fillTargetLeg = (j: number, t: { price: number; share: number; label: TradeLeg["label"] }) => {
    const share = Math.min(t.share, remainingShare);
    if (share <= 0) return;
    legs.push({
      label: t.label,
      share,
      exitIndex: j,
      exitTime: candles[j].time,
      exitPrice: t.price,
      rawR: (dir * (t.price - fillPrice)) / risk,
    });
    remainingShare = Math.max(0, remainingShare - t.share);
    audit.push({
      time: candles[j].time,
      event: `${t.label} hit`,
      detail: `${(share * 100).toFixed(0)}% of position closed @ ${t.price.toFixed(2)} (+${round(((dir * (t.price - fillPrice)) / risk)).toFixed(2)}R raw) — remaining ${(remainingShare * 100).toFixed(0)}%`,
    });
    if (t.label === "TP1") tp1Hit = true;
    if (t.label === "TP2") tp2Hit = true;
    if (t.label === "TP3") tp3Hit = true;
  };

  const closeAll = (j: number, price: number, label: TradeLeg["label"], kind: "stop" | "flat") => {
    const c = candles[j];
    const exitPrice = kind === "stop" ? (long ? Math.min(price, c.open) : Math.max(price, c.open)) : price;
    const share = remainingShare;
    legs.push({
      label,
      share,
      exitIndex: j,
      exitTime: c.time,
      exitPrice,
      rawR: (dir * (exitPrice - fillPrice)) / risk,
    });
    remainingShare = 0;
    exitIndex = j;
    exitTime = c.time;
    finalExitPrice = exitPrice;
    audit.push({ time: c.time, event: "Final exit", detail: `${label} @ ${exitPrice.toFixed(2)} (stop as of exit: ${currentStop.toFixed(2)}${breakevenStop !== null ? `, breakeven: ${breakevenStop.toFixed(2)}` : ""})` });
  };

  for (let j = fillIndex; j < candles.length; j++) {
    const c = candles[j];
    // MFE as of the END of the previous bar — used by the risk1 BE check so a
    // same-candle spike can never move the stop inside that bar's stop check
    const mfeThroughPrevBar = mfeR;

    // --- 0) excursion update (reporting MFE/MAE includes the exit bar;
    //        fill bar counts adverse only — its favorable order is unknowable)
    if (j > fillIndex) {
      const favorable = long ? (c.high - fillPrice) / risk : (fillPrice - c.low) / risk;
      const adverse = long ? (c.low - fillPrice) / risk : (fillPrice - c.high) / risk;
      mfeR = Math.max(mfeR, favorable);
      maeR = Math.min(maeR, adverse);
    } else {
      const adverse = long ? (c.low - fillPrice) / risk : (fillPrice - c.high) / risk;
      maeR = Math.min(maeR, adverse);
    }

    // --- a) resolve stop vs targets with the stop state from PRIOR bars ----
    const hitStop = long ? c.low <= currentStop : c.high >= currentStop;
    const targets = unfilledTargets();
    const hitTargets = targets.filter((t) => (long ? c.high >= t.price : c.low <= t.price));

    if (hitStop && hitTargets.length > 0) {
      let stopWasFirst: boolean;
      switch (cfg.ambiguity) {
        case "optimistic":
          stopWasFirst = false;
          break;
        case "randomized":
          stopWasFirst = rand() < 0.5;
          break;
        case "ltf": {
          const res = ltfStopFirst(opts.ltfCandles ?? [], c, setup.side, currentStop, hitTargets[0].price, opts.ltfSeconds ?? 0, opts.parentSeconds ?? 0);
          stopWasFirst = res ?? true;
          break;
        }
        case "pessimistic":
        default:
          stopWasFirst = true;
      }
      if (stopWasFirst) {
        closeAll(j, currentStop, stopLabel, "stop");
        break;
      }
      for (const t of hitTargets) fillTargetLeg(j, t);
      if (remainingShare <= 0) break;
      continue; // BE/structural moves evaluate from next bar
    }

    if (hitStop) {
      closeAll(j, currentStop, stopLabel, "stop");
      break;
    }

    if (hitTargets.length > 0) {
      for (const t of hitTargets) fillTargetLeg(j, t);
      if (remainingShare <= 0) break;
      // fall through: BE checks, timeout
    }

    // --- c) breakeven activation — effective from the NEXT bar (no
    //        intrabar rescue). risk1 uses the PREVIOUS bar's MFE so a
    //        same-candle spike can never move the stop inside that bar's
    //        stop check. (spec #26) -----------------------------------
    if (breakevenStop === null && remainingShare > 0) {
      if (cfg.beMode === "tp1" && tp1Hit) {
        breakevenStop = fillPrice;
        currentStop = fillPrice;
        stopLabel = "BREAKEVEN_STOP";
        beActivatedTime = c.time;
        audit.push({ time: c.time, event: "Breakeven activated", detail: `SL moved to entry ${fillPrice.toFixed(2)} after TP1 (effective next bar) — initial SL ${setup.initialStop.toFixed(2)} preserved in the record` });
      } else if (cfg.beMode === "risk1" && mfeThroughPrevBar >= cfg.beTriggerR) {
        breakevenStop = fillPrice;
        currentStop = fillPrice;
        stopLabel = "BREAKEVEN_STOP";
        beActivatedTime = c.time;
        audit.push({ time: c.time, event: "Breakeven activated", detail: `MFE +${mfeR.toFixed(2)}R ≥ ${cfg.beTriggerR}R — SL moved to entry (effective next bar)` });
      } else if (cfg.beMode === "structural" && j >= fillIndex + 3) {
        const k = j - 2;
        const prev = candles[k - 1];
        const pivot = candles[k];
        const next = candles[k + 1];
        const isSwingLow = pivot.low < prev.low && pivot.low < next.low;
        const isSwingHigh = pivot.high > prev.high && pivot.high > next.high;
        if (long && isSwingLow && pivot.low > fillPrice) {
          breakevenStop = pivot.low;
          currentStop = pivot.low;
          stopLabel = "STRUCTURE_STOP";
          beActivatedTime = c.time;
          audit.push({ time: c.time, event: "Structural stop", detail: `protected low ${pivot.low.toFixed(2)} confirmed above entry — SL moved (effective next bar)` });
        } else if (!long && isSwingHigh && pivot.high < fillPrice) {
          breakevenStop = pivot.high;
          currentStop = pivot.high;
          stopLabel = "STRUCTURE_STOP";
          beActivatedTime = c.time;
          audit.push({ time: c.time, event: "Structural stop", detail: `protected high ${pivot.high.toFixed(2)} confirmed below entry — SL moved (effective next bar)` });
        }
      }
    }

    // --- d) timeout / end of data (spec #27) --------------------------------
    if (j - fillIndex >= cfg.maxHoldBars) {
      closeAll(j, c.close, "TIMEOUT", "flat");
      break;
    }
    if (j === candles.length - 1) {
      closeAll(j, c.close, "END_OF_DATA", "flat");
      break;
    }
  }

  // ---- 4. weighted accounting (spec #3, #28) ------------------------------
  let grossR = 0;
  let costR = 0;
  const finalLegs: TradeLeg[] = legs.map((leg) => {
    const entryShareCost = entryCostUnits * leg.share;
    const exitLegCost = fillCost(cfg.costs, leg.exitPrice, leg.share).priceUnits;
    const legCostR = (entryShareCost + exitLegCost) / risk;
    const weightedGross = leg.share * leg.rawR;
    grossR += weightedGross;
    costR += legCostR;
    return {
      label: leg.label,
      share: leg.share,
      exitIndex: leg.exitIndex,
      exitTime: leg.exitTime,
      exitPrice: round(leg.exitPrice),
      grossR: round(weightedGross),
      costR: round(legCostR),
      netR: round(weightedGross - legCostR),
    };
  });

  const netR = grossR - costR;
  const outcome = classifyOutcome(tp1Hit, tp2Hit, tp3Hit, stopLabel, legs, netR);

  audit.push({ time: exitTime, event: "Gross P&L", detail: `${round(grossR)}R (share-weighted sum of ${finalLegs.length} leg${finalLegs.length === 1 ? "" : "s"})` });
  audit.push({ time: exitTime, event: "Trading costs", detail: `${round(costR)}R — spread ${cfg.costs.spread}, slippage ${cfg.costs.slippagePerSide}/side, commission ${(cfg.costs.commissionPctPerSide * 1e4).toFixed(1)}bp/side` });
  audit.push({ time: exitTime, event: "Net P&L", detail: `${round(netR)}R ≈ ${round(netR * riskMoney)} account-ccy on ${riskMoney} risk` });
  audit.push({ time: exitTime, event: "Final R", detail: `${round(netR)}R against INITIAL risk ${risk.toFixed(2)}` });
  audit.push({ time: exitTime, event: "MFE / MAE", detail: `+${round(mfeR)}R / ${round(maeR)}R` });

  const trade: TradeRecord = {
    id: `${symbol}-${interval}-${setup.side}-${setup.decidedTime}`,
    symbol,
    interval,
    side: setup.side,
    tier: setup.tier,
    totalScore: setup.totalScore,
    scores: setup.scores,
    entry: round(fillPrice),
    initialStop: round(setup.initialStop),
    currentStop: round(currentStop),
    breakevenStop: breakevenStop !== null ? round(breakevenStop) : null,
    finalExitPrice: round(finalExitPrice),
    tp1: setup.targets[0] ? round(setup.targets[0].price) : null,
    tp2: setup.targets[1] ? round(setup.targets[1].price) : null,
    tp3: setup.targets[2] ? round(setup.targets[2].price) : null,
    signalTime: setup.decidedTime,
    orderPlacedTime: setup.decidedTime,
    entryTime: candles[fillIndex].time,
    entryIndex: fillIndex,
    exitTime,
    exitIndex,
    barsHeld: exitIndex - fillIndex,
    beActivatedTime,
    riskPerUnit: round(risk),
    positionSizeUnits: round(positionSizeUnits),
    riskMoney,
    plannedRR: setup.rrToFinal,
    legs: finalLegs,
    grossR: round(grossR),
    costR: round(costR),
    netR: round(netR),
    outcome,
    mfeR: round(mfeR),
    maeR: round(maeR),
    session: setup.session,
    htfBias: setup.htfBias,
    volRegime: setup.volRegime,
    mktRegime: setup.mktRegime,
    smtAligned: setup.smtAligned,
    sweepKey: setup.sweepKey,
    zoneId: setup.zone.id,
    zoneKind: setup.zone.kind,
    rationale: setup.rationale,
    lossReasons: [],
    audit,
  };

  return { filled: true, trade, endIndex: exitIndex };
}

function classifyOutcome(
  tp1Hit: boolean,
  tp2Hit: boolean,
  tp3Hit: boolean,
  stopLabel: TradeLeg["label"],
  legs: { label: TradeLeg["label"] }[],
  netR: number
): OutcomeKind {
  if (tp3Hit) return "TP3";
  if (tp2Hit) return "TP2_TP1";
  if (tp1Hit) {
    const last = legs[legs.length - 1];
    if (stopLabel === "STRUCTURE_STOP") return "TP1_STRUCT_BE";
    if (stopLabel === "BREAKEVEN_STOP") return "TP1_BE";
    if (last?.label === "TIMEOUT") return "TP1_TIMEOUT";
    if (last?.label === "END_OF_DATA") return "EOD";
    return "TP1_BE";
  }
  if (stopLabel === "BREAKEVEN_STOP" || stopLabel === "STRUCTURE_STOP") return "BE_STOP";
  const last = legs[legs.length - 1];
  if (last?.label === "TIMEOUT") return netR >= 0 ? "TIMEOUT_WIN" : "TIMEOUT_LOSS";
  if (last?.label === "END_OF_DATA") return "EOD";
  return "SL";
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}
