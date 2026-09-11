/**
 * Structural diagrams: MSS/BOS, premium/discount, SMT divergence.
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

export function MarketStructureDiagram({ className }: DiagramProps) {
  return (
    <Frame
      className={className}
      label="Diagram contrasting a break of structure, which continues the trend, with a market structure shift, which reverses it"
    >
      {/* BOS: uptrend continuation */}
      <g strokeWidth="2">
        <line x1="45" y1="140" x2="45" y2="105" stroke={BULL} /><rect x="40" y="110" width="10" height="26" fill={BULL} />
        <line x1="70" y1="112" x2="70" y2="78" stroke={BULL} /><rect x="65" y="84" width="10" height="26" fill={BULL} />
        <line x1="95" y1="90" x2="95" y2="60" stroke={BULL} /><rect x="90" y="66" width="10" height="22" fill={BULL} />
        {/* MSS: failure + reversal */}
        <line x1="130" y1="58" x2="130" y2="96" stroke={BEAR} /><rect x="125" y="64" width="10" height="28" fill={BEAR} />
        <line x1="160" y1="70" x2="160" y2="112" stroke={BEAR} /><rect x="155" y="76" width="10" height="32" fill={BEAR} />
        <line x1="190" y1="96" x2="190" y2="140" stroke={BEAR} /><rect x="185" y="102" width="10" height="34" fill={BEAR} />
      </g>
      {/* BOS level */}
      <line x1="60" y1="76" x2="140" y2="76" stroke={BULL} strokeWidth="1.5" strokeDasharray="4 3" />
      <text x="42" y="26" fill={BULL} fontSize="11" fontWeight="600">BOS — higher high, trend continues</text>
      {/* MSS level */}
      <line x1="105" y1="96" x2="185" y2="96" stroke={BEAR} strokeWidth="1.5" strokeDasharray="4 3" />
      <text x="150" y="164" fill={BEAR} fontSize="11" fontWeight="600">MSS — swing broken, bias flips</text>
    </Frame>
  );
}

export function PremiumDiscountDiagram({ className }: DiagramProps) {
  return (
    <Frame
      className={className}
      label="Diagram of a dealing range split into a premium zone above the equilibrium midpoint and a discount zone below it"
    >
      {/* range */}
      <rect x="50" y="30" width="220" height="120" fill="none" stroke={GRID} strokeWidth="2" />
      {/* equilibrium */}
      <line x1="50" y1="90" x2="270" y2="90" stroke={GOLD} strokeWidth="1.8" strokeDasharray="6 4" />
      <text x="215" y="86" fill={GOLD} fontSize="11" fontWeight="600">Equilibrium (50%)</text>
      {/* premium */}
      <rect x="50" y="30" width="220" height="60" fill="rgba(248,113,113,0.07)" />
      <text x="58" y="48" fill={BEAR} fontSize="11.5" fontWeight="600">Premium — avoid new longs</text>
      {/* discount */}
      <rect x="50" y="90" width="220" height="60" fill="rgba(52,211,153,0.07)" />
      <text x="58" y="140" fill={BULL} fontSize="11.5" fontWeight="600">Discount — seek long entries</text>
      {/* swing points */}
      <text x="58" y="26" fill={TEXT} fontSize="10">Range high</text>
      <text x="58" y="166" fill={TEXT} fontSize="10">Range low</text>
    </Frame>
  );
}

export function SmtDivergenceDiagram({ className }: DiagramProps) {
  return (
    <Frame
      className={className}
      label="Diagram of SMT divergence between gold and silver: gold sweeps its high while silver fails to make a new high, signaling divergence"
    >
      {/* XAUUSD panel */}
      <text x="30" y="24" fill={TEXT} fontSize="11" fontWeight="600">XAUUSD (Gold)</text>
      <polyline
        points="30,110 80,70 120,95 165,55 210,80 260,45"
        fill="none" stroke={GOLD} strokeWidth="2.5"
      />
      <circle cx="165" cy="55" r="4" fill={GOLD} />
      <circle cx="260" cy="45" r="4" fill={GOLD} />
      <line x1="165" y1="55" x2="260" y2="45" stroke={GOLD} strokeWidth="1.2" strokeDasharray="3 3" />
      <text x="196" y="40" fill={GOLD} fontSize="10">New high ✓</text>

      {/* XAGUSD panel */}
      <text x="30" y="100" fill={TEXT} fontSize="11" fontWeight="600">XAGUSD (Silver)</text>
      <polyline
        points="30,160 80,135 120,150 165,120 210,142 260,128"
        fill="none" stroke={GOLD} strokeWidth="2.5"
      />
      <circle cx="165" cy="120" r="4" fill={BULL} />
      <circle cx="260" cy="128" r="4" fill={BEAR} />
      <line x1="165" y1="120" x2="260" y2="128" stroke={BEAR} strokeWidth="1.2" strokeDasharray="3 3" />
      <text x="186" y="152" fill={BEAR} fontSize="10">Failure — lower high ✕</text>

      <text x="212" y="176" fill={TEXT} fontSize="10.5">SMT divergence between markets</text>
    </Frame>
  );
}
