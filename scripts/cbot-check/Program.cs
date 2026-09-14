// Parity runner: compares the C# engine port (public/tradepilot-cbot.cs)
// against fixtures generated from the REAL TypeScript engine.
// Run from scripts/cbot-check: dotnet run -- fixture-winter.json fixture-summer.json
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;
using cAlgo.Robots;

internal static class Program
{
    private static int _checks, _fails;
    private static readonly List<string> Failures = new List<string>();

    private static void Check(bool ok, string label, string detail = "")
    {
        _checks++;
        if (!ok)
        {
            _fails++;
            if (Failures.Count < 40) Failures.Add(label + (detail.Length > 0 ? " — " + detail : ""));
        }
    }

    private static bool Near(double a, double b)
    {
        if (double.IsNaN(a) && double.IsNaN(b)) return true;
        return Math.Abs(a - b) <= 1e-9 + 1e-9 * Math.Max(Math.Abs(a), Math.Abs(b));
    }

    private static List<TpEngine.Bar> BarsOf(JsonElement arr)
    {
        var list = new List<TpEngine.Bar>();
        foreach (var c in arr.EnumerateArray())
            list.Add(new TpEngine.Bar { Time = c.GetProperty("t").GetInt64(), O = c.GetProperty("o").GetDouble(), H = c.GetProperty("h").GetDouble(), L = c.GetProperty("l").GetDouble(), C = c.GetProperty("c").GetDouble() });
        return list;
    }

    private static void CompareSeries(double[] got, JsonElement want, string label)
    {
        Check(got.Length == want.GetArrayLength(), label + ".len", $"got {got.Length} want {want.GetArrayLength()}");
        int n = Math.Min(got.Length, want.GetArrayLength());
        for (int i = 0; i < n; i++)
            Check(Near(got[i], want[i].GetDouble()), $"{label}[{i}]", $"got {got[i]} want {want[i].GetDouble()}");
    }

    private static void CompareStrings(string[] got, JsonElement want, string label)
    {
        Check(got.Length == want.GetArrayLength(), label + ".len", $"got {got.Length} want {want.GetArrayLength()}");
        int n = Math.Min(got.Length, want.GetArrayLength());
        for (int i = 0; i < n; i++)
            Check(got[i] == want[i].GetString(), $"{label}[{i}]", $"got '{got[i]}' want '{want[i].GetString()}'");
    }

    private static int Main(string[] args)
    {
        var files = args.Length > 0 ? args : Directory.GetFiles(".", "fixture-*.json");
        foreach (var file in files)
        {
            _checks = 0; _fails = 0; Failures.Clear();
            var doc = JsonDocument.Parse(File.ReadAllText(file));
            var root = doc.RootElement;
            var candles = BarsOf(root.GetProperty("candles"));
            var silver = BarsOf(root.GetProperty("silver"));
            long intervalSec = root.GetProperty("intervalSec").GetInt64();
            var exp = root.GetProperty("expected");

            // --- direct module outputs ---
            CompareSeries(TpEngine.AtrSeries(candles, 14), exp.GetProperty("atr"), "atr");
            var walk = TpEngine.StructureWalkSeries(candles, 2);
            CompareSeries(TpEngine.AtrSeries(candles, 14), exp.GetProperty("atr"), "atr2");
            CompareStrings(TpEngine.VolRegimeSeries(candles, TpEngine.AtrSeries(candles, 14), 200), exp.GetProperty("volRegime"), "volRegime");
            CompareStrings(TpEngine.MarketRegimeSeries(candles, walk.Events, TpEngine.AtrSeries(candles, 14), 60), exp.GetProperty("regime"), "regime");
            CompareStrings(TpEngine.HtfBiasSeries(candles, intervalSec, TpEngine.HtfSecondsFor(intervalSec), 2), exp.GetProperty("bias"), "bias");
            CompareStrings(candles.Select(c => TpEngine.SessionKeyAt(c.Time)).ToArray(), exp.GetProperty("session"), "session");
            var smt = TpEngine.SmtSeries(candles, silver, 2, 8);
            Check(smt.Count == exp.GetProperty("smt").GetInt32(), "smt.count", $"got {smt.Count} want {exp.GetProperty("smt").GetInt32()}");
            var sweeps = TpEngine.DetectSweeps(candles, 2, 100000);
            Check(sweeps.Count == exp.GetProperty("sweeps").GetInt32(), "sweeps.count", $"got {sweeps.Count} want {exp.GetProperty("sweeps").GetInt32()}");
            var pools = TpEngine.DetectLiquidityPools(candles, 2, 0.0006, 100000);
            Check(pools.Count == exp.GetProperty("pools").GetInt32(), "pools.count", $"got {pools.Count} want {exp.GetProperty("pools").GetInt32()}");

            // --- full context + per-bar builder ---
            var ctx = TpEngine.BuildSeriesContext(candles, smt, intervalSec, "close-mid", 1.2);
            Check(ctx.Zones.Count == exp.GetProperty("zones").GetInt32(), "zones.count", $"got {ctx.Zones.Count} want {exp.GetProperty("zones").GetInt32()}");

            var cfg = TpEngine.DefaultConfig();
            var costs = new TpEngine.CostModel { Spread = 0.3, SlippagePerSide = 0.05, CommissionPctPerSide = 0.00001 };
            int setupsSeen = 0, rejectsSeen = 0;
            foreach (var pb in exp.GetProperty("perBar").EnumerateArray())
            {
                int i = pb.GetProperty("i").GetInt32();
                Check(TpEngine.SessionKeyAt(candles[i].Time) == pb.GetProperty("session").GetString(), $"perBar[{i}].session");
                var cooldown = new TpEngine.CooldownState();
                var res = TpEngine.BuildSetupAt(ctx, i, cfg, cooldown, costs);
                var wantRej = pb.GetProperty("rejection");
                string wantRejection = wantRej.ValueKind == JsonValueKind.Null ? null : wantRej.GetString();
                bool rejOk = res.Rejection == wantRejection;
                var wantSetup = pb.GetProperty("setup");
                bool hasSetup = wantSetup.ValueKind == JsonValueKind.Null ? false : wantSetup.ValueKind == JsonValueKind.Object;
                bool setupOk = (res.Setup != null) == hasSetup;
                Check(rejOk && setupOk, $"perBar[{i}].outcome",
                    $"got (setup={res.Setup != null}, rej={res.Rejection ?? "null"}) want (setup={hasSetup}, rej={wantRejection ?? "null"})");
                if (hasSetup && res.Setup != null)
                {
                    setupsSeen++;
                    var s = wantSetup;
                    var got = res.Setup;
                    Check(got.Side == s.GetProperty("side").GetString(), $"perBar[{i}].side");
                    Check(got.Model == s.GetProperty("model").GetString(), $"perBar[{i}].model", got.Model);
                    Check(got.Tier == s.GetProperty("tier").GetString(), $"perBar[{i}].tier", $"{got.Tier} vs {s.GetProperty("tier").GetString()}");
                    Check(got.Session == s.GetProperty("session").GetString(), $"perBar[{i}].setup.session");
                    Check(got.HtfBias == s.GetProperty("htfBias").GetString(), $"perBar[{i}].htfBias");
                    Check(got.VolRegime == s.GetProperty("volRegime").GetString(), $"perBar[{i}].volRegime");
                    Check(got.MktRegime == s.GetProperty("mktRegime").GetString(), $"perBar[{i}].mktRegime");
                    Check(got.SmtAligned == s.GetProperty("smtAligned").GetBoolean(), $"perBar[{i}].smtAligned");
                    Check(got.SweepKey == s.GetProperty("sweepKey").GetString(), $"perBar[{i}].sweepKey", $"{got.SweepKey} vs {s.GetProperty("sweepKey").GetString()}");
                    Check(Near(got.TotalScore, s.GetProperty("totalScore").GetDouble()), $"perBar[{i}].totalScore", $"{got.TotalScore} vs {s.GetProperty("totalScore").GetDouble()}");
                    Check(Near(got.Entry, s.GetProperty("entry").GetDouble()), $"perBar[{i}].entry", $"{got.Entry} vs {s.GetProperty("entry").GetDouble()}");
                    Check(Near(got.InitialStop, s.GetProperty("initialStop").GetDouble()), $"perBar[{i}].initialStop");
                    Check(Near(got.RrToFinal, s.GetProperty("rrToFinal").GetDouble()), $"perBar[{i}].rrToFinal");
                    Check(Near(got.RrToTp1, s.GetProperty("rrToTp1").GetDouble()), $"perBar[{i}].rrToTp1");
                    var sc = s.GetProperty("scores");
                    Check(Near(got.Scores.Context, sc.GetProperty("context").GetDouble()), $"perBar[{i}].scores.context");
                    Check(Near(got.Scores.Liquidity, sc.GetProperty("liquidity").GetDouble()), $"perBar[{i}].scores.liquidity");
                    Check(Near(got.Scores.Structure, sc.GetProperty("structure").GetDouble()), $"perBar[{i}].scores.structure");
                    Check(Near(got.Scores.Entry, sc.GetProperty("entry").GetDouble()), $"perBar[{i}].scores.entry");
                    Check(Near(got.Scores.Confirmation, sc.GetProperty("confirmation").GetDouble()), $"perBar[{i}].scores.confirmation");
                    Check(Near(got.Scores.Risk, sc.GetProperty("risk").GetDouble()), $"perBar[{i}].scores.risk");
                    var wantTargets = s.GetProperty("targets");
                    Check(got.Targets.Count == wantTargets.GetArrayLength(), $"perBar[{i}].targets.len");
                    int tn = Math.Min(got.Targets.Count, wantTargets.GetArrayLength());
                    for (int k = 0; k < tn; k++)
                    {
                        Check(Near(got.Targets[k].Price, wantTargets[k].GetProperty("price").GetDouble()), $"perBar[{i}].targets[{k}].price");
                        Check(got.Targets[k].Source == wantTargets[k].GetProperty("source").GetString(), $"perBar[{i}].targets[{k}].source");
                        Check(Near(got.Targets[k].Rr, wantTargets[k].GetProperty("rr").GetDouble()), $"perBar[{i}].targets[{k}].rr");
                    }
                }
                else if (res.Setup == null && res.Rejection != null) rejectsSeen++;
            }
            Console.WriteLine($"{Path.GetFileName(file)}: {_checks - _fails}/{_checks} checks passed | setups compared: {setupsSeen}, rejections seen: {rejectsSeen}");
            if (_fails > 0)
            {
                foreach (var f in Failures) Console.WriteLine("  FAIL " + f);
                return 1;
            }
        }
        Console.WriteLine("ALL PARITY CHECKS PASSED");
        return 0;
    }
}
