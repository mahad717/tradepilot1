//+------------------------------------------------------------------+
//|                                              TradePilot cBot.cs  |
//|        Copy TradePilot ICT signals onto this cTrader account,    |
//|        faithfully mirroring the backtest trade lifecycle:        |
//|                                                                  |
//|   signal -> limit order at the setup entry (expires if price     |
//|   never arrives) -> partial ladder TP1/TP2/final (30/35/35 by    |
//|   default) -> breakeven stop after TP1 -> final target.          |
//|                                                                  |
//|   Architecture: the cBot PULLS the machine signal feed           |
//|   (/api/signals/feed) from inside your own cTrader account.      |
//|   Your broker credentials never leave this machine.              |
//|                                                                  |
//|   SETUP (once):                                                  |
//|   1. cTrader -> Automate tab -> New cBot -> replace the generated |
//|      code with this file -> Build (or paste via Automate editor) |
//|   2. Add the bot to your broker's gold chart, M15 timeframe      |
//|      (any symbol name: XAUUSD / GOLD / XAUUSD.m ...)             |
//|   3. When cTrader asks for network access consent, allow it      |
//|      (the bot only calls the TradePilot feed).                   |
//|   4. Set your lot size or risk % in the parameters, press Play.  |
//|                                                                  |
//|   *** PASTE RULE — READ BEFORE BUILDING ***                      |
//|   This file must REPLACE the entire editor content: click into   |
//|   the code editor, press Ctrl+A (select ALL), then paste. If the |
//|   code is appended below the old content instead, the build      |
//|   fails with hundreds of CS1529 "A using clause must precede     |
//|   all other elements" errors — a using block is only legal at    |
//|   the very top of the file. Fix: Ctrl+A, paste again, rebuild.   |
//|                                                                  |
//|   RISK WARNING: this bot places REAL orders on a REAL account.   |
//|   Test on a DEMO account first. TradePilot signals are           |
//|   educational strategy output, not financial advice.             |
//+------------------------------------------------------------------+
using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text.Json;
using cAlgo.API;
using cAlgo.API.Internals;

namespace cAlgo.Robots
{
    // namespace-scope enum — cTrader's parameter UI cannot bind nested enums
    public enum TpEntryMode { Auto, Market }

    [Robot(TimeZone = TimeZones.UTC, AccessRights = AccessRights.FullAccess)]
    public class TradePilotCopier : Robot
    {
        // ---------- parameters ----------
        [Parameter("Feed URL", Group = "Signal feed", DefaultValue = "https://tradepilot1.gabeyre80.workers.dev/api/signals/feed?symbol=XAUUSD&interval=15min")]
        public string FeedUrl { get; set; }

        [Parameter("Poll Seconds", Group = "Signal feed", DefaultValue = 30, MinValue = 10)]
        public int PollSeconds { get; set; }

        [Parameter("Enabled (kill switch)", Group = "Signal feed", DefaultValue = true)]
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

            _http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
            var stored = LocalStorage.GetString(FpKey);
            _lastFingerprint = stored ?? "";

            Positions.Opened += OnPositionOpened;
            Timer.Start(TimeSpan.FromSeconds(Math.Max(10, PollSeconds)));

            Print("TradePilot Copier: ready on {0} | last handled signal [{1}] | WARNING: real orders — verify on demo first",
                SymbolName, _lastFingerprint);
            UpdateStatus("ready — waiting for next poll");
        }

        protected override void OnTimer()
        {
            if (!_polling)
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

        // ---------- feed ----------
        private void Poll()
        {
            if (!Enabled)
            {
                UpdateStatus("paused (kill switch)");
                return;
            }

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
            if (sig.Fingerprint == _lastFingerprint)
            {
                UpdateStatus("signal already handled");
                return;
            }

            // one TradePilot position / pending order at a time
            if (Positions.FindAll(TradeLabel, SymbolName).Length > 0 || HasTradePilotPendingOrder())
            {
                _lastFingerprint = sig.Fingerprint;
                LocalStorage.SetString(FpKey, _lastFingerprint);
                LocalStorage.Flush(LocalStorageScope.Instance);
                UpdateStatus("signal skipped (TradePilot trade already open)");
                return;
            }
            if (SpreadTooWide())
            {
                _lastFingerprint = sig.Fingerprint;
                LocalStorage.SetString(FpKey, _lastFingerprint);
                LocalStorage.Flush(LocalStorageScope.Instance);
                UpdateStatus("signal skipped (spread guard)");
                return;
            }

            PlaceTrade(sig);
        }

        private Signal ParseFeed(string json)
        {
            try
            {
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;
                if (!root.TryGetProperty("signal", out var s) || s.ValueKind == JsonValueKind.Null)
                    return null;

                var fp = s.TryGetProperty("fingerprint", out var f) ? f.GetString() : null;
                var side = s.TryGetProperty("side", out var sd) ? sd.GetString() : null;
                var entry = s.TryGetProperty("entry", out var e) ? e.GetDouble() : 0.0;
                var sl = s.TryGetProperty("stopLoss", out var l) ? l.GetDouble() : 0.0;

                var targets = new List<double>();
                if (s.TryGetProperty("targets", out var ts) && ts.ValueKind == JsonValueKind.Array)
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
                _lastFingerprint = sig.Fingerprint;
                LocalStorage.SetString(FpKey, _lastFingerprint);
                LocalStorage.Flush(LocalStorageScope.Instance);
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
                _lastFingerprint = sig.Fingerprint;
                LocalStorage.SetString(FpKey, _lastFingerprint);
                LocalStorage.Flush(LocalStorageScope.Instance);

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
                // transient failures retry on the next poll; after 3 strikes
                // the signal is consumed so we never spam the server
                if (_failCount >= 3)
                {
                    _failCount = 0;
                    _lastFingerprint = sig.Fingerprint;
                    LocalStorage.SetString(FpKey, _lastFingerprint);
                    LocalStorage.Flush(LocalStorageScope.Instance);
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
                        Print("TradePilot Copier: TP1 hit — closed {0} units ({1})", closeUnits, r.IsSuccessful ? "ok" : r.Error);
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
                            Print("TradePilot Copier: TP2 hit — closed {0} units ({1})", closeUnits, r.IsSuccessful ? "ok" : r.Error);
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
            var mode = EntryMode == TpEntryMode.Market ? "market" : "auto (limit/market)";
            var size = RiskPercent > 0 ? RiskPercent + "% risk" : FixedLots + " lots";
            var txt = string.Format(
                "TradePilot Copier {0}\nfeed: every {1}s | entry: {2} | size: {3}\nstatus: {4}\nladder {5:P0}/{6:P0}/{7:P0}" +
                (BreakEvenAfterTp1 ? " + BE after TP1" : ""),
                Enabled ? "[ON]" : "[OFF]", PollSeconds, mode, size, s,
                Ladder1, Ladder2, 1 - Ladder1 - Ladder2);
            Chart.DrawStaticText("tp_status", txt, VerticalAlignment.Top, HorizontalAlignment.Left,
                Enabled ? Color.Gold : Color.Gray);
        }
    }
}
