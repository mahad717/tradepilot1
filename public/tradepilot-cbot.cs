//+------------------------------------------------------------------+
//|                                              TradePilot cBot.cs  |
//|     Trades TradePilot ICT signals on this cTrader account with   |
//|     the ENGINE BUILT IN — no website connection required.        |
//|                                                                  |
//|   LOCAL ENGINE (default): the full ICT setup builder from the    |
//|   TradePilot engine (HTF structure bias -> liquidity sweep ->    |
//|   displacement -> MSS/BOS -> fresh FVG/OB -> structural target   |
//|   ladder, 6-category scoring, tier gate) runs on YOUR broker's   |
//|   own candles, on every closed bar. Nothing to allowlist, no     |
//|   feed URL, works even if the website is down.                   |
//|                                                                  |
//|   WEBSITE FEED (fallback): polls the TradePilot signal feed      |
//|   instead (same rules, computed on the website's data). Requires |
//|   network-access consent for the feed host.                      |
//|                                                                  |
//|   Trade lifecycle (both modes, mirrors the backtest):            |
//|   signal -> limit order at the setup entry (expires if price     |
//|   never arrives) -> partial ladder TP1/TP2/final (30/35/35 by    |
//|   default) -> breakeven stop after TP1 -> final target.          |
//|                                                                  |
//|   SETUP (once):                                                  |
//|   1. cTrader -> Automate tab -> New cBot -> replace the entire   |
//|      generated code with this file -> Build (Ctrl+B).            |
//|      *** PASTE RULE: click into the editor, press Ctrl+A (select |
//|      ALL), then paste. Appending below old content fails the     |
//|      build with hundreds of CS1529 "using clause" errors — a     |
//|      using block is only legal at the very top of the file.      |
//|   2. Add the bot to your broker's gold chart, M15 timeframe      |
//|      (any symbol name: XAUUSD / GOLD / XAUUSD.m ...). The engine |
//|      adapts to the chart timeframe like the website does.        |
//|   3. Local engine mode needs NO network consent. Website-feed    |
//|      mode asks for it (only the TradePilot feed is called).      |
//|   4. Set your lot size or risk % in the parameters, press Play.  |
//|                                                                  |
//|   SMT companion (optional confluence): the engine compares gold  |
//|   with a companion symbol (default XAGUSD) for SMT divergence,   |
//|   exactly like the site. Set it to a silver symbol your broker   |
//|   offers (XAGUSD / SILVER / XAGUSD.a ...).                       |
//|                                                                  |
//|   HONEST NOTE: the rules are the SAME RULES as the website, but  |
//|   your broker's candles differ from the website's data vendor    |
//|   (levels and timing can differ slightly). Signals will be       |
//|   similar, not tick-identical.                                   |
//|                                                                  |
//|   RISK WARNING: this bot places REAL orders on a REAL account.   |
//|   Test on a DEMO account first. TradePilot signals are           |
//|   educational strategy output, not financial advice.             |
//+------------------------------------------------------------------+
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Net.Http;
using cAlgo.API;
using cAlgo.API.Internals;

namespace cAlgo.Robots
{
    // namespace-scope enums — cTrader's parameter UI cannot bind nested enums
    public enum TpEntryMode { Auto, Market }
    public enum TpSignalSource { LocalEngine, WebsiteFeed }

    // ===========================================================================
    // ENGINE PORT — faithful C# port of the TradePilot engine live path
    // (src/lib/ict/: swings, volatility, regime, structure, htf, zones,
    // liquidity, smtseries, sweepquality, displacement, zonequality, targets,
    // sessions, costs, sequence). String constants ("BULLISH", "MSS", ...)
    // intentionally mirror the TypeScript unions so the two implementations
    // stay comparable line by line. Diagnostics/funnels/traces (UI-only on the
    // site) are omitted — they do not affect any decision.
    // ===========================================================================
    internal static partial class TpEngine
    {
        // ------------ primitive types ------------

        public sealed class Bar
        {
            public long Time;   // bar OPEN time, unix seconds (UTC)
            public double O, H, L, C;
        }

        public sealed class Swing { public int Index; public long Time; public double Price; public string Type; }        // HIGH | LOW
        public sealed class Sweep { public int Index; public long Time; public string Side; public double Level, Extreme, Close; } // BUY_SIDE | SELL_SIDE
        public sealed class Pool { public long Time; public double Price; public string Type; }                            // EQH | EQL
        public sealed class Zone
        {
            public string Id; public double Top, Bottom; public long StartTime;
            public int StartIndex; public string Kind; public string Direction; // FVG|OB, BULLISH|BEARISH
        }
        public sealed class StructureEvent { public int Index; public long Time; public string Type, Direction; public double Level; } // BOS|MSS
        public sealed class SmtEvent { public int Index; public string Type; } // BULLISH | BEARISH

        public sealed class SweepAssessment { public string Cls; public double Quality, WickBeyondAtr, CloseBackRatio; public int FollowThrough; }
        public sealed class DispAssessment { public double Quality, BodyRatio, RangeAtrMult; public int Consecutive; }
        public sealed class ZoneQualityResult { public double Score; }

        public sealed class StructuralTarget { public double Price; public string Source; public double Weight; }

        public sealed class PrevExtremes
        {
            public double PrevDayHigh, PrevDayLow, PrevWeekHigh, PrevWeekLow;
            public double? AsiaHigh, AsiaLow;
        }

        public sealed class TradeTargets
        {
            public StructuralTarget Tp1, Tp2, Tp3;
            public double MaxRR, RrToTp1, RrToTp2, RrToTp3;
            public int Capped;
        }

        public sealed class CostModel { public double Spread, SlippagePerSide, CommissionPctPerSide; }

        public sealed class EngineConfig
        {
            public int MaxSweepAgeBars = 8;
            public int MaxStructureAgeBars = 14;
            public int OrderExpiryBars = 30;
            public double SweepQualityMin = 0.35;
            public bool AllowUnconfirmedSweep = true;
            public double DisplacementQualityMin = 0.45;
            public double ZoneQualityMin = 0.4;
            public bool RequireHtfBias = true;
            public bool RequireDiscountPremium = false;
            public bool RequireKillzone = false;
            public bool RequireSweep = false;
            public string[] Models = { "A_SWEEP_REVERSAL", "B_FVG_CONTINUATION", "C_OB_REVERSAL", "D_FVG_OB_CONFLUENCE" };
            public double MinRR = 2.0;
            public double MinStopAtrMult = 0.15;
            public double MaxStopAtrMult = 2.5;
            public double MaxStopPctOfPrice = 0.02;
            public int TierAPlus = 90, TierA = 80, TierB = 70;
            public string[] Sessions = { };
            public string[] BlockedVolRegimes = { "EXTREME" };
            public int RangeRegimeMinScore = 80;
            public int MinBarsBetweenSignals = 8;
            public bool OneTradePerSweep = true;
            public bool SameZoneCooldown = true;
            public double MaxCostPctOfR = 0.35;
            public string EntryAnchor = "edge";
            public double EntryToleranceR = 0.15;
            public double TargetHorizonR = 12;
            public string ObInvalidation = "close-mid";
            public double ObDisplacementFactor = 1.2;
            public int WarmupBars = 60;
            public int RangeLookbackBars = 96;
            public int SmtWindowBars = 20;
        }

        public static readonly string[] ModelOrder =
            { "A_SWEEP_REVERSAL", "B_FVG_CONTINUATION", "C_OB_REVERSAL", "D_FVG_OB_CONFLUENCE", "E_SMT_REVERSAL" };

        public static EngineConfig DefaultConfig() { return new EngineConfig(); }

        public static double Round2(double x) { return Math.Round(x * 100) / 100; }

        // JS Math.round = half up for positives; every input here is >= 0
        private static double Jr(double x) { return Math.Floor(x + 0.5); }

        public static string TierFor(double score, EngineConfig cfg)
        {
            if (score >= cfg.TierAPlus) return "A+";
            if (score >= cfg.TierA) return "A";
            if (score >= cfg.TierB) return "B";
            return "NO_TRADE";
        }

        // ------------ swings.ts ------------

        public static List<Swing> FindSwings(List<Bar> candles, int lookback)
        {
            var swings = new List<Swing>();
            for (int i = lookback; i < candles.Count - lookback; i++)
            {
                bool isHigh = true, isLow = true;
                for (int j = i - lookback; j <= i + lookback; j++)
                {
                    if (j == i) continue;
                    if (candles[j].H >= candles[i].H) isHigh = false;
                    if (candles[j].L <= candles[i].L) isLow = false;
                    if (!isHigh && !isLow) break;
                }
                if (isHigh) swings.Add(new Swing { Index = i, Time = candles[i].Time, Price = candles[i].H, Type = "HIGH" });
                if (isLow) swings.Add(new Swing { Index = i, Time = candles[i].Time, Price = candles[i].L, Type = "LOW" });
            }
            swings.Sort((a, b) => a.Index - b.Index);
            return swings;
        }

        // ------------ volatility.ts ------------

        public static double TrueRange(List<Bar> candles, int i)
        {
            if (i <= 0) return candles[0].H - candles[0].L;
            var c = candles[i];
            double prev = candles[i - 1].C;
            return Math.Max(c.H - c.L, Math.Max(Math.Abs(c.H - prev), Math.Abs(c.L - prev)));
        }

        public static double[] AtrSeries(List<Bar> candles, int period)
        {
            var @out = new double[candles.Count];
            double sum = 0;
            for (int i = 0; i < candles.Count; i++)
            {
                sum += TrueRange(candles, i);
                if (i >= period) sum -= TrueRange(candles, i - period);
                @out[i] = sum / Math.Min(i + 1, period);
            }
            return @out;
        }

        // sorted-list helpers mirroring the TS binary insert/remove
        private static void SortedInsert(List<double> sorted, double v)
        {
            int lo = 0, hi = sorted.Count;
            while (lo < hi) { int mid = (lo + hi) >> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid; }
            sorted.Insert(lo, v);
        }
        private static void SortedRemove(List<double> sorted, double v)
        {
            int lo = 0, hi = sorted.Count;
            while (lo < hi) { int mid = (lo + hi) >> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid; }
            if (lo < sorted.Count && sorted[lo] == v) sorted.RemoveAt(lo);
            else { int idx = sorted.IndexOf(v); if (idx != -1) sorted.RemoveAt(idx); }
        }

        public static string[] VolRegimeSeries(List<Bar> candles, double[] atr, int window)
        {
            var @out = new string[candles.Count];
            for (int i = 0; i < @out.Length; i++) @out[i] = "NORMAL";
            var pct = new double[candles.Count];
            for (int i = 0; i < candles.Count; i++) pct[i] = candles[i].C > 0 ? atr[i] / candles[i].C : 0;
            var sorted = new List<double>();
            for (int i = 0; i < candles.Count; i++)
            {
                if (i >= 1) SortedInsert(sorted, pct[i - 1]);
                int evictIdx = i - 1 - window;
                if (evictIdx >= 0) SortedRemove(sorted, pct[evictIdx]);
                if (i >= 30 && sorted.Count > 0)
                {
                    double p20 = sorted[Math.Min(sorted.Count - 1, (int)Math.Floor(0.2 * sorted.Count))];
                    double p80 = sorted[Math.Min(sorted.Count - 1, (int)Math.Floor(0.8 * sorted.Count))];
                    double p95 = sorted[Math.Min(sorted.Count - 1, (int)Math.Floor(0.95 * sorted.Count))];
                    @out[i] = pct[i] < p20 ? "LOW" : pct[i] < p80 ? "NORMAL" : pct[i] < p95 ? "HIGH" : "EXTREME";
                }
            }
            return @out;
        }

        // ------------ regime.ts ------------
        // NOTE: lastFlipIndex is never updated in the TS source — ported as-is
        // (recentFlip is therefore always false; parity over elegance).

        public static string[] MarketRegimeSeries(List<Bar> candles, List<StructureEvent> structureEvents, double[] atr, int lookback)
        {
            int n = candles.Count;
            var regimes = new string[n];
            for (int i = 0; i < n; i++) regimes[i] = "UNCLEAR";
            int evIdx = 0, trendDir = 0, flips = 0;
            double lastFlipIndex = -1000;
            double path = 0;
            int refWindow = 200;
            var atrPct = new double[n];
            for (int i = 0; i < n; i++) atrPct[i] = candles[i].C > 0 ? atr[i] / candles[i].C : 0;
            var sorted = new List<double>();
            for (int i = 0; i < n; i++)
            {
                while (evIdx < structureEvents.Count && structureEvents[evIdx].Index <= i)
                {
                    int dir = structureEvents[evIdx].Direction == "BULLISH" ? 1 : -1;
                    if (dir != trendDir && trendDir != 0) flips++;
                    trendDir = dir;
                    evIdx++;
                }
                int start = Math.Max(0, i - lookback + 1);
                if (i >= 1) path += Math.Abs(candles[i].C - candles[i - 1].C);
                if (start >= 1) path -= Math.Abs(candles[start].C - candles[start - 1].C);
                double netMove = Math.Abs(candles[i].C - candles[start].O);
                double er = path > 0 ? netMove / path : 0;
                double atrPctI = atrPct[i];
                if (i >= 1) SortedInsert(sorted, atrPct[i - 1]);
                int evictIdx = i - 1 - refWindow;
                if (evictIdx >= 0) SortedRemove(sorted, atrPct[evictIdx]);
                double medianAtrPct = sorted.Count > 0 ? sorted[(int)Math.Floor((double)sorted.Count / 2)] : atrPctI;
                bool expansion = medianAtrPct > 0 && atrPctI > medianAtrPct * 1.6;
                bool contraction = medianAtrPct > 0 && atrPctI < medianAtrPct * 0.6;
                bool recentFlip = i - lastFlipIndex < lookback / 2;
                if (trendDir == 0) regimes[i] = "UNCLEAR";
                else if (recentFlip && er < 0.25) regimes[i] = "RANGE";
                else if (expansion && er >= 0.35) regimes[i] = "EXPANSION";
                else if (trendDir == 1 && er >= 0.3) regimes[i] = "TREND_UP";
                else if (trendDir == -1 && er >= 0.3) regimes[i] = "TREND_DOWN";
                else if (contraction && er < 0.2) regimes[i] = "CONSOLIDATION";
                else if (er < 0.15) regimes[i] = "RANGE";
                else regimes[i] = "UNCLEAR";
            }
            return regimes;
        }

        // ------------ structure.ts ------------

        public sealed class StructureWalk { public List<StructureEvent> Events; public string[] TrendByIndex; }

        public static StructureWalk StructureWalkSeries(List<Bar> candles, int lookback)
        {
            var all = FindSwings(candles, lookback);
            var events = new List<StructureEvent>();
            var trendByIndex = new string[candles.Count];
            for (int i = 0; i < trendByIndex.Length; i++) trendByIndex[i] = "NEUTRAL";
            string trend = "NEUTRAL";
            Swing pendingHigh = null, pendingLow = null;
            int cursor = 0;
            for (int i = lookback + 1; i < candles.Count; i++)
            {
                while (cursor < all.Count && all[cursor].Index + lookback <= i)
                {
                    var s = all[cursor];
                    if (s.Type == "HIGH") pendingHigh = s; else pendingLow = s;
                    cursor++;
                }
                double close = candles[i].C;
                if (pendingHigh != null && close > pendingHigh.Price)
                {
                    events.Add(new StructureEvent { Index = i, Time = candles[i].Time, Type = trend == "BEARISH" ? "MSS" : "BOS", Direction = "BULLISH", Level = pendingHigh.Price });
                    trend = "BULLISH";
                    pendingHigh = null;
                }
                else if (pendingLow != null && close < pendingLow.Price)
                {
                    events.Add(new StructureEvent { Index = i, Time = candles[i].Time, Type = trend == "BULLISH" ? "MSS" : "BOS", Direction = "BEARISH", Level = pendingLow.Price });
                    trend = "BEARISH";
                    pendingLow = null;
                }
                trendByIndex[i] = trend;
            }
            return new StructureWalk { Events = events, TrendByIndex = trendByIndex };
        }

        // ------------ htf.ts ------------

        public sealed class HtfCandle { public long Time, CloseTime; public double O, H, L, C; }

        public static List<HtfCandle> Resample(List<Bar> candles, long htfSeconds)
        {
            var @out = new List<HtfCandle>();
            if (candles.Count == 0) return @out;
            int last = candles.Count - 1;
            int prevIdx = last - 1 >= 0 ? last - 1 : 0;
            long intervalGuess = Math.Max(1, candles[last].Time - candles[prevIdx].Time);
            var buckets = new SortedDictionary<long, List<Bar>>();
            foreach (var c in candles)
            {
                long b = (long)Math.Floor((double)c.Time / htfSeconds) * htfSeconds;
                List<Bar> arr;
                if (!buckets.TryGetValue(b, out arr)) { arr = new List<Bar>(); buckets[b] = arr; }
                arr.Add(c);
            }
            long lastDataTime = candles[candles.Count - 1].Time;
            foreach (var kv in buckets)
            {
                long open = kv.Key;
                var arr = kv.Value;
                long closeTime = open + htfSeconds;
                if (closeTime > lastDataTime + intervalGuess) continue;
                double hi = arr[0].H, lo = arr[0].L;
                foreach (var x in arr) { if (x.H > hi) hi = x.H; if (x.L < lo) lo = x.L; }
                @out.Add(new HtfCandle { Time = open, CloseTime = closeTime, O = arr[0].O, H = hi, L = lo, C = arr[arr.Count - 1].C });
            }
            return @out;
        }

        public static string[] HtfBiasSeries(List<Bar> ltf, long intervalSeconds, long htfSeconds, int lookback)
        {
            var htf = Resample(ltf, htfSeconds);
            var swings = FindSwingsHtf(htf, lookback);
            string trend = "NEUTRAL";
            double? pendingHigh = null, pendingLow = null;
            int cursor = 0;
            var closeTimes = new List<long>();
            var trends = new List<string>();
            for (int i = 0; i < htf.Count; i++)
            {
                while (cursor < swings.Count && swings[cursor].Index + lookback <= i)
                {
                    var s = swings[cursor];
                    if (s.Type == "HIGH") pendingHigh = s.Price; else pendingLow = s.Price;
                    cursor++;
                }
                double close = htf[i].C;
                if (pendingHigh != null && close > pendingHigh.Value)
                {
                    trend = "BULLISH";
                    pendingHigh = null;
                }
                else if (pendingLow != null && close < pendingLow.Value)
                {
                    trend = "BEARISH";
                    pendingLow = null;
                }
                closeTimes.Add(htf[i].CloseTime);
                trends.Add(trend);
            }
            var bias = new string[ltf.Count];
            for (int i = 0; i < ltf.Count; i++)
            {
                long barCloseTime = ltf[i].Time + intervalSeconds;
                int lo = 0, hi2 = closeTimes.Count - 1;
                string res = "NEUTRAL";
                while (lo <= hi2)
                {
                    int mid = (lo + hi2) >> 1;
                    if (closeTimes[mid] <= barCloseTime) { res = trends[mid]; lo = mid + 1; }
                    else hi2 = mid - 1;
                }
                bias[i] = res;
            }
            return bias;
        }

        private static List<Swing> FindSwingsHtf(List<HtfCandle> candles, int lookback)
        {
            var swings = new List<Swing>();
            for (int i = lookback; i < candles.Count - lookback; i++)
            {
                bool isHigh = true, isLow = true;
                for (int j = i - lookback; j <= i + lookback; j++)
                {
                    if (j == i) continue;
                    if (candles[j].H >= candles[i].H) isHigh = false;
                    if (candles[j].L <= candles[i].L) isLow = false;
                    if (!isHigh && !isLow) break;
                }
                if (isHigh) swings.Add(new Swing { Index = i, Time = candles[i].Time, Price = candles[i].H, Type = "HIGH" });
                if (isLow) swings.Add(new Swing { Index = i, Time = candles[i].Time, Price = candles[i].L, Type = "LOW" });
            }
            swings.Sort((a, b) => a.Index - b.Index);
            return swings;
        }

        public static long HtfSecondsFor(long intervalSeconds)
        {
            if (intervalSeconds <= 300) return 3600;
            if (intervalSeconds <= 900) return 14400;
            if (intervalSeconds <= 3600) return 14400;
            return 86400;
        }
    }
}
namespace cAlgo.Robots
{
    // ===========================================================================
    // ENGINE PORT part 2 — zones, liquidity, SMT, sweep/displacement/zone quality
    // ===========================================================================
    internal static partial class TpEngine
    {
        // ------------ zones.ts (first-death queries as linear scans — identical
        // results to the sparse-table version on the 400-bar live window) -------

        // mode: "fvg-bull" | "fvg-bear" | OB invalidation ("close-mid" | "wick-mid" | "close-distal" | "wick-distal")
        public static int FirstMitigationIndex(string mode, Zone z, int from, double[] lows, double[] highs, double[] closes)
        {
            int n = lows.Length;
            if (from < 0 || from >= n) return -1;
            double mid = (z.Top + z.Bottom) / 2;
            Func<int, bool> good;
            if (mode == "fvg-bull") good = i => lows[i] <= z.Bottom;
            else if (mode == "fvg-bear") good = i => highs[i] >= z.Top;
            else if (z.Direction == "BULLISH")
            {
                if (mode == "wick-mid") good = i => lows[i] < mid;
                else if (mode == "close-distal") good = i => closes[i] < z.Bottom;
                else if (mode == "wick-distal") good = i => lows[i] <= z.Bottom;
                else good = i => closes[i] < mid;
            }
            else
            {
                if (mode == "wick-mid") good = i => highs[i] > mid;
                else if (mode == "close-distal") good = i => closes[i] > z.Top;
                else if (mode == "wick-distal") good = i => highs[i] >= z.Top;
                else good = i => closes[i] > mid;
            }
            for (int i = from; i < n; i++) if (good(i)) return i;
            return -1;
        }

        public static List<Zone> DetectFvg(List<Bar> candles)
        {
            var zones = new List<Zone>();
            for (int i = 2; i < candles.Count; i++)
            {
                var a = candles[i - 2];
                var c = candles[i];
                if (c.L > a.H)
                {
                    zones.Add(new Zone { Id = "fvg-b-" + c.Time, Top = c.L, Bottom = a.H, StartTime = a.Time, StartIndex = i - 2, Kind = "FVG", Direction = "BULLISH" });
                }
                else if (c.H < a.L)
                {
                    zones.Add(new Zone { Id = "fvg-s-" + c.Time, Top = a.L, Bottom = c.H, StartTime = a.Time, StartIndex = i - 2, Kind = "FVG", Direction = "BEARISH" });
                }
            }
            return zones;
        }

        public static List<Zone> DetectOrderBlocks(List<Bar> candles, double[] atrValues, double displacementFactor, string mode)
        {
            var zones = new List<Zone>();
            for (int i = 1; i < candles.Count - 1; i++)
            {
                var ob = candles[i];
                var next = candles[i + 1];
                double atrDisp = atrValues[i + 1] != 0 ? atrValues[i + 1] : atrValues[i];
                if (!(atrDisp > 0)) continue;
                double minBody = displacementFactor * atrDisp;
                double nextBody = Math.Abs(next.C - next.O);
                if (nextBody < minBody) continue;
                bool obBearish = ob.C < ob.O;
                bool nextBullish = next.C > next.O;
                if (obBearish && nextBullish)
                {
                    zones.Add(new Zone { Id = "ob-b-" + ob.Time, Top = ob.H, Bottom = ob.L, StartTime = ob.Time, StartIndex = i, Kind = "OB", Direction = "BULLISH" });
                }
                else if (!obBearish && !nextBullish)
                {
                    zones.Add(new Zone { Id = "ob-s-" + ob.Time, Top = ob.H, Bottom = ob.L, StartTime = ob.Time, StartIndex = i, Kind = "OB", Direction = "BEARISH" });
                }
            }
            return zones;
        }

        // ------------ liquidity.ts ------------

        public static List<Sweep> DetectSweeps(List<Bar> candles, int lookback, int maxSweeps)
        {
            var swings = FindSwings(candles, lookback);
            var sweeps = new List<Sweep>();
            for (int i = lookback + 1; i < candles.Count; i++)
            {
                var c = candles[i];
                Swing lastHigh = null, lastLow = null;
                foreach (var s in swings)
                {
                    if (s.Index + lookback <= i && s.Index < i)
                    {
                        if (s.Type == "HIGH") lastHigh = s;
                        else lastLow = s;
                    }
                }
                if (lastHigh != null && c.H > lastHigh.Price && c.C < lastHigh.Price)
                {
                    sweeps.Add(new Sweep { Index = i, Time = c.Time, Side = "BUY_SIDE", Level = lastHigh.Price, Extreme = c.H, Close = c.C });
                }
                if (lastLow != null && c.L < lastLow.Price && c.C > lastLow.Price)
                {
                    sweeps.Add(new Sweep { Index = i, Time = c.Time, Side = "SELL_SIDE", Level = lastLow.Price, Extreme = c.L, Close = c.C });
                }
            }
            if (sweeps.Count > maxSweeps) sweeps.RemoveRange(0, sweeps.Count - maxSweeps);
            return sweeps;
        }

        public static List<Pool> DetectLiquidityPools(List<Bar> candles, int lookback, double tolerancePct, int maxPools)
        {
            var swings = FindSwings(candles, lookback);
            var pools = new List<Pool>();
            var highs = new List<Swing>(); var lows = new List<Swing>();
            foreach (var s in swings) { if (s.Type == "HIGH") highs.Add(s); else lows.Add(s); }
            for (int i = 1; i < highs.Count; i++)
            {
                var a = highs[i - 1]; var b = highs[i];
                if (b.Index - a.Index < lookback * 2) continue;
                if (Math.Abs(a.Price - b.Price) <= a.Price * tolerancePct)
                    pools.Add(new Pool { Time = b.Time, Price = b.Price, Type = "EQH" });
            }
            for (int i = 1; i < lows.Count; i++)
            {
                var a = lows[i - 1]; var b = lows[i];
                if (b.Index - a.Index < lookback * 2) continue;
                if (Math.Abs(a.Price - b.Price) <= a.Price * tolerancePct)
                    pools.Add(new Pool { Time = b.Time, Price = b.Price, Type = "EQL" });
            }
            if (pools.Count > maxPools) pools.RemoveRange(0, pools.Count - maxPools);
            return pools;
        }

        // ------------ smtseries.ts ------------

        public static List<SmtEvent> SmtSeries(List<Bar> gold, List<Bar> silver, int lookback, int contemporaneousBars)
        {
            var events = new List<SmtEvent>();
            if (gold.Count < 40 || silver.Count < 40) return events;

            var baseByTime = new Dictionary<long, int>();
            for (int i = 0; i < gold.Count; i++) baseByTime[gold[i].Time] = i;

            var g = FindSwings(gold, lookback);
            var s = FindSwings(silver, lookback);
            var gHigh = g.FindAll(x => x.Type == "HIGH");
            var gLow = g.FindAll(x => x.Type == "LOW");
            var sHigh = s.FindAll(x => x.Type == "HIGH");
            var sLow = s.FindAll(x => x.Type == "LOW");

            long spacing = gold.Count > 1 ? gold[1].Time - gold[0].Time : 900;

            // nearest companion swing (same type) by time — binary search over sorted times
            Func<List<Swing>, long, Swing> nearestSwing = (swings, t) =>
            {
                int lo = 0, hi = swings.Count - 1;
                Swing best = null;
                double bestDist = double.PositiveInfinity;
                while (lo <= hi)
                {
                    int mid = (lo + hi) >> 1;
                    double d = Math.Abs(swings[mid].Time - t);
                    if (d < bestDist) { bestDist = d; best = swings[mid]; }
                    if (swings[mid].Time < t) lo = mid + 1; else hi = mid - 1;
                }
                if (best != null && bestDist / spacing <= contemporaneousBars) return best;
                return null;
            };

            void Check(List<Swing> baseSwings, List<Swing> compSwings, string kind)
            {
                for (int k = 1; k < baseSwings.Count; k++)
                {
                    var gPrev = baseSwings[k - 1];
                    var gCur = baseSwings[k];
                    var sCur = nearestSwing(compSwings, gCur.Time);
                    if (sCur == null) continue;
                    int sIdx = compSwings.IndexOf(sCur);
                    if (sIdx < 1) continue;
                    var sPrev = compSwings[sIdx - 1];
                    int goldBar;
                    if (!baseByTime.TryGetValue(gCur.Time, out goldBar) || goldBar < 0) continue;

                    long confirmTime = Math.Max(gCur.Time, sCur.Time) + (long)(lookback + 1) * spacing;
                    int knowIdx = -1;
                    for (int i = goldBar; i < gold.Count; i++)
                    {
                        if (gold[i].Time + spacing >= confirmTime) { knowIdx = i; break; }
                    }
                    if (knowIdx < 0) continue;

                    bool goldHH = gCur.Price > gPrev.Price;
                    bool compHH = sCur.Price > sPrev.Price;
                    if (kind == "HIGH" && goldHH != compHH)
                        events.Add(new SmtEvent { Index = knowIdx, Type = "BEARISH" });
                    bool goldLL = gCur.Price < gPrev.Price;
                    bool compLL = sCur.Price < sPrev.Price;
                    if (kind == "LOW" && goldLL != compLL)
                        events.Add(new SmtEvent { Index = knowIdx, Type = "BULLISH" });
                }
            }

            Check(gHigh, sHigh, "HIGH");
            Check(gLow, sLow, "LOW");
            events.Sort((a, b) => a.Index - b.Index);
            return events;
        }

        // ------------ sweepquality.ts ------------

        public static SweepAssessment ClassifySweep(List<Bar> candles, Sweep sweep, double atr)
        {
            var c = candles[sweep.Index];
            bool bearishSweep = sweep.Side == "BUY_SIDE"; // swept a high → bearish sweep
            double beyond = bearishSweep ? c.H - sweep.Level : sweep.Level - c.L;
            double wickBeyondAtr = atr > 0 ? beyond / atr : 0;
            double backInside = bearishSweep ? sweep.Level - c.C : c.C - sweep.Level;
            double closeBackRatio = beyond > 0 ? Math.Max(0, Math.Min(1, backInside / beyond)) : 0;
            bool bodyBeyond = bearishSweep
                ? Math.Min(c.C, c.O) > sweep.Level
                : Math.Max(c.C, c.O) < sweep.Level;

            int followThrough = 0;
            for (int k = sweep.Index + 1; k <= Math.Min(sweep.Index + 3, candles.Count - 1); k++)
            {
                bool bull = candles[k].C > candles[k].O;
                if (bearishSweep ? !bull : bull) followThrough++;
            }

            string cls;
            if (bodyBeyond && followThrough == 0) cls = "TRUE_BREAKOUT";
            else if (bodyBeyond) cls = "BREAKOUT_FADE";
            else if (closeBackRatio >= 0.5) cls = "SWEEP_REJECTION";
            else cls = "SWEEP_NO_CONFIRM";

            double quality = 0;
            if (wickBeyondAtr >= 0.3) quality += Math.Min(0.35, wickBeyondAtr * 0.25);
            quality += closeBackRatio * 0.35;
            quality += Math.Min(0.3, followThrough * 0.1);
            if (cls == "TRUE_BREAKOUT") quality = Math.Min(quality, 0.15);

            return new SweepAssessment
            {
                Cls = cls,
                Quality = Math.Min(1, quality),
                WickBeyondAtr = Round2(wickBeyondAtr),
                CloseBackRatio = Round2(closeBackRatio),
                FollowThrough = followThrough,
            };
        }

        // ------------ displacement.ts ------------

        public static DispAssessment AssessDisplacement(List<Bar> candles, int index, string direction, double atr, bool createdFvg, bool brokeStructure)
        {
            var c = candles[index];
            double range = Math.Max(c.H - c.L, 1e-9);
            double body = Math.Abs(c.C - c.O);
            double bodyRatio = body / range;
            double rangeAtrMult = atr > 0 ? range / atr : 0;

            int consecutive = 1;
            for (int k = index - 1; k >= Math.Max(0, index - 3); k--)
            {
                bool bull = candles[k].C > candles[k].O;
                if (direction == "BULLISH" ? bull : !bull) consecutive++;
                else break;
            }

            double score = 0;
            score += Math.Min(0.3, Math.Max(0, (bodyRatio - 0.4) / 0.5) * 0.3);
            score += rangeAtrMult >= 2 ? 0.3 : rangeAtrMult >= 1.2 ? 0.2 + (rangeAtrMult - 1.2) * 0.125 : Math.Max(0, (rangeAtrMult - 0.6) * 0.167);
            score += Math.Min(0.15, (consecutive - 1) * 0.05);
            if (createdFvg) score += 0.15;
            if (brokeStructure) score += 0.1;

            return new DispAssessment
            {
                Quality = Math.Min(1, score),
                BodyRatio = Round2(bodyRatio),
                RangeAtrMult = Round2(rangeAtrMult),
                Consecutive = consecutive,
            };
        }

        public static int? FindDisplacementCandle(List<Bar> candles, int fromIndex, int toIndex, string direction)
        {
            int? best = null;
            double bestBody = 0;
            for (int i = Math.Max(0, fromIndex); i <= Math.Min(toIndex, candles.Count - 1); i++)
            {
                var c = candles[i];
                double body = Math.Abs(c.C - c.O);
                bool bullish = c.C > c.O;
                bool aligned = direction == "BULLISH" ? bullish : !bullish;
                if (aligned && body > bestBody) { bestBody = body; best = i; }
            }
            return best;
        }

        // ------------ zonequality.ts ------------

        public static ZoneQualityResult FvgQuality(List<Bar> candles, Zone zone, double atr, int currentIndex,
            int? sweepIndex, int? mssIndex, int? displacementIndex, bool inCorrectRangeHalf, bool htfAligned)
        {
            double score = 0;
            double size = Math.Abs(zone.Top - zone.Bottom);
            double sizeAtr = atr > 0 ? size / atr : 0;
            if (sizeAtr >= 0.15 && sizeAtr <= 1.2) score += 0.2;

            bool touched = false;
            for (int i = zone.StartIndex + 3; i <= currentIndex; i++)
            {
                var c = candles[i];
                if (zone.Direction == "BULLISH" && c.L <= zone.Top) touched = true;
                if (zone.Direction == "BEARISH" && c.H >= zone.Bottom) touched = true;
                if (touched) break;
            }
            score += !touched ? 0.25 : 0.1;

            // fvgCreatedBetween(zone, displacementIndex - 1, (mssIndex ?? displacementIndex) + 1)
            if (displacementIndex != null)
            {
                int completion = zone.StartIndex + 2;
                int mssEnd = mssIndex ?? displacementIndex.Value;
                if (completion >= displacementIndex.Value - 1 && completion <= mssEnd + 1) score += 0.25;
            }

            if (sweepIndex != null && zone.StartIndex + 2 > sweepIndex.Value) score += 0.1;
            if (inCorrectRangeHalf) score += 0.1;
            if (htfAligned) score += 0.1;

            return new ZoneQualityResult { Score = Math.Min(1, score) };
        }

        public static ZoneQualityResult ObQuality(List<Bar> candles, Zone zone, double atr, int currentIndex,
            int? sweepIndex, int? mssIndex, bool inCorrectRangeHalf)
        {
            double score = 0;
            var obCandle = candles[zone.StartIndex];
            double moveAway = Math.Abs(candles[Math.Min(zone.StartIndex + 2, candles.Count - 1)].C - obCandle.C);
            double moveAwayAtr = atr > 0 ? moveAway / atr : 0;
            if (moveAwayAtr >= 1) score += 0.3;
            if (mssIndex != null && mssIndex.Value > zone.StartIndex) score += 0.2;
            if (sweepIndex != null)
            {
                var sweep = candles[sweepIndex.Value];
                bool interacts = zone.Direction == "BULLISH"
                    ? zone.Bottom <= sweep.H + atr * 0.25
                    : zone.Top >= sweep.L - atr * 0.25;
                if (interacts) score += 0.2;
            }
            bool touched = false;
            for (int i = zone.StartIndex + 2; i <= currentIndex; i++)
            {
                var c = candles[i];
                if (zone.Direction == "BULLISH" && c.L <= zone.Top) touched = true;
                if (zone.Direction == "BEARISH" && c.H >= zone.Bottom) touched = true;
                if (touched) break;
            }
            score += !touched ? 0.2 : 0.05;
            if (inCorrectRangeHalf) score += 0.1;
            return new ZoneQualityResult { Score = Math.Min(1, score) };
        }
    }
}
namespace cAlgo.Robots
{
    using System.Linq;

    // ===========================================================================
    // ENGINE PORT part 3 — sessions (DST), targets, costs, scoring, setup builder
    // ===========================================================================
    internal static partial class TpEngine
    {
        // ------------ sessions.ts (DST arithmetic — exact port of the rules) ---

        private static readonly long EpochTicks = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).Ticks;

        private static long Unix(DateTime utc) { return (utc.Ticks - EpochTicks) / TimeSpan.TicksPerSecond; }
        private static DateTime Utc(long unixSec) { return new DateTime(EpochTicks + unixSec * TimeSpan.TicksPerSecond, DateTimeKind.Utc); }

        private static long LastSundayUtc(int year, int month0)
        {
            var lastDay = new DateTime(year, month0 + 1, 1, 0, 0, 0, DateTimeKind.Utc).AddDays(-1);
            int day = lastDay.Day - (int)lastDay.DayOfWeek;
            return Unix(new DateTime(year, month0, day, 1, 0, 0, DateTimeKind.Utc));
        }

        private static long NthSundayUtc(int year, int month0, int n, int hourUtc)
        {
            var first = new DateTime(year, month0, 1, 0, 0, 0, DateTimeKind.Utc);
            int day = 1 + ((7 - (int)first.DayOfWeek) % 7) + (n - 1) * 7;
            return Unix(new DateTime(year, month0, day, hourUtc, 0, 0, DateTimeKind.Utc));
        }

        // returns { spring, autumn } transition instants (unix seconds)
        private static void ZoneTransitions(int year, string zone, out long spring, out long autumn)
        {
            if (zone == "Europe/London") { spring = LastSundayUtc(year, 2); autumn = LastSundayUtc(year, 9); }
            else { spring = NthSundayUtc(year, 2, 2, 7); autumn = NthSundayUtc(year, 10, 1, 6); }
        }

        private static int ZoneOffsetMin(long timeSec, string zone)
        {
            // stdOffset / dstOffset per zone: London 0/60, New York -300/-240
            int stdOffsetMin = zone == "Europe/London" ? 0 : -300;
            int dstOffsetMin = zone == "Europe/London" ? 60 : -240;
            int year = Utc(timeSec).Year;
            long spring, autumn;
            ZoneTransitions(year, zone, out spring, out autumn);
            return timeSec >= spring && timeSec < autumn ? dstOffsetMin : stdOffsetMin;
        }

        private static int LocalMinutes(long timeSec, string zone)
        {
            int offsetMin = ZoneOffsetMin(timeSec, zone);
            long localSec = timeSec + offsetMin * 60;
            long minutes = (long)Math.Floor((double)localSec / 60) % 1440;
            return (int)minutes;
        }

        // first match wins; windows in the TS declaration order
        public static string SessionKeyAt(long timeSec)
        {
            // asia — UTC 00:00–06:00
            {
                var d = Utc(timeSec);
                int m = d.Hour * 60 + d.Minute;
                if (m >= 0 && m < 6 * 60) return "asia";
            }
            // london — Europe/London 07:00–10:00
            {
                int m = LocalMinutes(timeSec, "Europe/London");
                if (m >= 7 * 60 && m < 10 * 60) return "london";
            }
            // ny-am — America/New_York 09:30–12:00
            {
                int m = LocalMinutes(timeSec, "America/New_York");
                if (m >= 9 * 60 + 30 && m < 12 * 60) return "ny-am";
            }
            // london-close — Europe/London 15:00–17:00
            {
                int m = LocalMinutes(timeSec, "Europe/London");
                if (m >= 15 * 60 && m < 17 * 60) return "london-close";
            }
            // ny-pm — America/New_York 13:30–16:00
            {
                int m = LocalMinutes(timeSec, "America/New_York");
                if (m >= 13 * 60 + 30 && m < 16 * 60) return "ny-pm";
            }
            return "off-session";
        }

        // ------------ costs.ts ------------

        public static double RoundTripCostR(CostModel costs, double entryPrice, double riskPerUnit)
        {
            double half = (costs.Spread + costs.SlippagePerSide) + costs.CommissionPctPerSide * entryPrice;
            return (2 * half) / riskPerUnit;
        }

        // ------------ targets.ts ------------

        private static bool ExtremesOf(List<Bar> candles, long fromSec, long toSec, out double hi, out double lo)
        {
            hi = double.NegativeInfinity; lo = double.PositiveInfinity;
            bool found = false;
            foreach (var c in candles)
            {
                if (c.Time >= fromSec && c.Time < toSec)
                {
                    found = true;
                    if (c.H > hi) hi = c.H;
                    if (c.L < lo) lo = c.L;
                }
            }
            return found;
        }

        public static PrevExtremes ComputePrevExtremes(List<Bar> candles, int index, long intervalSeconds)
        {
            long t = candles[index].Time + intervalSeconds; // bar close time
            var d = Utc(t);
            var dayDate = new DateTime(d.Year, d.Month, d.Day, 0, 0, 0, DateTimeKind.Utc);
            long dayStartUtc = Unix(dayDate);
            int dayDow = (int)d.DayOfWeek;

            double pdh = 0, pdl = 0, pwh = 0, pwl = 0;
            bool haveDay = false, haveWeek = false;
            for (int back = 1; back <= 4 && !haveDay; back++)
            {
                double hi, lo;
                if (ExtremesOf(candles, dayStartUtc - back * 86400L, dayStartUtc, out hi, out lo)) { pdh = hi; pdl = lo; haveDay = true; }
            }
            long weekStart = dayStartUtc - (long)(dayDow == 0 ? 7 : dayDow - 1) * 86400L; // Monday 00:00
            for (int back = 1; back <= 2 && !haveWeek; back++)
            {
                double hi, lo;
                if (ExtremesOf(candles, weekStart - back * 604800L, weekStart, out hi, out lo)) { pwh = hi; pwl = lo; haveWeek = true; }
            }
            long asiaEnd = dayStartUtc + 6 * 3600;
            double? asiaHigh = null, asiaLow = null;
            if (t >= asiaEnd)
            {
                double hi, lo;
                if (ExtremesOf(candles, dayStartUtc, asiaEnd, out hi, out lo)) { asiaHigh = hi; asiaLow = lo; }
            }
            if (!haveDay || !haveWeek) return null;
            return new PrevExtremes { PrevDayHigh = pdh, PrevDayLow = pdl, PrevWeekHigh = pwh, PrevWeekLow = pwl, AsiaHigh = asiaHigh, AsiaLow = asiaLow };
        }

        public static List<StructuralTarget> BuildTargetLadder(List<Bar> candles, int index, string side, double entry,
            List<Pool> pools, double rangeHigh, double rangeLow, PrevExtremes prev, double clusterAtr, List<Swing> swings)
        {
            bool @long = side == "LONG";
            double minLevel = entry;
            var raw = new List<StructuralTarget>();
            Action<double, string, double> push = (price, source, weight) =>
            {
                if (!double.IsFinite(price)) return;
                if (@long ? price > minLevel : price < minLevel) raw.Add(new StructuralTarget { Price = price, Source = source, Weight = weight });
            };

            foreach (var p in pools)
            {
                if (p.Time <= candles[index].Time)
                    push(p.Price, p.Type == "EQH" ? "equal-highs pool" : "equal-lows pool", 0.9);
            }
            if (prev != null)
            {
                push(@long ? prev.PrevDayHigh : prev.PrevDayLow, "previous day high/low", 1.0);
                push(@long ? prev.PrevWeekHigh : prev.PrevWeekLow, "previous week high/low", 1.1);
                if (@long && prev.AsiaHigh != null) push(prev.AsiaHigh.Value, "Asian session high", 0.7);
                if (!@long && prev.AsiaLow != null) push(prev.AsiaLow.Value, "Asian session low", 0.7);
            }
            push(@long ? rangeHigh : rangeLow, "external range liquidity", 1.0);

            var known = swings.Where(s => s.Index + 3 <= index).ToList();
            var last12 = known.Count > 12 ? known.GetRange(known.Count - 12, 12) : known;
            foreach (var s in last12)
            {
                if (@long && s.Type == "HIGH") push(s.Price, "confirmed swing high", 0.6);
                if (!@long && s.Type == "LOW") push(s.Price, "confirmed swing low", 0.6);
            }

            raw = @long ? raw.OrderBy(t => t.Price).ToList() : raw.OrderByDescending(t => t.Price).ToList();
            var clustered = new List<StructuralTarget>();
            double tol = Math.Max(clusterAtr * 0.25, entry * 0.00008);
            foreach (var t in raw)
            {
                var last = clustered.Count > 0 ? clustered[clustered.Count - 1] : null;
                if (last != null && Math.Abs(t.Price - last.Price) <= tol)
                {
                    if (t.Weight > last.Weight) { last.Weight = t.Weight; last.Source = t.Source; }
                    continue;
                }
                clustered.Add(new StructuralTarget { Price = t.Price, Source = t.Source, Weight = t.Weight });
            }
            return clustered;
        }

        public static TradeTargets SelectTradeTargets(List<StructuralTarget> ladder, double entry, double riskPerUnit, double maxTargetR)
        {
            Func<StructuralTarget, double> rr = t => t != null ? Math.Abs(t.Price - entry) / Math.Max(1e-9, riskPerUnit) : 0;
            List<StructuralTarget> usable = ladder;
            int capped = 0;
            if (maxTargetR > 0 && ladder.Count > 0)
            {
                usable = ladder.Where(t => rr(t) <= maxTargetR).ToList();
                capped = ladder.Count - usable.Count;
                if (usable.Count == 0) { usable = new List<StructuralTarget> { ladder[0] }; capped = ladder.Count - 1; }
            }
            var tp1 = usable.Count > 0 ? usable[0] : null;
            var tp2 = usable.Count > 1 ? usable[1] : null;
            var tp3 = usable.Count > 2 ? usable[usable.Count - 1] : (tp2 ?? tp1);
            return new TradeTargets
            {
                Tp1 = tp1, Tp2 = tp2, Tp3 = tp3,
                MaxRR = usable.Count > 0 ? rr(usable[usable.Count - 1]) : 0,
                RrToTp1 = rr(tp1),
                RrToTp2 = tp2 != null ? rr(tp2) : 0,
                RrToTp3 = tp3 != null ? rr(tp3) : 0,
                Capped = capped,
            };
        }

        // ------------ scoring (spec #18) ------------

        public sealed class CategoryScores { public double Context, Liquidity, Structure, Entry, Confirmation, Risk; }

        public static CategoryScores ScoreSetup(double depth01,
            bool hasSweep, SweepAssessment sweepAssessment, int sweepAge, string structureType, int structureAge,
            double dispQuality, string zoneKind, double zoneQuality, bool zoneFresh, bool inKillzone, bool sweepInKillzone,
            bool smtAligned, double rrToFinal, bool stopStructural, bool targetStructural, EngineConfig cfg)
        {
            double context = 12 + Jr(4 + depth01 * 4);

            double liquidity;
            if (hasSweep && sweepAssessment != null)
            {
                double recency = Math.Max(0, 1 - (double)sweepAge / cfg.MaxSweepAgeBars);
                liquidity = Math.Min(20, Jr(sweepAssessment.Quality * 12 + recency * 4 + (sweepAssessment.CloseBackRatio >= 0.7 ? 4 : 2)));
            }
            else
            {
                double structureRecency = Math.Max(0, 1 - (double)structureAge / cfg.MaxStructureAgeBars);
                liquidity = Math.Min(20, Jr(structureRecency * 8 + dispQuality * 12));
            }

            double structure = Math.Min(20, (structureType == "MSS" ? 12 : 8) + Jr(dispQuality * 8));
            double entry = Math.Min(20, Jr((zoneKind == "FVG+OB" ? 10 : zoneKind == "FVG" ? 8 : 6) + zoneQuality * 4 + (zoneFresh ? 4 : 2) + (zoneQuality >= 0.8 ? 2 : 0)));
            double confirmation = (smtAligned ? 5 : 0) + (inKillzone ? 3 : 0) + (sweepInKillzone ? 2 : 0);
            double risk = (stopStructural ? 4 : 2) + (targetStructural ? 4 : 2) + (rrToFinal >= 3 ? 2 : rrToFinal >= cfg.MinRR ? 1 : 0);

            return new CategoryScores
            {
                Context = Math.Min(20, context),
                Liquidity = Math.Min(20, liquidity),
                Structure = Math.Min(20, structure),
                Entry = Math.Min(20, entry),
                Confirmation = Math.Min(10, confirmation),
                Risk = Math.Min(10, risk),
            };
        }

        // ------------ series context ------------

        public sealed class ZoneIdx { public Zone Zone; public int Created; public bool IsFvg; }
        public sealed class TrailingRange { public double High, Low, Equilibrium; }

        public sealed class CooldownState
        {
            public HashSet<string> UsedSweepKeys = new HashSet<string>();
            public HashSet<string> BlacklistedZones = new HashSet<string>();
            public double LastSignalIndex = double.NegativeInfinity;
        }

        public sealed class SeriesContext
        {
            public List<Bar> Candles; public long IntervalSec;
            public double[] AtrS; public string[] VolRegimes; public string[] Regimes;
            public string[] Bias;
            public List<StructureEvent> StructureEvents;
            public List<Zone> Zones;
            public Dictionary<string, int> ZoneMitigatedAt = new Dictionary<string, int>();
            public Dictionary<string, int> ZoneCreatedIndex = new Dictionary<string, int>();
            public Dictionary<string, string> ZoneKind = new Dictionary<string, string>();
            public List<ZoneIdx> ZoneIndex = new List<ZoneIdx>();
            public List<Swing> SwingLadder;
            public List<Sweep> Sweeps; public List<Pool> Pools;
            public List<StructureEvent> StructureBull = new List<StructureEvent>();
            public List<StructureEvent> StructureBear = new List<StructureEvent>();
            public List<Pool> PoolsByPrice;
            public int[] LastBullIdx; public int[] LastBearIdx;
            public EngineConfig Cfg;

            public string RegimeAt(int i) { return Regimes[Math.Min(i, Regimes.Length - 1)]; }
            public string TrendAt(int i) { return TrendByIndexArr[Math.Max(0, Math.Min(i, TrendByIndexArr.Length - 1))]; }
            public string[] TrendByIndexArr;

            public bool SmtBullishAt(int i)
            {
                return i >= 0 && i < Candles.Count && LastBullIdx[i] != -1 && i - LastBullIdx[i] <= Cfg.SmtWindowBars;
            }
            public bool SmtBearishAt(int i)
            {
                return i >= 0 && i < Candles.Count && LastBearIdx[i] != -1 && i - LastBearIdx[i] <= Cfg.SmtWindowBars;
            }

            public TrailingRange RangeAt(int i)
            {
                int start = Math.Max(0, i - Cfg.RangeLookbackBars + 1);
                double hi = double.NegativeInfinity, lo = double.PositiveInfinity;
                for (int k = start; k <= i; k++)
                {
                    if (Candles[k].H > hi) hi = Candles[k].H;
                    if (Candles[k].L < lo) lo = Candles[k].L;
                }
                return new TrailingRange { High = hi, Low = lo, Equilibrium = (hi + lo) / 2 };
            }
        }

        public static SeriesContext BuildSeriesContext(List<Bar> candles, List<SmtEvent> smtEvents, long intervalSec,
            string obInvalidation, double obDisplacementFactor)
        {
            var cfg = DefaultConfig();
            var ctx = new SeriesContext { Candles = candles, IntervalSec = intervalSec, Cfg = cfg };
            ctx.AtrS = AtrSeries(candles, 14);
            ctx.VolRegimes = VolRegimeSeries(candles, ctx.AtrS, 200);
            var walk = StructureWalkSeries(candles, 2);
            ctx.StructureEvents = walk.Events;
            ctx.TrendByIndexArr = walk.TrendByIndex;
            ctx.Regimes = MarketRegimeSeries(candles, walk.Events, ctx.AtrS, 60);
            ctx.Bias = HtfBiasSeries(candles, intervalSec, HtfSecondsFor(intervalSec), 2);

            var lows = candles.Select(c => c.L).ToArray();
            var highs = candles.Select(c => c.H).ToArray();
            var closes = candles.Select(c => c.C).ToArray();

            var fvgZones = DetectFvg(candles);
            var obZones = DetectOrderBlocks(candles, ctx.AtrS, obDisplacementFactor, obInvalidation);
            ctx.Zones = new List<Zone>();
            ctx.Zones.AddRange(fvgZones);
            ctx.Zones.AddRange(obZones);
            foreach (var z in ctx.Zones)
            {
                bool isFvg = z.Id.StartsWith("fvg");
                ctx.ZoneKind[z.Id] = isFvg ? "FVG" : "OB";
                int created = isFvg ? z.StartIndex + 2 : z.StartIndex + 1;
                ctx.ZoneCreatedIndex[z.Id] = created;
                ctx.ZoneIndex.Add(new ZoneIdx { Zone = z, Created = created, IsFvg = isFvg });
                int start = z.StartIndex + (isFvg ? 3 : 2);
                int deathAt = FirstMitigationIndex(isFvg ? (z.Direction == "BULLISH" ? "fvg-bull" : "fvg-bear") : obInvalidation, z, start, lows, highs, closes);
                if (deathAt != -1) ctx.ZoneMitigatedAt[z.Id] = deathAt;
            }
            ctx.ZoneIndex = ctx.ZoneIndex.OrderBy(x => x.Created).ToList();

            ctx.Sweeps = DetectSweeps(candles, 2, 100000);
            ctx.Pools = DetectLiquidityPools(candles, 2, 0.0006, 100000);
            ctx.SwingLadder = FindSwings(candles, 3);

            var smtSorted = smtEvents.OrderBy(e => e.Index).ToList();
            ctx.LastBullIdx = new int[candles.Count];
            ctx.LastBearIdx = new int[candles.Count];
            int bi = -1, be = -1, k = 0;
            for (int i = 0; i < candles.Count; i++)
            {
                while (k < smtSorted.Count && smtSorted[k].Index <= i)
                {
                    if (smtSorted[k].Type == "BULLISH") bi = smtSorted[k].Index;
                    else be = smtSorted[k].Index;
                    k++;
                }
                ctx.LastBullIdx[i] = bi;
                ctx.LastBearIdx[i] = be;
            }

            foreach (var e in walk.Events)
            {
                if (e.Direction == "BULLISH") ctx.StructureBull.Add(e);
                else ctx.StructureBear.Add(e);
            }
            ctx.PoolsByPrice = ctx.Pools.OrderBy(p => p.Price).ToList();
            return ctx;
        }

        // ------------ setup builder ------------

        public sealed class TargetOut { public double Price; public string Source; public double Rr; }

        public sealed class SetupResult
        {
            public string Side; public int DecidedIndex; public long DecidedTime; public string Model;
            public double Entry, InitialStop, RiskPerUnit;
            public List<TargetOut> Targets = new List<TargetOut>();
            public double RrToFinal, RrToTp1;
            public CategoryScores Scores; public double TotalScore; public string Tier;
            public string Session, HtfBias, VolRegime, MktRegime;
            public bool SmtAligned; public string SweepKey;
        }

        public sealed class BuildResult { public SetupResult Setup; public string Rejection; }

        private sealed class ZonePick { public Zone Zone; public double Quality; public bool IsFvg; public bool Overlap; }

        private static bool HitSweep(Sweep ev, bool sellSide) { return sellSide ? ev.Side == "SELL_SIDE" : ev.Side == "BUY_SIDE"; }

        private static Sweep SweepFindNewest(List<Sweep> sweeps, int minIdx, int maxIdx, bool sellSide)
        {
            for (int s = sweeps.Count - 1; s >= 0; s--)
            {
                var ev = sweeps[s];
                if (ev.Index > maxIdx) continue;
                if (ev.Index < minIdx) break;
                if (HitSweep(ev, sellSide)) return ev;
            }
            return null;
        }

        private static StructureEvent StructFind(List<StructureEvent> dirEvents, int minIdx, int maxIdx)
        {
            int lo = 0, hi = dirEvents.Count;
            while (lo < hi) { int mid = (lo + hi) >> 1; if (dirEvents[mid].Index < minIdx) lo = mid + 1; else hi = mid; }
            return lo < dirEvents.Count && dirEvents[lo].Index <= maxIdx ? dirEvents[lo] : null;
        }

        private static bool PoolNearPrice(List<Pool> poolsByPrice, double price, double distance)
        {
            int lo = 0, hi = poolsByPrice.Count;
            double min = price - distance;
            while (lo < hi) { int mid = (lo + hi) >> 1; if (poolsByPrice[mid].Price < min) lo = mid + 1; else hi = mid; }
            return lo < poolsByPrice.Count && poolsByPrice[lo].Price <= price + distance;
        }

        private static List<ZoneIdx> ZonesInWindow(List<ZoneIdx> zoneIndex, int from, int to)
        {
            int lo = 0, hi = zoneIndex.Count;
            while (lo < hi) { int mid = (lo + hi) >> 1; if (zoneIndex[mid].Created <= from) lo = mid + 1; else hi = mid; }
            var @out = new List<ZoneIdx>();
            for (int k = lo; k < zoneIndex.Count && zoneIndex[k].Created <= to; k++) @out.Add(zoneIndex[k]);
            return @out;
        }

        private static bool IsZoneFresh(SeriesContext ctx, Zone zone, int i)
        {
            var candles = ctx.Candles;
            int start = zone.StartIndex + (ctx.ZoneKind[zone.Id] == "FVG" ? 3 : 2);
            for (int k = start; k <= i; k++)
            {
                var c = candles[k];
                if (zone.Direction == "BULLISH" && c.L <= zone.Top) return false;
                if (zone.Direction == "BEARISH" && c.H >= zone.Bottom) return false;
            }
            return true;
        }

        private sealed class LegEq { public double High, Low, Equilibrium; }

        private static LegEq LegEquilibrium(List<Bar> candles, Sweep sweep, int i, bool wantBullish, int anchorIndex)
        {
            int from = sweep != null ? sweep.Index : Math.Max(0, anchorIndex - 8);
            double legExtreme = wantBullish ? double.NegativeInfinity : double.PositiveInfinity;
            for (int k = from; k <= i; k++)
            {
                if (wantBullish) legExtreme = Math.Max(legExtreme, candles[k].H);
                else legExtreme = Math.Min(legExtreme, candles[k].L);
            }
            double legLow = wantBullish ? (sweep != null ? sweep.Extreme : legExtreme) : legExtreme;
            double legHigh = wantBullish ? legExtreme : (sweep != null ? sweep.Extreme : legExtreme);
            double lo = double.IsFinite(legLow) ? legLow : Math.Min(legHigh, legExtreme);
            double hi = double.IsFinite(legHigh) ? legHigh : Math.Max(lo, legExtreme);
            return new LegEq { High = hi, Low = lo, Equilibrium = (hi + lo) / 2 };
        }

        public static BuildResult BuildSetupAt(SeriesContext ctx, int i, EngineConfig cfg, CooldownState cooldown, CostModel symbolCosts)
        {
            var candles = ctx.Candles;
            var c = candles[i];
            double atrI = ctx.AtrS[i];
            if (atrI <= 0) return new BuildResult { Setup = null, Rejection = null };

            string bias = ctx.Bias[i];
            string vol = ctx.VolRegimes[i];
            string mkt = ctx.RegimeAt(i);
            string session = SessionKeyAt(c.Time);
            var range = ctx.RangeAt(i);

            bool wantBullishBias = bias == "BULLISH";
            string side = bias == "BULLISH" ? "LONG" : bias == "BEARISH" ? "SHORT" : null;
            if (side == null) return new BuildResult { Setup = null, Rejection = "NO_HTF_BIAS" };
            if (cfg.RequireHtfBias && side == null) return new BuildResult { Setup = null, Rejection = "NO_HTF_BIAS" };

            if (cfg.BlockedVolRegimes.Contains(vol)) return new BuildResult { Setup = null, Rejection = "VOL_BLOCKED" };
            if (mkt == "UNCLEAR") return new BuildResult { Setup = null, Rejection = "REGIME_UNCLEAR" };

            bool sessionAllowed = cfg.Sessions.Length == 0 || cfg.Sessions.Contains(session) || ((session == "ny-am" || session == "ny-pm") && cfg.Sessions.Contains("ny"));
            if (!sessionAllowed) return new BuildResult { Setup = null, Rejection = "OUTSIDE_SESSION" };

            bool wantBullish = side == "LONG";
            var candidates = new List<SetupResult>();
            string deepestCode = null;
            int deepestDepth = -1;

            foreach (var model in ModelOrder)
            {
                if (!cfg.Models.Contains(model)) continue;
                SetupResult cand;
                string rej;
                EvaluateModel(ctx, i, cfg, cooldown, model, side, wantBullish, bias, vol, mkt, session, range, atrI, symbolCosts, out cand, out rej);
                if (cand != null) candidates.Add(cand);
                else if (rej != null)
                {
                    int depth = StageDepth(rej);
                    if (depth > deepestDepth) { deepestDepth = depth; deepestCode = rej; }
                }
            }

            if (candidates.Count == 0) return new BuildResult { Setup = null, Rejection = deepestCode };

            // best by score; tie → first in MODEL_ORDER (candidates were appended in that order)
            var best = candidates
                .Select((s, idx) => new { s, idx })
                .OrderByDescending(x => x.s.TotalScore)
                .ThenBy(x => x.idx)
                .First().s;

            return new BuildResult { Setup = best, Rejection = best.Tier == "NO_TRADE" ? "SCORE_BELOW_TIER" : null };
        }

        private static int StageDepth(string code)
        {
            switch (code)
            {
                case "NO_HTF_BIAS": case "REGIME_UNCLEAR": case "VOL_BLOCKED": return 0;
                case "OUTSIDE_SESSION": return 1;
                case "NO_LIQUIDITY_SWEEP": return 2;
                case "WEAK_SWEEP": return 3;
                case "NO_MSS": case "WEAK_MSS": return 4;
                case "NO_DISPLACEMENT": case "WEAK_DISPLACEMENT": return 5;
                case "NO_FVG": case "NO_ORDER_BLOCK": return 6;
                case "INVALID_FVG": case "INVALID_ORDER_BLOCK": case "NO_RETRACEMENT": return 7;
                case "WRONG_PREMIUM_DISCOUNT": return 8;
                case "INVALID_STOP": case "EXCESSIVE_COST": return 9;
                case "NO_STRUCTURAL_TARGET": case "NO_LIQUIDITY": return 10;
                case "INSUFFICIENT_RR": return 11;
                case "SMT_REQUIRED_BUT_MISSING": case "DUPLICATE_SETUP": return 12;
                case "SCORE_BELOW_TIER": case "COOLDOWN": return 13;
                case "SETUP_EXPIRED": return 14;
                default: return -1;
            }
        }

        private static void EvaluateModel(SeriesContext ctx, int i, EngineConfig cfg, CooldownState cooldown, string model,
            string side, bool wantBullish, string bias, string vol, string mkt, string session, TrailingRange range, double atrI,
            CostModel symbolCosts, out SetupResult candidateOut, out string rejectionOut)
        {
            candidateOut = null;
            rejectionOut = null;
            var candles = ctx.Candles;
            var c = candles[i];

            bool wantFvg = model == "A_SWEEP_REVERSAL" || model == "B_FVG_CONTINUATION" || model == "D_FVG_OB_CONFLUENCE" || model == "E_SMT_REVERSAL";
            bool wantOb = model == "C_OB_REVERSAL" || model == "D_FVG_OB_CONFLUENCE" || model == "E_SMT_REVERSAL";

            // -- 1. liquidity event -------------------------------------------------
            Sweep sweep = null;
            SweepAssessment sweepAssessment = null;
            StructureEvent structureAnchor = null;

            if (model != "B_FVG_CONTINUATION")
            {
                sweep = SweepFindNewest(ctx.Sweeps, i - cfg.MaxSweepAgeBars, i - 1, wantBullish);
                if (sweep == null) { rejectionOut = "NO_LIQUIDITY_SWEEP"; return; }
                double sweepAtr = ctx.AtrS[sweep.Index] != 0 ? ctx.AtrS[sweep.Index] : atrI;
                sweepAssessment = ClassifySweep(candles, sweep, sweepAtr);
                bool classOk = sweepAssessment.Cls == "SWEEP_REJECTION" || (cfg.AllowUnconfirmedSweep && sweepAssessment.Cls == "SWEEP_NO_CONFIRM");
                if (!classOk || sweepAssessment.Quality < cfg.SweepQualityMin) { rejectionOut = "WEAK_SWEEP"; return; }
                if (cfg.OneTradePerSweep && cooldown.UsedSweepKeys.Contains(sweep.Index + ":" + sweep.Level)) { rejectionOut = "DUPLICATE_SETUP"; return; }
                structureAnchor = StructFind(wantBullish ? ctx.StructureBull : ctx.StructureBear, Math.Max(sweep.Index + 1, i - cfg.MaxStructureAgeBars), i);
                if (structureAnchor == null)
                {
                    var stale = StructFind(wantBullish ? ctx.StructureBull : ctx.StructureBear, sweep.Index + 1, i);
                    rejectionOut = stale != null ? "WEAK_MSS" : "NO_MSS";
                    return;
                }
            }
            else
            {
                var dirEvents = wantBullish ? ctx.StructureBull : ctx.StructureBear;
                structureAnchor = StructFind(dirEvents, i - cfg.MaxStructureAgeBars, i);
                if (structureAnchor == null)
                {
                    var stale = dirEvents.Count > 0 && dirEvents[0].Index <= i ? dirEvents[0] : null;
                    rejectionOut = stale != null ? "WEAK_MSS" : "NO_MSS";
                    return;
                }
            }
            int anchorIndex = structureAnchor.Index;

            // -- 2. displacement leg -------------------------------------------------
            int dispFrom = model == "B_FVG_CONTINUATION" ? Math.Max(0, anchorIndex - 8) : sweep.Index + 1;
            int? dispIndexNullable = FindDisplacementCandle(candles, dispFrom, anchorIndex, wantBullish ? "BULLISH" : "BEARISH");
            if (dispIndexNullable == null) { rejectionOut = "NO_DISPLACEMENT"; return; }
            int dispIndex = dispIndexNullable.Value;
            double dispAtr = ctx.AtrS[dispIndex] != 0 ? ctx.AtrS[dispIndex] : atrI;
            var dispAssessment = AssessDisplacement(candles, dispIndex, wantBullish ? "BULLISH" : "BEARISH", dispAtr, true, true);
            if (dispAssessment.Quality < cfg.DisplacementQualityMin) { rejectionOut = "WEAK_DISPLACEMENT"; return; }

            // -- 3. entry zone(s) ----------------------------------------------------
            int windowFrom = model == "B_FVG_CONTINUATION" ? Math.Max(0, anchorIndex - 9) : sweep.Index;
            int windowTo = Math.Min(i, anchorIndex + 3);
            var zoneWindow = ZonesInWindow(ctx.ZoneIndex, windowFrom, windowTo);
            double? sweepExtreme = sweep != null ? sweep.Extreme : (double?)null;

            ZonePick fvgPick = null, obPick = null;
            int fvgInWindow = 0, obInWindow = 0;
            var legEq = LegEquilibrium(candles, sweep, i, wantBullish, anchorIndex);

            foreach (var entryZ in zoneWindow)
            {
                var zone = entryZ.Zone;
                bool isFvg = entryZ.IsFvg;
                if (zone.Direction != (wantBullish ? "BULLISH" : "BEARISH")) continue;
                int mit;
                if (ctx.ZoneMitigatedAt.TryGetValue(zone.Id, out mit) && mit <= i) continue;
                if (isFvg) fvgInWindow++; else obInWindow++;
                if (wantBullish && zone.Top >= c.C) continue;
                if (!wantBullish && zone.Bottom <= c.C) continue;
                if (sweepExtreme != null)
                {
                    if (wantBullish && zone.Bottom < sweepExtreme.Value - 0.75 * atrI) continue;
                    if (!wantBullish && zone.Top > sweepExtreme.Value + 0.75 * atrI) continue;
                }
                if (cfg.SameZoneCooldown && cooldown.BlacklistedZones.Contains(zone.Id)) continue;
                double mid = (zone.Top + zone.Bottom) / 2;
                bool inCorrectHalf = wantBullish ? mid < legEq.Equilibrium : mid > legEq.Equilibrium;
                double q;
                if (isFvg)
                {
                    q = FvgQuality(candles, zone, atrI, i, sweep != null ? (int?)sweep.Index : null, anchorIndex, dispIndex,
                        inCorrectHalf, wantBullish ? bias == "BULLISH" : bias == "BEARISH").Score;
                }
                else
                {
                    q = ObQuality(candles, zone, atrI, i, sweep != null ? (int?)sweep.Index : null, anchorIndex, inCorrectHalf).Score;
                }
                if (isFvg) { if (fvgPick == null || q > fvgPick.Quality) fvgPick = new ZonePick { Zone = zone, Quality = q, IsFvg = true }; }
                else { if (obPick == null || q > obPick.Quality) obPick = new ZonePick { Zone = zone, Quality = q, IsFvg = false }; }
            }

            ZonePick pick = null;
            if (model == "A_SWEEP_REVERSAL" || model == "B_FVG_CONTINUATION")
            {
                if (fvgInWindow == 0) { rejectionOut = "NO_FVG"; return; }
                if (fvgPick == null || fvgPick.Quality < cfg.ZoneQualityMin) { rejectionOut = "INVALID_FVG"; return; }
                pick = fvgPick;
            }
            else if (model == "C_OB_REVERSAL")
            {
                if (obInWindow == 0) { rejectionOut = "NO_ORDER_BLOCK"; return; }
                if (obPick == null || obPick.Quality < cfg.ZoneQualityMin) { rejectionOut = "INVALID_ORDER_BLOCK"; return; }
                pick = obPick;
            }
            else if (model == "D_FVG_OB_CONFLUENCE")
            {
                if (fvgInWindow == 0) { rejectionOut = "NO_FVG"; return; }
                if (obInWindow == 0) { rejectionOut = "NO_ORDER_BLOCK"; return; }
                if (fvgPick == null || obPick == null) { rejectionOut = fvgPick != null ? "INVALID_ORDER_BLOCK" : "INVALID_FVG"; return; }
                double lo = Math.Max(fvgPick.Zone.Bottom, obPick.Zone.Bottom);
                double hi = Math.Min(fvgPick.Zone.Top, obPick.Zone.Top);
                double smaller = Math.Min(fvgPick.Zone.Top - fvgPick.Zone.Bottom, obPick.Zone.Top - obPick.Zone.Bottom);
                double overlapHeight = hi - lo;
                if (overlapHeight <= 0.1 * Math.Max(1e-9, smaller)) { rejectionOut = "INVALID_FVG"; return; }
                double quality = (fvgPick.Quality + obPick.Quality) / 2;
                if (quality < cfg.ZoneQualityMin) { rejectionOut = "INVALID_FVG"; return; }
                pick = new ZonePick
                {
                    Zone = new Zone
                    {
                        Id = "d-" + fvgPick.Zone.Id + "-" + obPick.Zone.Id,
                        Top = hi, Bottom = lo, StartTime = fvgPick.Zone.StartTime,
                        StartIndex = fvgPick.Zone.StartIndex, Kind = "FVG", Direction = fvgPick.Zone.Direction,
                    },
                    Quality = quality, IsFvg = true, Overlap = true,
                };
            }
            else
            {
                // E_SMT_REVERSAL
                if (fvgInWindow == 0 && obInWindow == 0) { rejectionOut = "NO_FVG"; return; }
                bool smtAlignedE = wantBullish ? ctx.SmtBullishAt(i) : ctx.SmtBearishAt(i);
                if (!smtAlignedE) { rejectionOut = "SMT_REQUIRED_BUT_MISSING"; return; }
                ZonePick bestBoth;
                if (fvgPick == null) bestBoth = obPick;
                else if (obPick == null) bestBoth = fvgPick;
                else bestBoth = fvgPick.Quality >= obPick.Quality ? fvgPick : obPick;
                if (bestBoth == null) { rejectionOut = fvgInWindow > 0 ? "INVALID_FVG" : "INVALID_ORDER_BLOCK"; return; }
                if (bestBoth.Quality < cfg.ZoneQualityMin) { rejectionOut = bestBoth == fvgPick ? "INVALID_FVG" : "INVALID_ORDER_BLOCK"; return; }
                pick = bestBoth;
            }

            var zonePicked = pick.Zone;
            double zoneMid = (zonePicked.Top + zonePicked.Bottom) / 2;

            // -- 4. premium/discount (optional confluence) ---------------------------
            double depth = wantBullish
                ? (legEq.Equilibrium - zoneMid) / Math.Max(1e-9, legEq.Equilibrium - legEq.Low)
                : (zoneMid - legEq.Equilibrium) / Math.Max(1e-9, legEq.High - legEq.Equilibrium);
            double depth01 = Math.Max(0, Math.Min(1, depth));
            bool pdOk = wantBullish ? zoneMid < legEq.Equilibrium : zoneMid > legEq.Equilibrium;
            if (cfg.RequireDiscountPremium && !pdOk) { rejectionOut = "WRONG_PREMIUM_DISCOUNT"; return; }

            // -- 5. entry / structural stop ------------------------------------------
            double entry = cfg.EntryAnchor == "midpoint" ? zoneMid : wantBullish ? zonePicked.Top : zonePicked.Bottom;
            double buffer = 0.1 * atrI;
            double protectedExtreme;
            if (sweep != null) protectedExtreme = sweep.Extreme;
            else
            {
                Swing swing = null;
                for (int s = ctx.SwingLadder.Count - 1; s >= 0; s--)
                {
                    var sw = ctx.SwingLadder[s];
                    if (sw.Index + 3 <= i && (wantBullish ? sw.Type == "LOW" : sw.Type == "HIGH")) { swing = sw; break; }
                }
                protectedExtreme = swing != null ? swing.Price : wantBullish ? zonePicked.Bottom : zonePicked.Top;
            }
            double initialStop = wantBullish
                ? Math.Min(zonePicked.Bottom, protectedExtreme) - buffer
                : Math.Max(zonePicked.Top, protectedExtreme) + buffer;
            double riskPerUnit = Math.Abs(entry - initialStop);
            if (riskPerUnit < cfg.MinStopAtrMult * atrI) { rejectionOut = "INVALID_STOP"; return; }
            if (riskPerUnit > cfg.MaxStopAtrMult * atrI) { rejectionOut = "INVALID_STOP"; return; }
            if (riskPerUnit / entry > cfg.MaxStopPctOfPrice) { rejectionOut = "INVALID_STOP"; return; }

            // -- 5b. cost gate --------------------------------------------------------
            if (cfg.MaxCostPctOfR > 0)
            {
                double estCostR = RoundTripCostR(symbolCosts, entry, riskPerUnit);
                if (estCostR > cfg.MaxCostPctOfR) { rejectionOut = "EXCESSIVE_COST"; return; }
            }

            // -- 6. structural target ladder + minimum RR gate ------------------------
            var prev = ComputePrevExtremes(candles, i, ctx.IntervalSec);
            var ladderFull = BuildTargetLadder(candles, i, side, entry, ctx.Pools, range.High, range.Low, prev, atrI, ctx.SwingLadder);
            if (ladderFull.Count == 0)
            {
                rejectionOut = (ctx.Pools.Count > 0 ? ctx.Pools.Count : 0) == 0 ? "NO_LIQUIDITY" : "NO_STRUCTURAL_TARGET";
                return;
            }
            var tt = SelectTradeTargets(ladderFull, entry, riskPerUnit, cfg.TargetHorizonR);
            if (tt.MaxRR < cfg.MinRR) { rejectionOut = "INSUFFICIENT_RR"; return; }

            // -- 7/8. confluence flags + scoring --------------------------------------
            bool smtAligned = wantBullish ? ctx.SmtBullishAt(i) : ctx.SmtBearishAt(i);
            bool inKillzone = SessionKeyAt(c.Time) != "off-session";
            bool sweepInKz = sweep != null && SessionKeyAt(sweep.Time) != "off-session";
            int sweepAge = sweep != null ? i - sweep.Index : 0;
            var scores = ScoreSetup(depth01, sweep != null, sweepAssessment, sweepAge,
                structureAnchor.Type, i - structureAnchor.Index, dispAssessment.Quality,
                pick.Overlap ? "FVG+OB" : pick.IsFvg ? "FVG" : "OB", pick.Quality,
                IsZoneFresh(ctx, zonePicked, i), inKillzone, sweepInKz, smtAligned, tt.MaxRR,
                wantBullish
                    ? initialStop <= Math.Min(zonePicked.Bottom, sweep != null ? sweep.Extreme : zonePicked.Bottom)
                    : initialStop >= Math.Max(zonePicked.Top, sweep != null ? sweep.Extreme : zonePicked.Top),
                ladderFull.Any(t => t.Weight >= 0.7), cfg);
            double totalScore = scores.Context + scores.Liquidity + scores.Structure + scores.Entry + scores.Confirmation + scores.Risk;
            string tier = TierFor(totalScore, cfg);
            if (mkt == "RANGE" && totalScore < cfg.RangeRegimeMinScore) tier = "NO_TRADE";

            var res = new SetupResult
            {
                Side = side, DecidedIndex = i, DecidedTime = c.Time, Model = model,
                Entry = entry, InitialStop = initialStop, RiskPerUnit = riskPerUnit,
                RrToFinal = Round2(tt.MaxRR), RrToTp1 = Round2(tt.RrToTp1),
                Scores = scores, TotalScore = totalScore, Tier = tier,
                Session = session, HtfBias = bias, VolRegime = vol, MktRegime = mkt,
                SmtAligned = smtAligned,
                SweepKey = sweep != null ? sweep.Index + ":" + sweep.Level : "bos:" + anchorIndex,
            };
            foreach (var t in new[] { tt.Tp1, tt.Tp2, tt.Tp3 })
            {
                if (t != null)
                    res.Targets.Add(new TargetOut { Price = t.Price, Source = t.Source, Rr = Round2(Math.Abs(t.Price - entry) / riskPerUnit) });
            }
            candidateOut = res;
            rejectionOut = tier == "NO_TRADE" ? "SCORE_BELOW_TIER" : null;
        }
    }
}
namespace cAlgo.Robots
{
    using System.Linq;

    // ===========================================================================
    // The cBot — local engine by default, website feed as fallback
    // ===========================================================================
    [Robot(TimeZone = TimeZones.UTC, AccessRights = AccessRights.FullAccess)]
    public class TradePilotCopier : Robot
    {
        // ---------- parameters ----------
        [Parameter("Signal Source", Group = "Signal source", DefaultValue = TpSignalSource.LocalEngine)]
        public TpSignalSource Source { get; set; }

        [Parameter("SMT Companion Symbol", Group = "Signal source", DefaultValue = "XAGUSD")]
        public string SmtSymbol { get; set; }

        [Parameter("Feed URL", Group = "Website feed mode", DefaultValue = "https://tradepilot1.gabeyre80.workers.dev/api/signals/feed?symbol=XAUUSD&interval=15min")]
        public string FeedUrl { get; set; }

        [Parameter("Poll Seconds", Group = "Website feed mode", DefaultValue = 30, MinValue = 10)]
        public int PollSeconds { get; set; }

        [Parameter("Enabled (kill switch)", Group = "Signal source", DefaultValue = true)]
        public bool Enabled { get; set; }

        [Parameter("Entry Mode", Group = "Execution", DefaultValue = TpEntryMode.Auto)]
        public TpEntryMode EntryMode { get; set; }

        [Parameter("Expiry Minutes", Group = "Execution", DefaultValue = 45, MinValue = 5)]
        public int ExpiryMinutes { get; set; }

        [Parameter("Fixed Lots", Group = "Execution", DefaultValue = 0.01, MinValue = 0.01, Step = 0.01)]
        public double FixedLots { get; set; }

        [Parameter("Risk % (0 = fixed lots)", Group = "Execution", DefaultValue = 0.0, MinValue = 0.0, MaxValue = 10.0, Step = 0.1)]
        public double RiskPercent { get; set; }

        [Parameter("Max Spread (pips, 0 = off)", Group = "Execution", DefaultValue = 0.0, MinValue = 0.0)]
        public double MaxSpreadPips { get; set; }

        [Parameter("Label", Group = "Execution", DefaultValue = "TradePilot")]
        public string TradeLabel { get; set; }

        [Parameter("Ladder TP1 Fraction", Group = "Trade management", DefaultValue = 0.30, MinValue = 0.0, MaxValue = 0.9)]
        public double Ladder1 { get; set; }

        [Parameter("Ladder TP2 Fraction", Group = "Trade management", DefaultValue = 0.35, MinValue = 0.0, MaxValue = 0.9)]
        public double Ladder2 { get; set; }

        [Parameter("Break-even after TP1", Group = "Trade management", DefaultValue = true)]
        public bool BreakEvenAfterTp1 { get; set; }

        [Parameter("BE Offset (pips)", Group = "Trade management", DefaultValue = 1.0, MinValue = 0.0)]
        public double BeOffsetPips { get; set; }

        // ---------- state ----------
        private HttpClient _http;
        private string _lastFingerprint = "";
        private Signal _pending;                 // levels of the signal behind the active position
        private bool _managing;                  // adopted the position we placed
        private double _initialUnits;
        private bool _tp1Done, _tp2Done;
        private bool _polling;
        private int _failCount;
        private const string FpKey = "tp_copier_last_fp";
        private string _engineBias = "NEUTRAL";
        private string _engineSession = "off-session";
        private string _engineRejection = "";

        private sealed class Signal
        {
            public string Fingerprint;
            public string Side;
            public double Entry;
            public double StopLoss;
            public double[] Targets;
        }

        // ---------- lifecycle ----------
        protected override void OnStart()
        {
            if (Ladder1 + Ladder2 >= 0.999)
            {
                Print("TradePilot Copier: Ladder1 + Ladder2 must be < 1.0 — stopping.");
                Stop();
                return;
            }

            var stored = LocalStorage.GetString(FpKey);
            _lastFingerprint = stored ?? "";

            Positions.Opened += OnPositionOpened;

            if (Source == TpSignalSource.WebsiteFeed)
            {
                _http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
                Timer.Start(TimeSpan.FromSeconds(Math.Max(10, PollSeconds)));
            }

            Print("TradePilot Copier: ready on {0} | source {1} | last handled signal [{2}] | WARNING: real orders — verify on demo first",
                SymbolName, Source, _lastFingerprint);
            UpdateStatus("starting — waiting for the first closed bar");
            if (Source == TpSignalSource.LocalEngine) EvaluateLocalEngine();
        }

        protected override void OnBar()
        {
            if (Source == TpSignalSource.LocalEngine) EvaluateLocalEngine();
        }

        protected override void OnTimer()
        {
            if (Source == TpSignalSource.WebsiteFeed && !_polling)
            {
                _polling = true;
                try { Poll(); }
                catch (Exception ex)
                {
                    Print("TradePilot Copier: poll error: {0}", ex.Message);
                    UpdateStatus("poll error: " + ex.Message);
                }
                finally { _polling = false; }
            }
            ManagePositions();
        }

        protected override void OnTick()
        {
            ManagePositions();
        }

        // ---------- LOCAL ENGINE ----------
        private void EvaluateLocalEngine()
        {
            if (!Enabled) { UpdateStatus("paused (kill switch)"); return; }
            if (Bars.Count < 125) { UpdateStatus("engine warming up — needs more chart history"); return; }

            int lastClosed = Bars.Count - 2;          // OnBar fires when the NEXT bar opens
            if (lastClosed < 121) { UpdateStatus("engine warming up — needs more chart history"); return; }

            try
            {
                int n = Math.Min(400, lastClosed + 1);
                int startIdx = lastClosed - n + 1;
                var candles = new List<TpEngine.Bar>(n);
                for (int i = startIdx; i <= lastClosed; i++)
                {
                    candles.Add(new TpEngine.Bar
                    {
                        Time = UnixSec(Bars.OpenTimes[i]),
                        O = Bars.OpenPrices[i],
                        H = Bars.HighPrices[i],
                        L = Bars.LowPrices[i],
                        C = Bars.ClosePrices[i],
                    });
                }
                // interval = smallest positive gap among recent bars (weekend/session
                // gaps are larger; the true bar interval is the minimum)
                long intervalSec = 0;
                for (int g = Math.Max(1, lastClosed - 20); g <= lastClosed; g++)
                {
                    long d = (long)(Bars.OpenTimes[g] - Bars.OpenTimes[g - 1]).TotalSeconds;
                    if (d > 0 && (intervalSec <= 0 || d < intervalSec)) intervalSec = d;
                }
                if (intervalSec <= 0) intervalSec = 900;

                // SMT companion series (optional — silently absent when unavailable)
                List<TpEngine.Bar> silver = null;
                if (!string.IsNullOrEmpty(SmtSymbol) && SmtSymbol != SymbolName)
                {
                    try
                    {
                        if (Symbols.Exists(SmtSymbol))
                        {
                            var sBars = MarketData.GetBars(TimeFrame, SmtSymbol);
                            int sLast = sBars.Count - 1;
                            if (sLast >= 0 && sBars.OpenTimes[sLast] > Bars.OpenTimes[lastClosed]) sLast--; // drop forming bar
                            int sN = Math.Min(n, sLast + 1);
                            if (sN > 0)
                            {
                                int sStart = sLast - sN + 1;
                                silver = new List<TpEngine.Bar>(sN);
                                for (int i = sStart; i <= sLast; i++)
                                {
                                    silver.Add(new TpEngine.Bar
                                    {
                                        Time = UnixSec(sBars.OpenTimes[i]),
                                        O = sBars.OpenPrices[i],
                                        H = sBars.HighPrices[i],
                                        L = sBars.LowPrices[i],
                                        C = sBars.ClosePrices[i],
                                    });
                                }
                            }
                        }
                        else
                        {
                            Print("TradePilot Copier: SMT companion '{0}' not found — SMT confluence disabled", SmtSymbol);
                        }
                    }
                    catch (Exception ex)
                    {
                        Print("TradePilot Copier: SMT companion unavailable ({0}) — continuing without SMT", ex.Message);
                    }
                }

                var smtEvents = silver != null && silver.Count > 40
                    ? TpEngine.SmtSeries(candles, silver, 2, 8)
                    : new List<TpEngine.SmtEvent>();

                var ctx = TpEngine.BuildSeriesContext(candles, smtEvents, intervalSec, "close-mid", 1.2);
                var cfg = TpEngine.DefaultConfig();
                var cooldown = new TpEngine.CooldownState();
                var costs = SymbolName.ToUpperInvariant().Contains("XAG")
                    ? new TpEngine.CostModel { Spread = 0.03, SlippagePerSide = 0.01, CommissionPctPerSide = 0.00001 }
                    : new TpEngine.CostModel { Spread = 0.3, SlippagePerSide = 0.05, CommissionPctPerSide = 0.00001 };

                var result = TpEngine.BuildSetupAt(ctx, candles.Count - 1, cfg, cooldown, costs);
                _engineBias = ctx.Bias[candles.Count - 1];
                _engineSession = TpEngine.SessionKeyAt(candles[candles.Count - 1].Time);
                _engineRejection = result.Rejection ?? "";

                var setup = result.Setup;
                if (setup == null || setup.Tier == "NO_TRADE")
                {
                    UpdateStatus("engine: no trade" + (string.IsNullOrEmpty(_engineRejection) ? "" : " — " + _engineRejection));
                    return;
                }

                var targets = setup.Targets.Select(t => TpEngine.Round2(t.Price)).ToArray();
                var fpParts = new List<string> { setup.Side, TpEngine.Round2(setup.Entry).ToString(CultureInfo.InvariantCulture), TpEngine.Round2(setup.InitialStop).ToString(CultureInfo.InvariantCulture) };
                fpParts.AddRange(targets.Select(t => t.ToString(CultureInfo.InvariantCulture)));
                var sig = new Signal
                {
                    Fingerprint = string.Join("|", fpParts),
                    Side = setup.Side,
                    Entry = TpEngine.Round2(setup.Entry),
                    StopLoss = TpEngine.Round2(setup.InitialStop),
                    Targets = targets,
                };
                HandleNewSignal(sig);
            }
            catch (Exception ex)
            {
                Print("TradePilot Copier: engine error: {0}", ex.Message);
                UpdateStatus("engine error: " + ex.Message);
            }
        }

        private static long UnixSec(DateTime t)
        {
            var utc = DateTime.SpecifyKind(t, DateTimeKind.Utc);
            return (long)(utc - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalSeconds;
        }

        // ---------- shared signal handling (dedupe → guards → placement) ----------

        private void HandleNewSignal(Signal sig)
        {
            if (sig.Fingerprint == _lastFingerprint)
            {
                UpdateStatus("signal already handled");
                return;
            }

            // one TradePilot position / pending order at a time
            if (Positions.FindAll(TradeLabel, SymbolName).Length > 0 || HasTradePilotPendingOrder())
            {
                ConsumeFingerprint(sig.Fingerprint);
                UpdateStatus("signal skipped (TradePilot trade already open)");
                return;
            }
            if (SpreadTooWide())
            {
                ConsumeFingerprint(sig.Fingerprint);
                UpdateStatus("signal skipped (spread guard)");
                return;
            }

            PlaceTrade(sig);
        }

        private void ConsumeFingerprint(string fp)
        {
            _lastFingerprint = fp;
            LocalStorage.SetString(FpKey, _lastFingerprint);
            LocalStorage.Flush(LocalStorageScope.Instance);
        }

        // ---------- website feed mode ----------

        private void Poll()
        {
            if (!Enabled)
            {
                UpdateStatus("paused (kill switch)");
                return;
            }
            if (_http == null) { UpdateStatus("feed mode not initialised"); return; }

            string json;
            try
            {
                json = _http.GetStringAsync(FeedUrl).GetAwaiter().GetResult();
            }
            catch (Exception ex)
            {
                UpdateStatus("feed unreachable: " + ex.Message);
                return;
            }

            Signal sig = ParseFeed(json);
            if (sig == null)
            {
                UpdateStatus("no setup on last closed bar");
                return;
            }
            HandleNewSignal(sig);
        }

        private Signal ParseFeed(string json)
        {
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(json);
                var root = doc.RootElement;
                if (!root.TryGetProperty("signal", out var s) || s.ValueKind == System.Text.Json.JsonValueKind.Null)
                    return null;

                var fp = s.TryGetProperty("fingerprint", out var f) ? f.GetString() : null;
                var side = s.TryGetProperty("side", out var sd) ? sd.GetString() : null;
                var entry = s.TryGetProperty("entry", out var e) ? e.GetDouble() : 0.0;
                var sl = s.TryGetProperty("stopLoss", out var l) ? l.GetDouble() : 0.0;

                var targets = new List<double>();
                if (s.TryGetProperty("targets", out var ts) && ts.ValueKind == System.Text.Json.JsonValueKind.Array)
                    foreach (var t in ts.EnumerateArray())
                        targets.Add(t.GetDouble());

                if (string.IsNullOrEmpty(fp) || string.IsNullOrEmpty(side) || targets.Count == 0 ||
                    entry <= 0 || sl <= 0)
                {
                    UpdateStatus("feed parse error");
                    return null;
                }

                return new Signal { Fingerprint = fp, Side = side, Entry = entry, StopLoss = sl, Targets = targets.ToArray() };
            }
            catch (Exception ex)
            {
                Print("TradePilot Copier: feed parse error: {0}", ex.Message);
                UpdateStatus("feed parse error");
                return null;
            }
        }

        // ---------- placement ----------

        private void PlaceTrade(Signal sig)
        {
            bool isLong = sig.Side == "LONG";
            var direction = isLong ? TradeType.Buy : TradeType.Sell;

            double entry = NormalizePrice(sig.Entry);
            double sl = NormalizePrice(sig.StopLoss);
            double tpFinal = NormalizePrice(sig.Targets[sig.Targets.Length - 1]);

            double units = ComputeUnits(entry, sl);
            if (units < Symbol.VolumeInUnitsMin)
            {
                UpdateStatus("sizing below the symbol minimum — signal skipped");
                ConsumeFingerprint(sig.Fingerprint);
                return;
            }

            double slPips = Math.Abs(entry - sl) / Symbol.PipSize;
            double tpPips = Math.Abs(tpFinal - entry) / Symbol.PipSize;

            bool priceReached = isLong ? Symbol.Ask <= entry : Symbol.Bid >= entry;
            TradeResult result;

            if (EntryMode == TpEntryMode.Market || priceReached)
            {
                // price is already at/beyond the setup entry — the engine would
                // fill its limit immediately; enter at market
                result = ExecuteMarketOrder(direction, SymbolName, units, TradeLabel, slPips, tpPips);
            }
            else
            {
                var expiry = Server.Time.AddMinutes(ExpiryMinutes);
                result = isLong
                    ? PlaceLimitOrder(TradeType.Buy, SymbolName, units, entry, TradeLabel, slPips, tpPips, expiry)
                    : PlaceLimitOrder(TradeType.Sell, SymbolName, units, entry, TradeLabel, slPips, tpPips, expiry);
            }

            if (result.IsSuccessful)
            {
                _failCount = 0;
                ConsumeFingerprint(sig.Fingerprint);

                _pending = sig;
                _managing = false;          // adopted from Positions.Opened
                _tp1Done = false;
                _tp2Done = false;
                _initialUnits = units;

                Print("TradePilot Copier: placed {0} {1} units @ {2} SL {3} TP {4} [{5}]",
                    sig.Side, units, entry, sl, tpFinal, sig.Fingerprint);
                UpdateStatus((isLong ? "LONG" : "SHORT") + " placed @ " + entry.ToString("F" + Symbol.Digits));
            }
            else
            {
                _failCount++;
                Print("TradePilot Copier: order FAILED ({0}/{1}) — {2}",
                    _failCount, 3, result.Error);
                // transient failures retry on the next poll/bar; after 3 strikes
                // the signal is consumed so we never spam the server
                if (_failCount >= 3)
                {
                    _failCount = 0;
                    ConsumeFingerprint(sig.Fingerprint);
                    UpdateStatus("order failed 3x — signal dropped");
                }
                else
                {
                    UpdateStatus("order failed — will retry: " + result.Error);
                }
            }
        }

        private bool HasTradePilotPendingOrder()
        {
            foreach (var o in PendingOrders)
                if (o.Label == TradeLabel && o.SymbolName == SymbolName)
                    return true;
            return false;
        }

        // ---------- management ----------

        private void OnPositionOpened(PositionOpenedEventArgs args)
        {
            var p = args.Position;
            if (p.Label != TradeLabel || p.SymbolName != SymbolName) return;

            _managing = true;
            _initialUnits = p.VolumeInUnits;
            _tp1Done = false;
            _tp2Done = false;
            Print("TradePilot Copier: managing position {0} — initial volume {1} units", p.Id, _initialUnits);
        }

        private void ManagePositions()
        {
            var positions = Positions.FindAll(TradeLabel, SymbolName);
            if (positions.Length == 0)
            {
                if (_managing)
                {
                    _managing = false;
                    _pending = null;
                    UpdateStatus("flat — position closed");
                }
                return;
            }

            if (!_managing)
            {
                // a TradePilot position exists but this session never placed it
                // (bot/terminal restart mid-trade): leave it to its native SL/TP —
                // the original volume and ladder progress are unknown.
                UpdateStatus("in position (pre-existing) — native SL/TP only");
                return;
            }
            if (_pending == null) return;

            bool isLong = _pending.Side == "LONG";
            double tp1 = _pending.Targets[0];
            double tp2 = _pending.Targets.Length >= 3 ? _pending.Targets[1] : 0.0;
            double volMin = Symbol.VolumeInUnitsMin;

            foreach (var p in positions)
            {
                // exit-side price: Bid for longs, Ask for shorts
                double mark = isLong ? Symbol.Bid : Symbol.Ask;

                if (!_tp1Done && HitLevel(tp1, isLong, mark))
                {
                    double closeUnits = Symbol.NormalizeVolumeInUnits(_initialUnits * Ladder1, RoundingMode.Down);
                    double openUnits = p.VolumeInUnits;
                    if (closeUnits >= volMin && openUnits - closeUnits >= volMin)
                    {
                        var r = ClosePosition(p, closeUnits);
                        Print("TradePilot Copier: TP1 hit — closed {0} units ({1})", closeUnits, r.IsSuccessful ? "ok" : r.Error.ToString());
                    }
                    else
                    {
                        Print("TradePilot Copier: TP1 hit — partial below min volume, leaving remainder to native TP");
                    }
                    _tp1Done = true;

                    if (BreakEvenAfterTp1 && Positions.Find(TradeLabel, SymbolName) is Position stillOpen)
                        MoveToBreakEven(stillOpen, isLong);
                }

                if (!_tp2Done && tp2 > 0 && HitLevel(tp2, isLong, mark))
                {
                    double closeUnits = Symbol.NormalizeVolumeInUnits(_initialUnits * Ladder2, RoundingMode.Down);
                    var fresh = Positions.Find(TradeLabel, SymbolName);
                    if (fresh != null)
                    {
                        double openUnits = fresh.VolumeInUnits;
                        if (closeUnits >= volMin && openUnits - closeUnits >= volMin)
                        {
                            var r = ClosePosition(fresh, closeUnits);
                            Print("TradePilot Copier: TP2 hit — closed {0} units ({1})", closeUnits, r.IsSuccessful ? "ok" : r.Error.ToString());
                        }
                        else
                        {
                            Print("TradePilot Copier: TP2 hit — remainder below min volume, native TP closes it");
                        }
                    }
                    _tp2Done = true;
                }
            }

            if (_tp1Done)
                UpdateStatus("in position — TP1 done" + (_tp2Done ? ", TP2 done, running to final" : (tp2 > 0 ? ", running to TP2/final" : ", running to final")));
        }

        private bool HitLevel(double level, bool isLong, double mark)
        {
            return isLong ? mark >= level : mark <= level;
        }

        private void MoveToBreakEven(Position p, bool isLong)
        {
            double be = isLong
                ? p.EntryPrice + BeOffsetPips * Symbol.PipSize
                : p.EntryPrice - BeOffsetPips * Symbol.PipSize;
            be = NormalizePrice(be);

            double mark = isLong ? Symbol.Bid : Symbol.Ask;
            bool valid = isLong ? be < mark : be > mark;
            bool improves = isLong ? (p.StopLoss == 0 || be > p.StopLoss) : (p.StopLoss == 0 || be < p.StopLoss);
            if (!valid || !improves) return;

            var r = p.ModifyStopLossPrice(be);
            if (r.IsSuccessful)
                Print("TradePilot Copier: stop moved to breakeven {0}", be);
            else
                Print("TradePilot Copier: breakeven modify failed — {0}", r.Error);
        }

        // ---------- helpers ----------

        private double NormalizePrice(double price)
        {
            return Math.Round(price / Symbol.TickSize) * Symbol.TickSize;
        }

        private double ComputeUnits(double entry, double sl)
        {
            double units;
            if (RiskPercent > 0)
            {
                double slDistPips = Math.Abs(entry - sl) / Symbol.PipSize;
                if (slDistPips <= 0 || Symbol.PipValue <= 0) return 0;
                // PipValue is the money value of one pip for ONE unit of volume
                double riskPerUnit = slDistPips * Symbol.PipValue;
                units = Account.Balance * RiskPercent / 100.0 / riskPerUnit;
            }
            else
            {
                units = Symbol.QuantityToVolumeInUnits(FixedLots);
            }
            return Symbol.NormalizeVolumeInUnits(units, RoundingMode.Down);
        }

        private bool SpreadTooWide()
        {
            // spread expressed in pips: (Ask - Bid) / PipSize. Deliberately NOT
            // Symbol.Spread / PipSize — Symbol.Spread is already quoted in pips,
            // so dividing by PipSize inflated the guard ~100x on gold and would
            // have rejected every signal once Max Spread was set.
            return MaxSpreadPips > 0 && (Symbol.Ask - Symbol.Bid) / Symbol.PipSize > MaxSpreadPips;
        }

        private void UpdateStatus(string s)
        {
            var src = Source == TpSignalSource.LocalEngine ? "local engine" : "website feed";
            var mode = EntryMode == TpEntryMode.Market ? "market" : "auto (limit/market)";
            var size = RiskPercent > 0 ? RiskPercent + "% risk" : FixedLots + " lots";
            var engineLine = Source == TpSignalSource.LocalEngine
                ? "\nbias: " + _engineBias + " | session: " + _engineSession + (string.IsNullOrEmpty(_engineRejection) ? "" : " | last rejection: " + _engineRejection)
                : "";
            var txt = string.Format(
                "TradePilot Copier {0} ({1})\nfeed: {2} | entry: {3} | size: {4}\nstatus: {5}{6}\nladder {7:P0}/{8:P0}/{9:P0}" +
                (BreakEvenAfterTp1 ? " + BE after TP1" : ""),
                Enabled ? "[ON]" : "[OFF]", src,
                Source == TpSignalSource.LocalEngine ? "on every closed bar" : "every " + PollSeconds + "s",
                mode, size, s, engineLine,
                Ladder1, Ladder2, 1 - Ladder1 - Ladder2);
            Chart.DrawStaticText("tp_status", txt, VerticalAlignment.Top, HorizontalAlignment.Left,
                Enabled ? Color.Gold : Color.Gray);
        }
    }
}
