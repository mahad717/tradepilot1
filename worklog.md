
---
Task ID: 6
Agent: Super Z (main agent)
Task: Full correctness-first overhaul of the ICT signal + backtest engine (38-point spec): audit,
accounting fixes, sequence-verified setups, statistical validation, honest before/after.

Work Log:
- AUDIT of old engine found and documented: (1) stop==entry display bug (moved BE stop stored as
  the trade stop; r after TP1 hardcoded 0.5×1.5R); (2) MFE/MAE sign conventions broken on both
  sides (LONG MAE structurally 0; SHORT MFE tracked adverse moves); (3) single tail-of-series ATR
  applied to every bar = look-ahead; (4) fixed 1.5R/2.5R targets, no structural TPs; (5) "London
  Kill Zone" label was cosmetic (no session gating); (6) single spread cost, no slippage/commission;
  (7) baseline on live data: 19 trades, 42.1% WR, −0.16R expectancy, PF 0.73, −3.09R net.
- NEW ENGINE (src/lib/ict/): sequence.ts (ordered causal setup chain: HTF bias → leg
  premium/discount → sweep+rejection → displacement → MSS/BOS → fresh FVG/OB → retracement, with
  per-event recency, funnel counters, 6-category capped scoring 0-100, tiers A+/A/B/NO_TRADE);
  execution.ts (weighted partial legs, BE modes tp1/risk1/structural/off with next-bar semantics,
  timeout, ambiguity models pessimistic/optimistic/randomized/ltf, separated costs per leg, signed
  MFE/MAE incl. exit bar, full per-trade audit trail); costs.ts; htf.ts (causal 4H/1H resample,
  closed-candle-only bias); volatility.ts (rolling ATR + percentile vol regime); regime.ts (6-state
  market regime, UNCLEAR → NO TRADE); sweepquality.ts (rejection vs breakout classification);
  displacement.ts (vol-relative quality); zonequality.ts; targets.ts (structural TP ladders:
  pools/PDH/PDL/PWH/PWL/Asia/ERL/swings, clustered); sessions.ts; smtseries.ts (causal SMT);
  montecarlo.ts; walkforward.ts (5 periods + train/validate/OOS); diagnostics.ts (loss attribution,
  MFE/MAE analysis, report, GREEN/YELLOW/RED flags); validate.ts (13 deterministic self-tests).
- VALIDATION (spec #36): /api/backtest/selftest — 13/13 PASS: partial-TP accounting (0.5×1.5R +
  0.5×0R = +0.75R exact), BE accounting (initialStop≠currentStop), cost math, position sizing,
  MFE/MAE signs, timeout, all 4 ambiguity models, truncation invariance (no look-ahead) on a
  synthetic series that actually trades, minRR gate, stop≠entry guard. Synthetic-series engineering
  took several iterations (sweep candle must not break its own swing fractal; pattern must sit in
  discount after a real give-back; 4H needs fractal swings to exist).
- REAL-DATA RESULTS (TwelveData, honest): XAUUSD 15m 1500 London: 0 trades (2 valid sequences, no
  ≥2R structural target at record highs); 15m 1500 NY: 0; 15m 3000 London: 1 (+0.08R); 15m 5000
  London+NY: 1 (+0.08R); 5m 3000 London: 0; XAGUSD (simulated): 0; 1h 3000 (~4y): 1 trade, A-tier
  SHORT, TP1+TP2+TP3 all hit, +1.69R net with full audit. Funnel on 5000 bars: 4916 → 4435 bias →
  1167 regime/session → 400 sweep → 212 quality → 43 MSS → 36 displacement → 28 zone → 21 P/D →
  3 RR≥2R → 3 orders → 1 fill. minRR sensitivity 1.5/2/5/3: 0-1 trades everywhere on 15m.
- CONCLUSION (honest per spec #33/#37): the corrected engine is far MORE selective than the old
  one; sample sizes are far too small for any statistical claim. NO breaking changes to SEO pages;
  live signals now share the same setup builder (backtest/replay consistency).
- UI: backtest tab v2 (robustness flags, executive metrics w/ gross-vs-cost split, equity curve,
  walk-forward table, Monte Carlo, funnel, loss diagnostics, MFE/MAE scatter, session + score-tier
  tables, sensitivity, trade table with initial/current/BE stops + per-trade audit viewer); signals
  tab v2 (tier, category score bars, sequence chain, NO TRADE reasons).

Stage Summary:
- 13/13 self-tests pass; tsc + eslint clean on all touched files.
- Files: 15 new/rewritten engine modules, 2 API routes (backtest v2 + selftest), 3 UI components.
- Baseline numbers preserved in scripts/baseline-before.json; all AFTER runs in scripts/after-*.json.

---
Task ID: 7
Agent: Super Z (main agent)
Task: 20-point diagnostics spec — diagnose 5000-bars→1-trade, setup models A–E,
core/optional confluence hierarchy, signal funnel + rejection tables, WHY NO TRADE,
RR/session diagnostics, honest stats (N/A PF, sample categories), strictness comparison.

Work Log:
- DIAGNOSIS of the 1-trade bottleneck (§18 audit, 7 root causes): (1) CRITICAL target-ladder
  bug — buildTargetLadder clustered levels then .slice(0,3) kept the 3 NEAREST and the RR gate
  required the farthest OF THOSE ≥2R, discarding far liquidity (PDH/PWH); (2) kill zones fixed-UTC
  ignored DST (London 07–10 UTC wrong half the year; NY AM was 07:00–10:00 New York = pre-market);
  (3) UNCLEAR regime gate killed most bias-aligned bars (4435→1167); (4) premium/discount was a
  hard gate (spec §5 makes it optional confluence); (5) MSS-within-12-bars (212→43) is strict —
  Model B (FVG continuation off BOS) added for trend phases; (6) at record highs LONG setups have
  no overhead structural targets and SHORT conflicts with HTF bias; (7) limit orders expire
  unfilled (retracement never comes).
- ENGINE v3: sequence.ts rewritten model-aware — Models A (sweep→MSS→disp→FVG), B (disp→BOS→FVG
  continuation, no sweep), C (OB reversal), D (FVG+OB overlap), E (SMT-required); core vs optional
  hierarchy per §5 (P/D, kill zone, SMT, session = score confluence, not gates); every candidate
  records ConfluenceItem traces (detected/timestamp/price/range/timeframe/reason — §3); PRIMARY
  RejectionCode per bar with STAGE_DEPTH ranking (§2); RR diagnostics histogram pre-gate (§9);
  per-session valid-setup counts with NO session gate (§10); rejected-setup samples with ±20-bar
  candle windows (§19); ModelStat per model (§7).
- FIXES: targets.ts ladder no longer sliced before gate — TP3 = FARTHEST level, gate = max
  available RR ≥ minRR; sessions.ts DST-aware via Intl (Europe/London 07–10, NY AM 09:30–12:00,
  NY PM 13:30–16:00 market-local; 8/8 DST unit checks pass, formatters + per-timestamp memoised);
  computeMetrics PF/WR/expectancy nullable (§13/§14: no more "PF 99"); walkforward PeriodStats
  nullable; robustnessFlags sample-size gate FIRST (§12: <20 INSUFFICIENT → RED regardless of
  profit; 1 trade → explicit "cannot be meaningfully evaluated"); data-quality audit (§18:
  duplicates/order/gaps/OHLC) added to runBacktest; strictness presets conservative/balanced/
  aggressive (§16) + compareStrictness runner (§17).
- API: /api/backtest gains strictness + compare params, returns funnel stages (§1 exact list with
  count + % of candles), rejections, modelStats, rrDiagnostics, sessionFilterDiagnostics,
  rejectedSamples, dataQuality, comparison; /api/signals returns whyNoTrade built from
  probeSetupState (§4 live checklist + waitingFor).
- UI: backtest-tab rebuilt — Strategy Diagnostics funnel (count/%), ranked rejection table,
  model-performance table, RR + session diagnostics, strictness comparison, rejected-setup
  inspector with mini candlestick charts (§19), data-quality panel, N/A-aware metric cards,
  gross-vs-net expectancy, confluence-trace viewer per trade, strictness/session selectors;
  signals-tab gains WHY NO TRADE panel (✓/✗ checklist + waiting-for list).
- VALIDATION: 13/13 self-tests still pass (accounting, no look-ahead truncation invariance,
  ambiguity models, minRR gate); tsc + eslint clean on all touched files.
- REAL-DATA RERUN (§15, XAUUSD 5000×15m, minRR 2, honest):
  balanced/all-sessions: 19 trades, 63.2% WR, +0.04R expectancy, PF 1.21, DD 3.15R, net +0.77R.
  conservative: 3 trades +0.10R; aggressive: 18 trades +0.34R PF 1.09 (loosening ≠ better).
  minRR sensitivity: 1.5/2/2.5 identical (median available RR now 8.7R — ladder fix made the
  gate non-binding), 3R → 16 trades. Walk-forward UNEVEN: P3 +3.32R carries the total; VALIDATION
  −2.30R and OOS −0.85R both negative. 5m: 23 trades −9.31R PF 0.15 (honest loss). 1h: 20 trades
  +2.67R PF 1.99 (LOW sample). User original config (15m 1500 London+NY): 1 trade −1.04R —
  session filter + short window were the dominant suppressors.
- CONCLUSION (honest, §20): bottleneck was ~90% engine bugs/config (RR ladder slice, fixed-UTC
  sessions, hard P/D gate, restrictive session default), not the ICT logic itself. The funnel now
  shows exactly where opportunities die: WEAK_MSS 1268 > REGIME_UNCLEAR 780 > NO_MSS 603 >
  NO_HTF_BIAS 478 > NO_FVG 388 > VOL_BLOCKED 357. Model B (FVG continuation) supplies 16/19
  trades, +0.74R. NO statistical edge is demonstrated: 19 trades = INSUFFICIENT (RED), OOS
  negative, one period dominates. No parameters were tuned to history; presets compare thresholds,
  nothing was fitted.

Stage Summary:
- Files: sequence/targets/sessions/diagnostics/backtest/signal/types/walkforward/validate +
  backtest API route + 3 terminal components; artifacts in scripts/after-*.json.
- After-run (§15): Before 1 trade/+0.08R → After 19 trades/+0.77R with full diagnostics; the
  remaining constraint is genuinely selective ICT logic + honest small-sample warnings.
