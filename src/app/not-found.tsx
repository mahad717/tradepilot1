import Link from "next/link";
import { Container } from "@/components/site/ui";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <p className="font-mono text-sm text-gold">404</p>
      <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
        This page got swept away
      </h1>
      <p className="mt-3 max-w-md text-[15px] leading-7 text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist — probably taken
        out by a liquidity raid. Here are the useful places to go instead:
      </p>
      <nav aria-label="Helpful links" className="mt-8 flex flex-wrap justify-center gap-3">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-gold-soft"
        >
          Homepage
        </Link>
        <Link
          href="/xauusd"
          className="inline-flex min-h-11 items-center rounded-lg border border-border px-6 py-2.5 text-sm font-semibold text-foreground hover:border-gold/50"
        >
          XAUUSD analysis
        </Link>
        <Link
          href="/blog"
          className="inline-flex min-h-11 items-center rounded-lg border border-border px-6 py-2.5 text-sm font-semibold text-foreground hover:border-gold/50"
        >
          Blog &amp; guides
        </Link>
        <Link
          href="/faq"
          className="inline-flex min-h-11 items-center rounded-lg border border-border px-6 py-2.5 text-sm font-semibold text-foreground hover:border-gold/50"
        >
          FAQ
        </Link>
      </nav>
    </main>
  );
}
