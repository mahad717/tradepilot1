import { Container } from "./ui";

/**
 * Transparent risk disclaimer (E-E-A-T). Reused across public pages.
 */
export function RiskDisclaimer({ compact = false }: { compact?: boolean }) {
  return (
    <Container className={compact ? "pb-12" : "pb-16"}>
      <aside
        aria-label="Risk disclaimer"
        className="rounded-xl border border-gold/25 bg-gold/5 p-5"
      >
        <h2 className="text-sm font-semibold text-gold">
          Risk disclaimer
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          TradePilot provides educational, rule-based market analysis — not
          financial advice or a recommendation to trade. Signals are
          systematically generated from published ICT rules, and every
          backtest carries inherent limitations. Trading gold, silver and
          other markets involves substantial risk of loss. Past performance
          does not guarantee future results.
        </p>
      </aside>
    </Container>
  );
}
