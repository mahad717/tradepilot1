//+------------------------------------------------------------------+
//|                                            TradePilot Copier.mq5 |
//|         Copy TradePilot ICT signals onto this MT5 account,       |
//|         faithfully mirroring the backtest trade lifecycle:       |
//|                                                                  |
//|   signal -> limit order at the setup entry (expires if price     |
//|   never arrives) -> partial ladder TP1/TP2/final (30/35/35 by    |
//|   default) -> breakeven stop after TP1 -> final target.          |
//|                                                                  |
//|   Architecture: the EA PULLS the machine signal feed             |
//|   (/api/signals/feed) from inside your own terminal. Your        |
//|   broker credentials never leave this machine.                   |
//|                                                                  |
//|   SETUP (once):                                                  |
//|   1. MT5 -> Tools -> Options -> Expert Advisors:                 |
//|      enable "Allow WebRequest for listed URL" and add            |
//|      https://tradepilot1.gabeyre80.workers.dev                   |
//|   2. Attach to your broker's gold chart, M15 timeframe           |
//|      (any symbol name: XAUUSD / GOLD / XAUUSD.m ...)             |
//|   3. Enable "Algo Trading" (toolbar button)                      |
//|   4. Check the Experts log for "TradePilot Copier: ready"        |
//|                                                                  |
//|   RISK WARNING: this EA places REAL orders on a REAL account.    |
//|   Test on a DEMO account first. TradePilot signals are           |
//|   educational strategy output, not financial advice.             |
//+------------------------------------------------------------------+
#property copyright "TradePilot"
#property link      "https://tradepilot1.gabeyre80.workers.dev"
#property version   "1.00"
#include <Trade\Trade.mqh>

//--- entry mode
enum ENUM_ENTRY_MODE
  {
   MODE_AUTO   = 0,   // Auto (limit at signal entry, market if price already there)
   MODE_MARKET = 1    // Always market on signal drop
  };

//--- inputs
input group "=== Signal feed ==="
input string  InpFeedUrl         = "https://tradepilot1.gabeyre80.workers.dev/api/signals/feed?symbol=XAUUSD&interval=15min";
input int     InpPollSeconds     = 30;       // feed poll interval (seconds)
input bool    InpEnabled         = true;     // master kill switch (uncheck = stop copying)

input group "=== Execution ==="
input ENUM_ENTRY_MODE InpEntryMode = MODE_AUTO;
input int     InpExpiryMinutes   = 45;       // pending order lifetime (minutes; 3 x 15m bars)
input double  InpLots            = 0.01;     // fixed lots (used when risk % = 0)
input double  InpRiskPercent     = 0.0;      // risk % of balance per trade (0 = use fixed lots)
input int     InpMaxSpreadPoints = 0;        // skip entries when spread wider (points; 0 = off)
input int     InpSlippagePoints  = 30;       // max deviation (points)
input long    InpMagic           = 20260914; // magic number (TradePilot positions only)
input string  InpCommentText     = "TradePilot";

input group "=== Trade management (mirrors the Best backtest preset) ==="
input double  InpLadder1         = 0.30;     // fraction closed at TP1
input double  InpLadder2         = 0.35;     // fraction closed at TP2 (rest runs to final TP)
input bool    InpBreakEvenTP1    = true;     // move stop to breakeven after TP1
input int     InpBeOffsetPoints  = 10;       // BE offset beyond entry (points, covers costs)

//--- trade objects & state
CTrade   trade;

struct SignalInfo
  {
   long     fpHash;       // fingerprint hash (dedupe)
   string   fp;           // fingerprint string
   string   side;         // "LONG" | "SHORT"
   double   entry;
   double   stopLoss;
   double   tp1;
   double   tp2;
   double   tpFinal;      // native TP on the position
   int      nTargets;
  };

SignalInfo g_sig;                 // last signal seen
long       g_lastFpHash      = 0; // last handled signal (never re-traded)
ulong      g_orderTicket     = 0; // pending order we placed (0 = none)
double     g_plannedVolume   = 0;
bool       g_sessionPlaced   = false; // a placement happened this session
bool       g_managing        = false; // adopted an open position this session
double     g_initVolume      = 0;
bool       g_tp1Done         = false;
bool       g_tp2Done         = false;
datetime   g_lastPoll        = 0;
string     g_lastStatus      = "starting";

const string GV_FP_KEY = "TPC_LAST_FP_HASH";

//+------------------------------------------------------------------+
//| Small JSON readers — the feed shape is fixed and flat, so a      |
//| key-locator scan is sufficient (no full parser needed).          |
//+------------------------------------------------------------------+
bool JsonRawValue(const string json, const string key, string &out)
  {
   string needle = "\"" + key + "\"";
   int k = StringFind(json, needle);
   if(k < 0) return false;
   int c = StringFind(json, ":", k + StringLen(needle));
   if(c < 0) return false;
   int i = c + 1;
   // skip whitespace
   while(i < StringLen(json) && StringGetCharacter(json, i) == ' ') i++;
   if(i >= StringLen(json)) return false;
   ushort q = StringGetCharacter(json, i);
   if(q == '"')
     {
      int e = StringFind(json, "\"", i + 1);
      if(e < 0) return false;
      out = StringSubstr(json, i + 1, e - i - 1);
      return true;
     }
   // nested object / array: depth-count to the matching close so commas
   // inside the value cannot truncate it ("signal" is a nested object)
   if(q == '{' || q == '[')
     {
      ushort openCh = q;
      ushort closeCh = (q == '{') ? '}' : ']';
      int depth = 0;
      int e = i;
      while(e < StringLen(json))
        {
         ushort ch = StringGetCharacter(json, e);
         if(ch == openCh) depth++;
         else if(ch == closeCh)
           {
            depth--;
            if(depth == 0) { e++; break; }
           }
         e++;
        }
      out = StringSubstr(json, i, e - i);
      return true;
     }
   // unquoted scalar (number / null / false): scan to , } ]
   int e2 = i;
   while(e2 < StringLen(json))
     {
      ushort ch = StringGetCharacter(json, e2);
      if(ch == ',' || ch == '}' || ch == ']' || ch == ' ' || ch == '\n' || ch == '\r') break;
      e2++;
     }
   out = StringSubstr(json, i, e2 - i);
   return true;
  }

double JsonNumber(const string json, const string key)
  {
   string s;
   if(!JsonRawValue(json, key, s)) return 0.0;
   if(s == "null" || s == "") return 0.0;
   return StringToDouble(s);
  }

/** Reads "key":[a,b,c] into arr[]. Returns element count. */
int JsonNumberArray(const string json, const string key, double &arr[])
  {
   ArrayResize(arr, 0);
   string needle = "\"" + key + "\"";
   int k = StringFind(json, needle);
   if(k < 0) return 0;
   int open = StringFind(json, "[", k);
   int close = StringFind(json, "]", open);
   if(open < 0 || close < 0) return 0;
   string body = StringSubstr(json, open + 1, close - open - 1);
   string parts[];
   int n = StringSplit(body, ',', parts);
   for(int i = 0; i < n; i++)
     {
      double v = StringToDouble(parts[i]);
      ArrayResize(arr, i + 1);
      arr[i] = v;
     }
   return n;
  }

//+------------------------------------------------------------------+
//| Fingerprint hash — GlobalVariables store doubles only, so the    |
//| dedupe key is persisted as a 64-bit rolling hash of the string.  |
//+------------------------------------------------------------------+
long FpHash(const string s)
  {
   long h = 5381;
   for(int i = 0; i < StringLen(s); i++)
      h = (h * 33 + (long)StringGetCharacter(s, i)) % 4611686018427387903;
   return h;
  }

void PersistFp()
  {
   GlobalVariableSet(GV_FP_KEY + "_" + (string)InpMagic, (double)g_lastFpHash);
  }

void RestoreFp()
  {
   string gv = GV_FP_KEY + "_" + (string)InpMagic;
   if(GlobalVariableCheck(gv))
      g_lastFpHash = (long)GlobalVariableGet(gv);
  }

//+------------------------------------------------------------------+
//| Instrument helpers                                                |
//+------------------------------------------------------------------+
double NormalizePrice(double price)
  {
   double tick = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(tick <= 0) return NormalizeDouble(price, (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS));
   return NormalizeDouble(MathRound(price / tick) * tick, (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS));
  }

double NormalizeVolume(double vol)
  {
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   if(step > 0) vol = MathFloor(vol / step + 0.0000001) * step;
   if(vol < vmin) vol = vmin;
   if(vol > vmax) vol = vmax;
   return vol;
  }

double ComputeLots(double entry, double sl)
  {
   double vol = InpLots;
   if(InpRiskPercent > 0.0)
     {
      double tickSize  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
      double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
      double slDist    = MathAbs(entry - sl);
      if(tickSize > 0 && tickValue > 0 && slDist > 0)
        {
         double riskPerLot = slDist / tickSize * tickValue; // money risked by 1.0 lot
         if(riskPerLot > 0)
            vol = AccountInfoDouble(ACCOUNT_BALANCE) * InpRiskPercent / 100.0 / riskPerLot;
        }
     }
   return NormalizeVolume(vol);
  }

bool SpreadTooWide()
  {
   if(InpMaxSpreadPoints <= 0) return false;
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double point = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   if(point <= 0) return false;
   return ((ask - bid) / point) > (double)InpMaxSpreadPoints;
  }

/** true when a position with our magic exists on this symbol */
bool HaveTradePilotPosition(ulong &ticket)
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      if(!PositionSelectByTicket(t)) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      ticket = t;
      return true;
     }
   ticket = 0;
   return false;
  }

//+------------------------------------------------------------------+
//| Fetch + parse the feed. Returns true when a NEW, unhandled       |
//| signal is present (fills g_sig).                                 |
//+------------------------------------------------------------------+
bool FetchNewSignal()
  {
   char data[];
   char result[];
   string headers;
   ResetLastError();
   int code = WebRequest("GET", InpFeedUrl, "", 10000, data, result, headers);

   if(code == -1)
     {
      long err = GetLastError();
      if(err == 4014)
         Print("TradePilot Copier: WebRequest blocked. MT5 -> Tools -> Options -> Expert Advisors -> ",
               "allow WebRequest for: https://tradepilot1.gabeyre80.workers.dev");
      else
         Print("TradePilot Copier: WebRequest failed, error ", err);
      g_lastStatus = "feed unreachable (err " + (string)err + ")";
      return false;
     }
   if(code != 200)
     {
      Print("TradePilot Copier: feed HTTP ", code);
      g_lastStatus = "feed HTTP " + (string)code;
      return false;
     }

   string json = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);

   string sigObj;
   if(!JsonRawValue(json, "signal", sigObj))
     {
      g_lastStatus = "feed parse error";
      return false;
     }
   if(sigObj == "null" || sigObj == "")
     {
      g_lastStatus = "no setup on last closed bar";
      return false;
     }

   string fp;
   if(!JsonRawValue(sigObj, "fingerprint", fp) || fp == "")
     {
      g_lastStatus = "feed parse error (fingerprint)";
      return false;
     }

   long hash = FpHash(fp);
   if(hash == g_lastFpHash)
     {
      g_lastStatus = "signal already handled";
      return false;
     }

   string side;
   if(!JsonRawValue(sigObj, "side", side))
     {
      g_lastStatus = "feed parse error (side)";
      return false;
     }

   double targets[];
   int n = JsonNumberArray(sigObj, "targets", targets);
   if(n < 1)
     {
      g_lastStatus = "feed parse error (targets)";
      return false;
     }

   g_sig.fpHash   = hash;
   g_sig.fp       = fp;
   g_sig.side     = side;
   g_sig.entry    = JsonNumber(sigObj, "entry");
   g_sig.stopLoss = JsonNumber(sigObj, "stopLoss");
   g_sig.nTargets = n;
   g_sig.tp1      = targets[0];
   g_sig.tpFinal  = targets[n - 1];
   g_sig.tp2      = (n >= 3) ? targets[1] : 0.0;

   if(g_sig.entry <= 0 || g_sig.stopLoss <= 0 || g_sig.tpFinal <= 0)
     {
      g_lastStatus = "feed parse error (levels)";
      return false;
     }

   return true;
  }

//+------------------------------------------------------------------+
//| Place the trade for g_sig.                                       |
//| Faithful fill semantics: if price is already at/beyond the setup |
//| entry, enter at market (the engine would fill its limit at that  |
//| price immediately); otherwise rest a limit order at the entry    |
//| with an expiry (the engine's order-expiry rule).                 |
//+------------------------------------------------------------------+
void PlaceTrade()
  {
   ulong existing;
   if(HaveTradePilotPosition(existing))
     {
      g_lastFpHash = g_sig.fpHash;
      PersistFp();
      g_lastStatus = "signal skipped (position already open)";
      return;
     }

   double ask  = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid  = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double entry = NormalizePrice(g_sig.entry);
   double sl   = NormalizePrice(g_sig.stopLoss);
   double tp   = NormalizePrice(g_sig.tpFinal);
   bool   isLong = (g_sig.side == "LONG");

   if(SpreadTooWide())
     {
      g_lastFpHash = g_sig.fpHash;
      PersistFp();
      g_lastStatus = "signal skipped (spread guard)";
      Print("TradePilot Copier: signal skipped — spread too wide");
      return;
     }

   double vol = ComputeLots(entry, sl);
   if(vol <= 0)
     {
      g_lastStatus = "sizing error";
      return;
     }

   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpSlippagePoints);

   bool priceReached = isLong ? (ask <= entry) : (bid >= entry);
   bool ok = false;

   if(InpEntryMode == MODE_MARKET || priceReached)
     {
      ok = isLong ? trade.Buy(vol, _Symbol, 0.0, sl, tp, InpCommentText)
                  : trade.Sell(vol, _Symbol, 0.0, sl, tp, InpCommentText);
      if(ok)
        {
         g_orderTicket = 0;
         g_plannedVolume = vol;
         g_sessionPlaced = true;
        }
     }
   else
     {
      datetime exp = TimeCurrent() + (datetime)(InpExpiryMinutes * 60);
      ok = isLong
           ? trade.BuyLimit(vol, entry, _Symbol, sl, tp, ORDER_TIME_SPECIFIED, exp, InpCommentText)
           : trade.SellLimit(vol, entry, _Symbol, sl, tp, ORDER_TIME_SPECIFIED, exp, InpCommentText);

      // some brokers only accept GTC — retry without expiry rather than dropping the signal
      if(!ok)
        {
         Print("TradePilot Copier: expiry rejected (", trade.ResultRetcodeDescription(),
               ") — retrying as GTC");
         ok = isLong
              ? trade.BuyLimit(vol, entry, _Symbol, sl, tp, ORDER_TIME_GTC, 0, InpCommentText)
              : trade.SellLimit(vol, entry, _Symbol, sl, tp, ORDER_TIME_GTC, 0, InpCommentText);
        }
      if(ok)
        {
         g_orderTicket = trade.ResultOrder();
         g_plannedVolume = vol;
         g_sessionPlaced = true;
        }
     }

   g_lastFpHash = g_sig.fpHash;
   PersistFp();

   if(ok)
     {
      g_tp1Done = false;
      g_tp2Done = false;
      g_managing = false;
      g_lastStatus = (isLong ? "LONG" : "SHORT") + (string)" placed @ " + DoubleToString(entry, _Digits) +
                     " SL " + DoubleToString(sl, _Digits) +
                     " vol " + DoubleToString(vol, 2);
      Print("TradePilot Copier: placed ", g_sig.side, " ", DoubleToString(vol, 2),
            " entry ", DoubleToString(entry, _Digits),
            " SL ", DoubleToString(sl, _Digits),
            " TP ", DoubleToString(tp, _Digits),
            " [", g_sig.fp, "]");
     }
   else
     {
      g_lastStatus = "order rejected: " + trade.ResultRetcodeDescription();
      Print("TradePilot Copier: order FAILED — ", trade.ResultRetcode(), " ",
            trade.ResultRetcodeDescription());
     }
  }

//+------------------------------------------------------------------+
//| Position management: adopt placed trades, run the partial        |
//| ladder at TP1/TP2 and the breakeven move (Best preset mirror).   |
//+------------------------------------------------------------------+
void ManagePositions()
  {
   ulong ticket;
   bool  have = HaveTradePilotPosition(ticket);

   // adopt: a trade we just placed now exists as a position
   if(have && !g_managing && g_sessionPlaced)
     {
      g_managing = true;
      g_tp1Done = false;
      g_tp2Done = false;
      g_initVolume = (g_plannedVolume > 0) ? g_plannedVolume
                                           : PositionGetDouble(POSITION_VOLUME);
      if(!PositionSelectByTicket(ticket)) return;
      Print("TradePilot Copier: managing position #", ticket,
            " init volume ", DoubleToString(g_initVolume, 2));
     }

   // position exists but this EA session never placed it (terminal/EA
   // restart mid-trade): leave it to its native SL/TP — no partials,
   // because the original volume and ladder progress are unknown.
   if(have && !g_managing && !g_sessionPlaced)
     {
      g_lastStatus = "in position (pre-existing) — native SL/TP only";
      return;
     }

   // pending order lifecycle: if it vanished (expired) and no position
   // exists, clear the pending book — the fingerprint stays consumed.
   if(g_orderTicket > 0 && !OrderSelect(g_orderTicket) && !have)
     {
      Print("TradePilot Copier: pending order #", g_orderTicket, " expired/canceled");
      g_orderTicket = 0;
      g_lastStatus = "entry order expired — flat";
     }
   if(have) g_orderTicket = 0;

   if(!have || !g_managing) return;
   if(!PositionSelectByTicket(ticket)) return;

   long   type = PositionGetInteger(POSITION_TYPE);
   bool   isLong = (type == POSITION_TYPE_BUY);
   double point = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   double volMin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double mark = isLong ? bid : ask; // exit side price

   // --- TP1 partial + breakeven
   if(!g_tp1Done && g_sig.tp1 > 0)
     {
      bool hit = isLong ? (mark >= g_sig.tp1) : (mark <= g_sig.tp1);
      if(hit)
        {
         double closeVol = NormalizeVolume(g_initVolume * InpLadder1);
         double openVol = PositionGetDouble(POSITION_VOLUME);
         if(closeVol >= volMin && openVol - closeVol >= volMin)
            if(trade.PositionClosePartial(ticket, closeVol, InpSlippagePoints))
               Print("TradePilot Copier: TP1 hit — closed ", DoubleToString(closeVol, 2));
            else
               Print("TradePilot Copier: TP1 partial close failed — ",
                     trade.ResultRetcodeDescription());
         else if(closeVol >= volMin)
            trade.PositionClosePartial(ticket, NormalizeVolume(openVol), InpSlippagePoints);

         g_tp1Done = true;

         if(InpBreakEvenTP1 && PositionSelectByTicket(ticket))
           {
            double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
            double curSl = PositionGetDouble(POSITION_SL);
            double curTp = PositionGetDouble(POSITION_TP);
            double be = isLong ? openPrice + InpBeOffsetPoints * point
                               : openPrice - InpBeOffsetPoints * point;
            be = NormalizePrice(be);
            bool valid = isLong ? (be < bid) : (be > ask);
            bool improves = isLong ? (curSl == 0 || be > curSl) : (curSl == 0 || be < curSl);
            if(valid && improves)
               if(trade.PositionModify(ticket, be, curTp))
                  Print("TradePilot Copier: stop moved to breakeven ", DoubleToString(be, _Digits));
           }
        }
     }

   // --- TP2 partial (only when a third target exists to run into)
   if(!g_tp2Done && g_sig.tp2 > 0)
     {
      bool hit = isLong ? (mark >= g_sig.tp2) : (mark <= g_sig.tp2);
      if(hit)
        {
         double closeVol = NormalizeVolume(g_initVolume * InpLadder2);
         double openVol = PositionGetDouble(POSITION_VOLUME);
         if(closeVol >= volMin && openVol - closeVol >= volMin)
            if(trade.PositionClosePartial(ticket, closeVol, InpSlippagePoints))
               Print("TradePilot Copier: TP2 hit — closed ", DoubleToString(closeVol, 2));
            else
               Print("TradePilot Copier: TP2 partial close failed — ",
                     trade.ResultRetcodeDescription());
         else
            Print("TradePilot Copier: TP2 hit — remainder below min lot, leaving native TP to close");

         g_tp2Done = true;
        }
     }

   if(g_tp1Done)
      g_lastStatus = "in position — TP1 done" + (string)(g_tp2Done ? ", TP2 done, running to final" : (g_sig.tp2 > 0 ? ", running to TP2/final" : ", running to final"));
  }

//+------------------------------------------------------------------+
//| Chart status line                                                 |
//+------------------------------------------------------------------+
void UpdateComment()
  {
   string mode = (InpEntryMode == MODE_MARKET) ? "market" : "auto(limit/market)";
   string lotDesc = (InpRiskPercent > 0)
                    ? DoubleToString(InpRiskPercent, 2) + "% risk"
                    : DoubleToString(InpLots, 2) + " lots";
   Comment(
      "TradePilot Copier ", (InpEnabled ? "[ON]" : "[OFF]"), "\n",
      "feed: every ", (string)InpPollSeconds, "s | entry: ", mode, " | size: ", lotDesc, "\n",
      "last poll: ", (g_lastPoll > 0 ? TimeToString(g_lastPoll, TIME_DATE | TIME_MINUTES | TIME_SECONDS) : "-"), "\n",
      "status: ", g_lastStatus, "\n",
      "magic: ", (string)InpMagic, " | ladder ", DoubleToString(InpLadder1 * 100, 0), "/", DoubleToString(InpLadder2 * 100, 0), "/", DoubleToString((1 - InpLadder1 - InpLadder2) * 100, 0));
  }

//+------------------------------------------------------------------+
//| Lifecycle                                                        |
//+------------------------------------------------------------------+
int OnInit()
  {
   if(StringLen(InpFeedUrl) == 0)
     {
      Print("TradePilot Copier: InpFeedUrl is empty");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(InpPollSeconds < 10)
     {
      Print("TradePilot Copier: poll interval below 10s not allowed");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(InpLadder1 + InpLadder2 >= 1.0)
     {
      Print("TradePilot Copier: InpLadder1 + InpLadder2 must be < 1.0");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(InpLots <= 0 && InpRiskPercent <= 0)
     {
      Print("TradePilot Copier: set InpLots or InpRiskPercent");
      return INIT_PARAMETERS_INCORRECT;
     }

   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpSlippagePoints);
   RestoreFp();

   EventSetTimer(InpPollSeconds);
   g_lastStatus = "ready — waiting for next poll";
   Print("TradePilot Copier: ready on ", _Symbol,
         " | magic ", (string)InpMagic,
         " | last handled signal hash ", (string)g_lastFpHash,
         " | WARNING: real orders — verify on demo first");
   UpdateComment();
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   Comment("");
  }

void OnTimer()
  {
   g_lastPoll = TimeCurrent();
   if(InpEnabled)
     {
      if(FetchNewSignal())
         PlaceTrade();
     }
   else
      g_lastStatus = "paused (kill switch)";
   ManagePositions();
   UpdateComment();
  }

void OnTick()
  {
   // ladder + BE management on every tick for precise fills;
   // feed polling stays on the timer.
   ManagePositions();
  }
//+------------------------------------------------------------------+
