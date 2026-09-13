"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "./auth-provider";
import { Button } from "@/components/ui/button";

export function TerminalHeaderRight() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();

  if (loading) {
    return <div className="h-8 w-28 animate-pulse rounded-lg bg-muted/60" aria-hidden />;
  }

  if (user) {
    return (
      <div className="flex flex-shrink-0 items-center gap-3">
        <span className="hidden max-w-[180px] truncate text-muted-foreground sm:inline">
          {user.email}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-8 whitespace-nowrap border-border text-muted-foreground hover:text-foreground"
          onClick={async () => {
            await signOut();
            router.push("/auth/signin");
          }}
        >
          Sign out
        </Button>
        <Link
          href="/welcome"
          className="hidden h-8 items-center whitespace-nowrap rounded-lg border border-border px-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
        >
          Back to site
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-shrink-0 items-center gap-2">
      <Link
        href="/auth/signin?next=/dashboard"
        className="inline-flex h-8 items-center whitespace-nowrap rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-gold-soft"
      >
        Sign in
      </Link>
      <Link
        href="/"
        className="hidden h-8 items-center whitespace-nowrap rounded-lg border border-border px-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
      >
        Back to site
      </Link>
    </div>
  );
}
