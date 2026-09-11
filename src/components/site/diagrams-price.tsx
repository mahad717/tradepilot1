/**
 * Hand-drawn SVG diagrams used inside educational pages and articles.
 * All diagrams are server-rendered SVG: zero image payload, responsive,
 * with descriptive titles/labels for accessibility and image SEO.
 */

interface DiagramProps {
  className?: string;
}

function Frame({
  label,
  children,
  className,
  viewBox = "0 0 320 180",
}: DiagramProps & { label: string; children: React.ReactNode; viewBox?: string }) {
  return (
    <figure className={className}>
      <svg
        viewBox={viewBox}
        className="h-auto w-full rounded-xl border border-border bg-[oklch(0.17_0.01_260)]"
        role="img"
        aria-label={label}
      >
        <title>{label}</title>
        {children}
      </svg>
    </figure>
  );
}

const GOLD = "#e8b54d";
const BULL = "#34d399";
const BEAR = "#f87171";
const GRID = "#2a2e38";
const TEXT = "#9aa1af";

export function LiquiditySweepDiagram({ className }: DiagramProps) {
  return (
    <Frame
      className={className}
      label="Diagram of a bullish liquidity sweep on XAUUSD: price dips below equal lows, triggers sell stops, then reverses with a market structure shift"
    >
      {/* equal lows line */}
      <line x1="30" y1="120" x2="200" y2="120" stroke={GRID} strokeWidth="2" strokeDasharray="5 4" />
      <text x="30" y="137" fill={TEXT} fontSize="11">Equal lows — resting liquidity</text>
      {/* candles */}
      <g strokeWidth="2">
        <line x1="45" y1="70" x2="45" y2="122" stroke={BEAR} /><rect x="40" y="80" width="10" height="26" fill={BEAR} />
        <line x1="70" y1="78" x2="70" y2="124" stroke={BULL} /><rect x="65" y="84" width="10" height="28" fill={BULL} />
        <line x1="95" y1="88" x2="95" y2="124" stroke={BEAR} /><rect x="90" y="94" width="10" height="24" fill={BEAR} />
        <line x1="120" y1="80" x2="120" y2="123" stroke={BULL} /><rect x="115" y="86" width="10" height="30" fill={BULL} />
        {/* sweep candle: long wick below */}
        <line x1="150" y1="86" x2="150" y2="152" stroke={BEAR} /><rect x="145" y="92" width="10" height="18" fill={BEAR} />
        {/* reversal candles */}
        <line x1="180" y1="120" x2="180" y2="88" stroke={BULL} /><rect x="175" y="92" width="10" height="24" fill={BULL} />
        <line x1="210" y1="98" x2="210" y2="60" stroke={BULL} /><rect x="205" y="64" width="10" height="30" fill={BULL} />
        <line x1="240" y1="70" x2="240" y2="34" stroke={BULL} /><rect x="235" y="38" width="10" height="28" fill={BULL} />
      </g>
      <text x="28" y="166" fill={BEAR} fontSize="11" fontWeight="600">Sweep: stops triggered below lows</text>
      <path d="M160 78 Q185 40 235 30" stroke={GOLD} strokeWidth="1.5" fill="none" strokeDasharray="4 4" />
      <text x="228" y="22" fill={GOLD} fontSize="11" fontWeight="600">Reversal / MSS</text>
    </Frame>
  );
}

export function FairValueGapDiagram({ className }: DiagramProps) {
  return (
    <Frame
      className={className}
      label="Diagram of a fair value gap: a three-candle impulse leaves an inefficient gap between the first candle's high and the third candle's low"
    >
      <g strokeWidth="2">
        <line x1="55" y1="95" x2="55" y2="140" stroke={BEAR} /><rect x="50" y="105" width="12" height="28" fill={BEAR} />
        <line x1="105" y1="35" x2="105" y2="112" stroke={BULL} /><rect x="100" y="42" width="12" height="62" fill={BULL} />
        <line x1="155" y1="28" x2="155" y2="88" stroke={BULL} /><rect x="150" y="34" width="12" height="46" fill={BULL} />
      </g>
      {/* FVG zone */}
      <rect x="70" y="58" width="160" height="42" fill="rgba(232,181,77,0.14)" stroke={GOLD} strokeDasharray="4 3" />
      <text x="76" y="55" fill={GOLD} fontSize="11" fontWeight="600">Fair Value Gap (inefficiency)</text>
      <text x="70" y="76" fill={TEXT} fontSize="10">candle 1 high</text>
      <text x="70" y="96" fill={TEXT} fontSize="10">candle 3 low</text>
      {/* retrace arrow */}
      <path d="M240 40 Q250 78 214 80" stroke={GOLD} strokeWidth="1.8" fill="none" />
      <path d="M214 80 l7 -5 M214 80 l8 3" stroke={GOLD} strokeWidth="1.8" fill="none" />
      <text x="205" y="30" fill={TEXT} fontSize="11">Price often retraces into the gap</text>
    </Frame>
  );
}

export function OrderBlockDiagram({ className }: DiagramProps) {
  return (
    <Frame
      className={className}
      label="Diagram of a bullish order block: the last bearish candle before a strong rally, retested by price before continuation"
    >
      <g strokeWidth="2">
        <line x1="50" y1="60" x2="50" y2="120" stroke={BEAR} /><rect x="45" y="72" width="12" height="40" fill={BEAR} />
        <line x1="80" y1="76" x2="80" y2="126" stroke={BEAR} /><rect x="75" y="86" width="12" height="34" fill={BEAR} />
        <line x1="110" y1="60" x2="110" y2="120" stroke={BEAR} /><rect x="105" y="70" width="12" height="42" fill={BEAR} />
        <line x1="145" y1="30" x2="145" y2="92" stroke={BULL} /><rect x="140" y="36" width="12" height="50" fill={BULL} />
        <line x1="180" y1="24" x2="180" y2="70" stroke={BULL} /><rect x="175" y="30" width="12" height="34" fill={BULL} />
        <line x1="215" y1="30" x2="215" y2="64" stroke={BULL} /><rect x="210" y="36" width="12" height="24" fill={BULL} />
        {/* retrace into OB */}
        <line x1="250" y1="38" x2="250" y2="80" stroke={BEAR} /><rect x="245" y="48" width="12" height="28" fill={BEAR} />
        <line x1="285" y1="42" x2="285" y2="26" stroke={BULL} /><rect x="280" y="30" width="12" height="16" fill={BULL} />
      </g>
      <rect x="95" y="66" width="80" height="52" fill="rgba(232,181,77,0.14)" stroke={GOLD} strokeDasharray="4 3" />
      <text x="97" y="63" fill={GOLD} fontSize="11" fontWeight="600">Bullish order block</text>
      <text x="205" y="140" fill={TEXT} fontSize="11">Retest of the order block</text>
      <path d="M251 84 Q251 96 285 34" stroke={GOLD} strokeWidth="1.5" fill="none" strokeDasharray="4 4" />
    </Frame>
  );
}
