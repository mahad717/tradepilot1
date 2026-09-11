import Link from "next/link";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Layout primitives for the public SEO site (server components only)  */
/* ------------------------------------------------------------------ */

export function Container({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6", className)}>
      {children}
    </div>
  );
}

export function Section({
  id,
  className,
  children,
  ariaLabel,
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  return (
    <section
      id={id}
      aria-label={ariaLabel}
      className={cn("py-14 sm:py-20", className)}
    >
      {children}
    </section>
  );
}

/** Eyebrow + H2 + lede used above most page sections. */
export function SectionHeading({
  eyebrow,
  title,
  lede,
  className,
  align = "left",
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  className?: string;
  align?: "left" | "center";
}) {
  return (
    <div
      className={cn(
        "max-w-3xl",
        align === "center" && "mx-auto text-center",
        className
      )}
    >
      {eyebrow ? (
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-gold">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
        {title}
      </h2>
      {lede ? (
        <p className="mt-3 text-[15.5px] leading-7 text-muted-foreground">
          {lede}
        </p>
      ) : null}
    </div>
  );
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-6",
        className
      )}
    >
      {children}
    </div>
  );
}

export function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-gold">
      {children}
    </span>
  );
}

export function CheckItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <svg
        aria-hidden="true"
        className="mt-1 h-4 w-4 shrink-0 text-gold"
        viewBox="0 0 20 20"
        fill="currentColor"
      >
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
          clipRule="evenodd"
        />
      </svg>
      <span className="text-[15px] leading-6 text-muted-foreground">
        {children}
      </span>
    </li>
  );
}

/** Primary / secondary CTA row used across pages. */
export function CtaRow({
  primary,
  secondary,
  className,
}: {
  primary: { href: string; label: string };
  secondary?: { href: string; label: string };
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-3", className)}>
      <Link
        href={primary.href}
        className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-[0_0_24px_rgba(232,181,77,0.25)] transition-colors hover:bg-gold-soft"
      >
        {primary.label}
      </Link>
      {secondary ? (
        <Link
          href={secondary.href}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-secondary px-6 py-2.5 text-sm font-semibold text-foreground transition-colors hover:border-gold/50"
        >
          {secondary.label}
        </Link>
      ) : null}
    </div>
  );
}

/** Golden call-to-action banner (internal linking + conversion). */
export function CtaBanner({
  title,
  body,
  primary,
  secondary,
}: {
  title: string;
  body: string;
  primary: { href: string; label: string };
  secondary?: { href: string; label: string };
}) {
  return (
    <div className="rounded-2xl border border-gold/30 bg-gradient-to-br from-gold/15 via-card to-card p-8 sm:p-10">
      <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
        {title}
      </h2>
      <p className="mt-2 max-w-2xl text-[15.5px] leading-7 text-muted-foreground">
        {body}
      </p>
      <CtaRow className="mt-6" primary={primary} secondary={secondary} />
    </div>
  );
}
