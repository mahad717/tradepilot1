import Link from "next/link";
import type { Block, DiagramId } from "@/lib/articles";
import { LiquiditySweepDiagram, FairValueGapDiagram, OrderBlockDiagram } from "./diagrams-price";
import { MarketStructureDiagram, PremiumDiscountDiagram, SmtDivergenceDiagram } from "./diagrams-structure";

const DIAGRAMS: Record<DiagramId, (props: { className?: string }) => JSX.Element> = {
  "liquidity-sweep": LiquiditySweepDiagram,
  "fair-value-gap": FairValueGapDiagram,
  "order-block": OrderBlockDiagram,
  "market-structure": MarketStructureDiagram,
  "premium-discount": PremiumDiscountDiagram,
  "smt-divergence": SmtDivergenceDiagram,
};

/**
 * Renders inline `**bold**` and `[text](/internal-path)` syntax used in
 * article JSON. Keeps content files portable and links crawlable.
 */
export function InlineText({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (linkMatch) {
          return (
            <Link key={i} href={linkMatch[2]}>
              {linkMatch[1]}
            </Link>
          );
        }
        const boldMatch = part.match(/^\*\*([^*]+)\*\*$/);
        if (boldMatch) {
          return <strong key={i}>{boldMatch[1]}</strong>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

export function ArticleRenderer({ blocks }: { blocks: Block[] }) {
  return (
    <div className="prose-tp space-y-5">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "h2":
            return (
              <h2
                key={i}
                className="pt-4 text-xl font-bold tracking-tight text-foreground sm:text-2xl"
              >
                {block.text}
              </h2>
            );
          case "h3":
            return (
              <h3 key={i} className="pt-2 text-lg font-semibold text-foreground">
                {block.text}
              </h3>
            );
          case "p":
            return <p key={i}><InlineText text={block.text} /></p>;
          case "list":
            return (
              <ul key={i} className="space-y-2 pl-1">
                {block.items.map((item, j) => (
                  <li key={j} className="flex gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-gold"
                    />
                    <span><InlineText text={item} /></span>
                  </li>
                ))}
              </ul>
            );
          case "callout":
            return (
              <aside
                key={i}
                aria-label={block.title}
                className={
                  block.variant === "warning"
                    ? "rounded-xl border border-gold/30 bg-gold/5 p-5"
                    : "rounded-xl border border-border bg-secondary p-5"
                }
              >
                <p className="text-sm font-semibold text-foreground">
                  {block.title}
                </p>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                  <InlineText text={block.text} />
                </p>
              </aside>
            );
          case "diagram": {
            const Diagram = DIAGRAMS[block.id];
            return (
              <figure key={i} className="space-y-2">
                <Diagram />
                <figcaption className="text-center text-xs text-muted-foreground">
                  {block.caption}
                </figcaption>
              </figure>
            );
          }
          case "links":
            return (
              <nav
                key={i}
                aria-label={block.title}
                className="rounded-xl border border-border bg-card p-5"
              >
                <p className="text-sm font-semibold text-foreground">{block.title}</p>
                <ul className="mt-3 space-y-2">
                  {block.items.map((item) => (
                    <li key={item.href + item.text}>
                      <Link
                        href={item.href}
                        className="text-sm font-medium text-gold underline decoration-gold/40 underline-offset-4 hover:decoration-gold"
                      >
                        {item.text}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
