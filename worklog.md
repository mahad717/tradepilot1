
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

---
Task ID: 8
Agent: Super Z (main agent)
Task: Review deployed diagnostics (user screenshots) and answer "What needs to be improved".

Work Log:
- Inspected 5 full-page screenshots of live terminal (1500-bar and 5000-bar XAUUSD runs).
- Verified equity-curve "straight line" is coincidental data (win +2.16R then losses -1.04/-1.12R) + index-based x-axis.
- Confirmed per-model top-rejection lists identical for A/C/D = shared precondition gates, not a wiring bug, but zero information.
- Found OB detection effectively dead (26/10464 candidates; Models C/D 0 trades): body >= 0.84*medianATR single scalar for whole series, midpoint-wick-touch mitigation, narrow creation window.
- LIVE API probe: feed continuous at ~96 bars/calendar-day, gaps=0, candles on Saturday -> weekend candles present; kill-zone/session logic exposed to dead-market bars.
- Noted 11/14 (79%) orders expire unfilled; ambiguity models identical (0 same-candle collisions, uncounted); SMT hard-disabled (silver unavailable); costs = 1.73R vs 3.66R gross (47%).

Stage Summary:
- Improvement plan delivered: P0 bugs (OB detector, weekend candles, equity x-axis, model-rejection attribution UX), P1 diagnostics (expiry funnel, ambiguity counter, SMT N/A, cost flag, inspector sampling), P2 statistics (deep-history fetch for 100+ trades before any tuning).

---
Task ID: 9
Agent: Super Z (main agent)
Task: "Do the recommendation" — implement P0 bug fixes, P1 diagnostics gaps, P2 deep history.

Work Log:
- Baseline captured BEFORE changes via local dev API (v4-*-before.json): 5000b=19 trades +0.77R PF 1.21; 1500b=3 trades 0R.
- zones.ts: OB per-bar ATR (factor 1.2 at displacement bar, was 0.84x series median), invalidation = CLOSE through midpoint (was wick touch). sequence.ts: caller + split mitigation map (FVG keeps touch-freshness rule).
- market layer: isWeekendCandle/dropWeekendCandles (Sat + Sun<22:00 UTC) applied to backtest + silver feed; twelvedata.ts fetchCandlesRangeLive (end_date pagination, 15-min deep cache, 8-request budget); getCandlesDeep; backtest bars cap 25000.
- execution.ts: PendingTelemetry (fill latency, late fills beyond expiry via observation-only 48-bar horizon, closest approach in R — fixed a sign inversion found by its own test), ambiguousBars counter.
- diagnostics.ts: model-conditional rejections (STAGE_DEPTH>=6), summarizeOrderFlow.
- validate.ts: 14th test "Pending-order telemetry".
- UI: merged robustness/sample verdict banner; time-scaled step equity curve with markers; zone-stage rejections column; pending-order flow panel + collision counter; SMT N/A grey-out; cost R column + >30% cost warning; weekend-dropped audit card; deep history options (10000/15000/25000).
- Verified: 14/14 self-tests, tsc+eslint clean on touched files, agent-browser golden path (dashboard -> Backtesting -> run -> new panels render).
- AFTER (same window): 5000 raw bars 19->23 trades, +0.77->+1.03R, PF 1.21->1.14, exp identical +0.04R; 1500b: 3->6 trades, 0->-1.3R (honest loss). Deep 15000 requested -> 10952 weekday bars (~5 months): 69 trades, 58% WR, +0.18R exp, PF 2.0, DD 3.64R, 4/5 WF periods positive, OOS +5.15R, flags GREEN (MODERATE sample). Costs 39-70% of gross across runs.
- Committed 6a3368c, pushed (Cloudflare CI deploys).

Stage Summary:
- Model C/OB still nearly zero-trades (NO_ORDER_BLOCK window rejections now VISIBLE per model); not tuned — funnel shows the constraint honestly.
- Expiry diagnostics show 26/93 expired orders touched AFTER the window; median closest approach 0.12R on deep run.
- Deep runs take ~50s first call (fetch+compute) then cached; Workers CPU limit is the deployment-side risk for 25000 bars.

---
Task ID: 10
Agent: Super Z (main agent)
Task: Review post-P0 deployed terminal (4 new screenshots, 15000-deep + 5000 runs, 3 ambiguity modes) and answer "what should we improve".

Work Log:
- Sliced 4 full-page captures (15770/15620/12891px) into 58 readable bands; read funnel, rejections, models, RR/session, pending-order, inspector, WF/MC, losers, MFE/MAE, sessions, scores, management, data-quality, trades table.
- Verified P0 fixes live: weekend audit (2711 dropped, 0 dupes, 14 expected reopen gaps), time-axis equity +6.7R with markers, cost column + 44% warning banner, model-conditional zone rejections, pending-order telemetry (127/48/66/13/21, closest 0.12R, collisions 4), SMT greyed N/A.
- Found deep-fetch instability: same "15000 deep" selector previously returned 10952 weekday bars/69 trades (OOS +5.15R), now 7289 bars/48 trades (OOS -1.67R) — silent shortfall ~10000 raw bars vs 15000 requested; OOS sign flipped between runs.
- Identified ambiguity modes nearly no-op on deep window (4 collisions; pessimistic vs ltf identical outcomes) but UI gives no affected-trade context; Randomized 5000 run differs materially (23 trades, 65.2% WR).
- Key economics found: costs 5.34R of 12.01R gross (44%); off-session -3.2R vs asia +8.5R; TP3 hit 2.08% while median available RR 23.19R (unreachable farthest-level ladder makes minRR gate non-binding 372/396); 84% of losers never reached +0.5R MFE; fill plateau 37.8% by bar 12; OB creation still 42/13984 (0.58%) so Model C 1 trade / D 0; "no-smt 100% of losers" attribution row is noise when SMT is N/A; GREEN banner hides negative OOS period.

Stage Summary:
- P1 improvement plan delivered: (1) deep-fetch accounting + shortfall warning (sample instability flipped OOS sign), (2) cost-aware setup gate / configurable cost model, (3) entry-placement experiments (tolerance fill, proximal-edge anchor, expiry sweep) — 84% of losers never see +0.5R, (4) target-ladder realism (TP3 2% hit, 23R median RR), (5) OB creation sub-funnel, (6) banner honesty re negative OOS, (7) suppress no-smt loser-attribution when SMT N/A, (8) ambiguity affected-trades context.

---
Task ID: 11
Agent: Super Z (main agent)
Task: "Improve against these findings" — implement the P1/P2 improvement plan from the Task-10 screenshot audit (engine v5).

Work Log:
- types/sequence/targets/execution/diagnostics/backtest/route/backtest-tab all extended; 18/18 self-tests, tsc + eslint clean on touched files.
- Fetch accounting (P1-1): BacktestResult.fetch + DataQuality.requestedBars/rawFetched/fetchRequests/fetchShortfallPct; deep windows with >10% shortfall append a WARNING to the audit note; UI "Raw fetched / req" card + amber shortfall banner. Today's deep run received 15000/15000 (3 chunks, cached) — the earlier 7289-bar episode is now impossible to miss.
- Execution-cost gate (P1-2): cfg.maxCostPctOfR (default 0.35, UI select off/25/35/50) rejects setups at stage 5b with EXCESSIVE_COST (STAGE_DEPTH 9) + funnel row "Execution cost within gate". 5000b: 16 setups rejected.
- Entry placement (P1-3): cfg.entryAnchor edge|midpoint (UI select), cfg.entryToleranceR 0/0.05/0.1 (last-look fills; trade.toleranceFill + orderFlow.toleranceFills surfaced). compareDim=entry on 5000b: edge strict 24t +1.92R; edge+0.05R 26t 73.1% WR +5.02R; midpoint 19t -0.08R (location matters more than fills).
- Target realism (P1-4): selectTradeTargets horizon cap (cfg.targetHorizonR default 8R; route param horizon); rrDiagnostics.medianTp1Rr/medianTp3Rr/targetsCapped; TradeRecord.barsToTp1/2/3 + management medians. 5000b: median TP1 = 0.3R (!), TP3 6.3R, 2799 far levels capped, TP3 median 44 bars.
- OB pipeline (P1-5): series-wide zonesCreated/invalidated + per-candidate skip counters + note; UI panel. 5000b verdict: 180 created, 171 invalidated by close-through-midpoint (95%), 330 window-seen, 146 skip-mitigated, 20 candidates w/ OB, 3 Model C valid → close-through-midpoint invalidation is THE bottleneck (diagnosis only, no definition change).
- Honesty (P2): robustnessFlags green requires oos.netR >= 0 (OOS negative = max YELLOW + explicit bullet); bestPeriodShare 60–80% now explains the YELLOW ("66% of net gain from a single period"); no-smt loser tag only when SMT live; score bucket 60–69 (C) added.
- compareDimension(dimension) engine + API compareDim param + UI dimension select (strictness/expiry/sessions/entry). 5000b: expiry 6/12/24 → 18/24/27 trades net 2.58/1.92/2.43R (plateau confirmed); sessions KZ-only 17t +4.13R vs all 24t +1.92R.
- BEFORE/AFTER (XAUUSD 15m, balanced, same windows): 5000b 23t/+1.03R/PF1.14/DD3.65 → 24t/+1.92R/PF1.33/DD2.21; deep15000 69t/+12.63R/PF2.0/DD3.64 → 72t/+17.12R/PF2.87/DD2.26 (OOS +5.15→+2.99R, still positive; flags YELLOW explained by 66% single-period concentration).
- Browser smoke test: dashboard → Backtesting → new selects render → 5000-bar run → OB pipeline/fetch/RR-medians/bars-to-TP/tolerance panels all render with live data.
- Committed 8cd5f73, pushed (Cloudflare CI deploys).

Stage Summary:
- Engine v5 turns the four screenshot findings into levers + evidence: costs gated (not just reported), entry placement comparable, targets realistic, OB bottleneck identified (invalidation, not creation). Net results improved on both windows without tuning any return-based parameter — every change is an execution-feasibility or honesty rule.
- Next candidates: OB invalidation semantics experiment (P2, now measurable), tolerance-default decision (needs user: generous fill assumption), SMT proxy pair.

---
Task ID: 12
Agent: Super Z (main agent)
Task: "Do what's best" — execute the P2 queue from Task 11: OB invalidation
semantics experiment, SMT proxy pair, min-score gate + tolerance guidance.

Work Log:
- State check first: P1 (engine v5, 8cd5f73) was already committed/pushed last
  session — the conversation summary was stale. Proceeded to P2.
- Probed TwelveData free plan for SMT companions: XAG/USD + all XAU crosses
  paywalled, DXY invalid symbol; EUR/USD, GBP/USD, USD/EUR, AUD/USD live.
  Measured XAUUSD↔AUDUSD 15m log-return correlation over 2000 aligned bars:
  r=0.548, 60.7% directional agreement → AUD/USD adopted as labelled proxy.
- OB invalidation (P2-1): ObInvalidation type (close-mid|wick-mid|close-distal|
  wick-distal) in zones.ts with shared obInvalidated(); detectOrderBlocks +
  buildSeriesContext take the mode; EngineConfig.obInvalidation (default
  close-mid); compareDimension "obInvalidation" (4 rows); route/UI selects;
  OB-pipeline panel title shows active rule. Self-test #19: four modes give
  4 distinct death bars on a hand-built zone (close-mid→4, wick-mid→3,
  close-distal→5, wick-distal→4).
- SMT companion (P2-2): getCompanionCandles + SMT_COMPANIONS in market layer
  (XAUUSD→AUD/USD live; XAGUSD→XAU/USD live canonical-inverted); runBacktest
  fetches companion at the traded window depth (deep→deep); BacktestResult.smt
  {companion, source, events, coveragePct, note}; legacy silverSource kept.
  Failure now returns {error} so the note distinguishes throttling from
  impossible. XAU/XAG hard-coded strings in confluence traces removed.
  Live SMT tab (smt.ts) upgraded from SIMULATED silver to live AUD/USD with
  silver fallback; badge shows the actual companion label.
- BUGFIX (smtseries): index-pairing (k-th vs k-th swing) silently killed SMT
  on deep windows — gold 1500 vs AUD 478 swing highs → median pair distance
  10,189 bars → contemporaneity gate rejected 100% (0 events at 66% coverage).
  Replaced with time-proximity nearest-swing pairing (≤8 bars, binary search),
  each series' HH/LH measured against its OWN previous swing. Deep run after
  fix: 0 → 1096 events at 100% coverage. (The earlier "28 events on 5000b"
  worked only by luck of similar swing densities.)
- Coverage honesty: <60% companion coverage appends a hard warning to the SMT
  note (deep fetch can stop early on the 7-req/min token bucket).
- Min-score gate (P2-3): tierB select (70 default/75/80) + route param +
  validation + config echo. Entry-tolerance tooltip now states strict touch is
  the honest default and points to compare→entry for materiality.
- validate.ts +2 tests → 20/20 (OB modes; SMT causal stamping — first fixture
  had equal-high swing bars which kill fractal pivots, rebuilt with strict
  unique highs).
- AFTER (XAUUSD 15m balanced, scripts/after-v6-p2.json): 5000b 25t/+1.95R
  PF1.34 (v5: 24t/+1.92R); deep 10952b 82t/+21.78R PF3.36 (v5: 72t/+17.12R).
  The deep shift is the SMT +5 optional-confluence bonus finally running on
  LIVE data — no return-based parameter touched. SMT fired on 2.91% of 5000b
  candidates (narrow confluence, not a blanket bonus).
- obInvalidation finding: all four rules IDENTICAL trade sets on 5k + deep
  windows (Model C=2, D=0; FVG Model B dominates) → the 95% close-through-
  midpoint invalidation rate is NOT the OB bottleneck; hypothesis closed with
  evidence, knob kept as a guard for future OB-detector work.
- Browser smoke: dashboard → Backtesting → new selects (OB invalidation, Min
  score, compare dim) render; run executes; SMT companion panel renders both
  LIVE (verified via API: 100% coverage, 1096 events) and unavailable states.
  TwelveData daily cap burned during verification (812/800) — degradation
  paths (companion error note, base 502) exercised and honest.
- Committed 179f8be, pushed (Cloudflare CI deploys).

Stage Summary:
- Engine v6 ships three P2 items + one real correctness bugfix (SMT pairing).
- Key insight: OB scarcity is upstream of invalidation (creation/window), and
  SMT went from decorative (silently absent or simulated) to live-but-labelled
  proxy confluence — with coverage accounting so partial data can't masquerade
  as full-window judgment.
- Next candidates: OB creation-side experiment (displacement factor scan, now
  that invalidation is ruled out), SMT bonus weighting by measured alignment
  frequency (only if it proves to over-fire), revisit tolerance default after
  user decision on generous-fill assumptions.

---
Task ID: 13
Agent: Super Z (main agent)
Task: "Improve — best possible results" — engine v7: OB creation-side scan,
SMT honesty split, editable cost model; then un-block deep windows (Worker CPU).

Work Log:
- P3-1 OB displacement knob: EngineConfig.obDisplacementFactor (default 1.2)
  threaded through buildSeriesContext -> detectOrderBlocks; route param obDisp
  (0.5-3); UI select; OB-pipeline panel title + note echo the active factor.
- P3-2 compare dimension "obDisplacement" (0.8/1.0/1.2/1.5). NOTE: compare=1
  with this dim at 5000 bars hits the Worker CPU limit (5 runs/request); the
  factor variants as separate single runs work and were used for the scan.
- P3-3 SMT split: smtSplitOf(trades) -> BacktestResult.smtSplit (null when no
  live companion); UI table in the SMT panel with honest small-sample notes.
- P3-4 editable cost model: route params spread/slip/commBp override
  cfg.costs[symbol]; UI numeric inputs (empty = defaults); route GET now builds
  ONE config object shared by main + sensitivity + comparison runs (also fixed
  sensitivity runs silently ignoring targetHorizonR).
- Self-tests 21-23 -> 23/23: displacement knob controls creation; cost override
  reaches accounting AND the gate ($5 spread + 0.01R gate -> 0 trades);
  mitigation range-queries equivalence (200 randomized trials, 0 mismatches).
- REAL-DATA FINDINGS (XAUUSD 15m, balanced, scripts/v7-*.json):
  * OB displacement scan (5000 bars): 1.2x -> 178 OBs/20 candidates/0 Model C,
    +1.44R PF 1.25; 0.8x -> 395 OBs/40 candidates/Model C 1 trade, +2.05R PF
    1.37; 1.5x -> 80 OBs/14 candidates, +3.57R PF 1.62 (trade sets stay mostly
    Model B; looser creation adds candidates, some become better trades).
  * SMT split: 5000b aligned 16t -0.01R exp vs not-aligned 7t +0.22R; deep
    15000 aligned 66t +0.19R vs not-aligned 24t +0.32R -> on BOTH windows the
    +5 SMT bonus does not pay for itself (underperform 0.13-0.23R). No param
    changed — the panel now shows this so the bonus can be judged honestly.
  * Deep 15000: full 15000/15000 received (0% shortfall, 3 chunk requests),
    90 trades, 61.1% WR, +0.22R exp, net +19.96R, PF 2.69, DD 3.38R, OOS
    period structure YELLOW.
- DEPLOYMENT BUG HUNT (deep runs returned Cloudflare 1102 all session): local
  profiling (scripts/profile-deep.ts, profile-context.ts) showed engine CPU
  921ms at 11.7k bars. Fixed two O(n x window) hot spots:
  * zones.ts: RangeExtreme sparse tables + firstMitigationIndex() — the FVG/OB
    mitigation scans (O(zones x bars)) now answer first-death in O(log n);
    obInvalidated kept for single-candle checks.
  * volatility.ts volRegimeSeries + regime.ts marketRegimeSeries: per-bar
    slice+sort (200-el) -> rolling sorted windows; incremental Kaufman path.
  * Result: buildSeriesContext 765->157ms, end-to-end 921->329ms; after
    deploy the deep 15000 run completes again.
  * Equivalence proven twice on real data: pre/post trade lists byte-identical
    on shared signalTimes (23/23), plus randomized tree-vs-linear test 23.
- Commits: 5177ce4 (engine v7), 70f4507 (sparse-table mitigation), 9f9ce4b
  (rolling windows). All pushed; Cloudflare CI deployed each; prod selftest
  23/23 verified.

Stage Summary:
- Engine v7 = three new decision levers (OB creation scan, SMT verdict split,
  editable cost model) + deep windows un-blocked with 3x less Worker CPU.
- The SMT split evidence argues the +5 bonus is currently NOT justified
  (aligned <= not-aligned on both windows); left in place, surfaced honestly —
  candidate for a weighting change ONLY if the user decides the proxy pairing
  should be re-weighted, not from silent tuning.
- Known deployment fragility: compare=1 requests at 5000 bars can still hit
  Worker CPU limits (5 runs per request); single runs are fine.
