// Compile-check stubs for the cAlgo API surface used by tradepilot-cbot.cs.
// Local harness ONLY — never shipped to the site. Signatures mirror the
// documented cTrader Automate API closely enough for type-checking.
using System;
using System.Collections;
using System.Collections.Generic;

namespace cAlgo.API
{
    public enum AccessRights { FullAccess, Registry, FileSystem }
    public enum TradeType { Buy, Sell }
    public enum RoundingMode { ToNearest, Down, Up }
    public enum LocalStorageScope { Instance, Application }
    public enum VerticalAlignment { Top, Center, Bottom }
    public enum HorizontalAlignment { Left, Center, Right }

    public static class TimeZones { public const string UTC = "UTC"; }

    [AttributeUsage(AttributeTargets.Class)]
    public class RobotAttribute : Attribute
    {
        public string TimeZone { get; set; }
        public AccessRights AccessRights { get; set; }
    }

    [AttributeUsage(AttributeTargets.Property)]
    public class ParameterAttribute : Attribute
    {
        public ParameterAttribute() { }
        public ParameterAttribute(string name) { }
        public string Group { get; set; }
        public object DefaultValue { get; set; }
        public object MinValue { get; set; }
        public object MaxValue { get; set; }
        public object Step { get; set; }
    }

    public class Color
    {
        public static Color Gold { get; } = new Color();
        public static Color Gray { get; } = new Color();
    }

    public class TradeResult
    {
        public bool IsSuccessful { get; set; }
        public object Error { get; set; }
    }

    public class Position
    {
        public int Id { get; set; }
        public string Label { get; set; }
        public string SymbolName { get; set; }
        public double VolumeInUnits { get; set; }
        public double EntryPrice { get; set; }
        public double StopLoss { get; set; }
        public TradeResult ModifyStopLossPrice(double price) { return new TradeResult { IsSuccessful = true }; }
    }

    public class PositionOpenedEventArgs { public Position Position { get; set; } }

    public class Positions
    {
        public event Action<PositionOpenedEventArgs> Opened;
        public Position[] FindAll(string label, string symbolName) { return new Position[0]; }
        public Position Find(string label, string symbolName) { return null; }
        internal void Raise(PositionOpenedEventArgs a) { Opened?.Invoke(a); }
    }

    public class PendingOrder { public string Label { get; set; } public string SymbolName { get; set; } }

    public class PendingOrderCollection : IEnumerable<PendingOrder>
    {
        public IEnumerator<PendingOrder> GetEnumerator() { yield break; }
        IEnumerator IEnumerable.GetEnumerator() { return GetEnumerator(); }
    }

    public class LocalStorage
    {
        private readonly Dictionary<string, string> _d = new Dictionary<string, string>();
        public string GetString(string key) { return _d.TryGetValue(key, out var v) ? v : null; }
        public void SetString(string key, string value) { _d[key] = value; }
        public void Flush(LocalStorageScope scope) { }
    }

    public class Timer { public void Start(TimeSpan interval) { } }

    public class DataSeries
    {
        private readonly double[] _v;
        public DataSeries(double[] v) { _v = v; }
        public double this[int index] { get { return _v[index]; } }
        public int Count { get { return _v.Length; } }
    }

    public class TimeSeries
    {
        private readonly DateTime[] _v;
        public TimeSeries(DateTime[] v) { _v = v; }
        public DateTime this[int index] { get { return _v[index]; } }
        public int Count { get { return _v.Length; } }
    }

    public class Bars
    {
        public int Count { get; set; }
        public TimeSeries OpenTimes { get; set; }
        public DataSeries OpenPrices { get; set; }
        public DataSeries HighPrices { get; set; }
        public DataSeries LowPrices { get; set; }
        public DataSeries ClosePrices { get; set; }
    }

    public class TimeFrame { }

    public class MarketData { public Bars GetBars(TimeFrame timeFrame, string symbolName) { return null; } }

    public class Symbols { public bool Exists(string name) { return true; } public Symbol GetSymbol(string name) { return null; } }

    public class Symbol
    {
        public double Ask { get; set; }
        public double Bid { get; set; }
        public double PipSize { get; set; }
        public double TickSize { get; set; }
        public int Digits { get; set; }
        public double Spread { get; set; }
        public double VolumeInUnitsMin { get; set; }
        public double PipValue { get; set; }
        public double NormalizeVolumeInUnits(double volume, RoundingMode mode) { return volume; }
        public double QuantityToVolumeInUnits(double quantity) { return quantity; }
    }

    public class Account { public double Balance { get; set; } }

    public class Chart
    {
        public object DrawStaticText(string name, string text, VerticalAlignment v, HorizontalAlignment h, Color color) { return null; }
    }

    public class Server { public DateTime Time { get; set; } }
}

namespace cAlgo.API.Internals
{
    using cAlgo.API;

    public class SymbolInternals : Symbol { }
}

namespace cAlgo
{
    using cAlgo.API;

    public class Robot
    {
        public string SymbolName { get; set; }
        public Bars Bars { get; set; }
        public MarketData MarketData { get; set; }
        public Symbols Symbols { get; set; }
        public Symbol Symbol { get; set; }
        public Positions Positions { get; set; }
        public PendingOrderCollection PendingOrders { get; set; }
        public LocalStorage LocalStorage { get; set; }
        public Account Account { get; set; }
        public Chart Chart { get; set; }
        public Server Server { get; set; }
        public TimeFrame TimeFrame { get; set; }
        public Timer Timer { get; set; }

        protected virtual void OnStart() { }
        protected virtual void OnBar() { }
        protected virtual void OnTick() { }
        protected virtual void OnTimer() { }
        protected void Print(string message) { }
        protected void Print(string message, params object[] parameters) { }
        protected void Stop() { }

        public TradeResult ExecuteMarketOrder(TradeType tradeType, string symbolName, double volume, string label, double stopLossPips, double takeProfitPips) { return new TradeResult(); }
        public TradeResult PlaceLimitOrder(TradeType tradeType, string symbolName, double volume, double targetPrice, string label, double stopLossPips, double takeProfitPips, DateTime expiration) { return new TradeResult(); }
        public TradeResult ClosePosition(Position position, double volume) { return new TradeResult(); }
    }
}
