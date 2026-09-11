// ICT / Smart Money Concepts core types and analysis results.
// Pure TypeScript — safe to import on both server and client.

import type { Candle, DataSource } from "@/lib/market/types";

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
  rrToTarget2: number;
  confidence: number;
  grade: "A" | "B" | "C";
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
