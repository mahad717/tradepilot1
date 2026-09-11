"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";

const NAV_LINKS = [
  { href: "/xauusd", label: "XAUUSD" },
  { href: "/xagusd", label: "XAGUSD" },
  { href: "/ict-strategy", label: "ICT Strategy" },
  { href: "/ict-backtesting", label: "Backtesting" },
  { href: "/blog", label: "Blog" },
  { href: "/pricing", label: "Pricing" },
] as const;

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border/80 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2.5"
          aria-label="TradePilot home"
        >
          <LogoMark />
          <span className="text-lg font-bold tracking-tight text-foreground">
            Trade<span className="text-gold">Pilot</span>
          </span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <Link
            href="/auth/signin"
            className="rounded-lg px-4 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign in
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex min-h-10 items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-gold-soft"
          >
            Open Terminal
          </Link>
        </div>

        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-border lg:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? (
            <X className="h-5 w-5" aria-hidden="true" />
          ) : (
            <Menu className="h-5 w-5" aria-hidden="true" />
          )}
        </button>
      </div>

      {open ? (
        <nav
          id="mobile-nav"
          aria-label="Mobile"
          className="border-t border-border bg-background lg:hidden"
        >
          <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-4">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-3 text-[15px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
            <div className="mt-2 flex flex-col gap-2">
              <Link
                href="/dashboard"
                onClick={() => setOpen(false)}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
              >
                Open Terminal
              </Link>
              <Link
                href="/auth/signin"
                onClick={() => setOpen(false)}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-semibold text-foreground"
              >
                Sign in
              </Link>
            </div>
          </div>
        </nav>
      ) : null}
    </header>
  );
}

export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="TradePilot logo"
    >
      <rect width="64" height="64" rx="14" fill="#15171d" />
      <path
        d="M14 40 L24 40 L24 24 L32 24 L32 44 L40 44 L40 30 L50 30"
        stroke="#e8b54d"
        strokeWidth="5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="50" cy="30" r="4" fill="#e8b54d" />
    </svg>
  );
}
