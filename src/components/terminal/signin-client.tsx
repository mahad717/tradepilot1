"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { LogoMark } from "@/components/site/header";

type Mode = "signin" | "signup";

export default function SignInClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/dashboard";

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setError("Authentication is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to the environment.");
      return;
    }

    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setError(error.message);
          return;
        }
        router.push(next);
        router.refresh();
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) {
          setError(error.message);
          return;
        }
        if (data.session) {
          // Email confirmation disabled — signed in immediately.
          router.push(next);
          router.refresh();
        } else {
          setNotice("Account created. Check your inbox to confirm your email address, then sign in.");
          setMode("signin");
        }
      }
    } catch {
      setError("Unexpected error contacting the authentication service. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "flex h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="w-full max-w-md">
      <div className="flex flex-col items-center">
        <LogoMark className="h-10 w-10" />
        <h1 className="mt-4 text-xl font-bold tracking-tight text-foreground">
          {mode === "signin" ? "Sign in to TradePilot" : "Create your TradePilot account"}
        </h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Access the ICT terminal, live signals and backtesting.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/40 p-1" role="tablist" aria-label="Authentication mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "signin"}
          onClick={() => { setMode("signin"); setError(null); setNotice(null); }}
          className={`min-h-9 rounded-md px-3 text-sm font-medium transition-colors ${mode === "signin" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "signup"}
          onClick={() => { setMode("signup"); setError(null); setNotice(null); }}
          className={`min-h-9 rounded-md px-3 text-sm font-medium transition-colors ${mode === "signup" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          Create account
        </button>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 space-y-4 rounded-xl border border-border bg-card p-6">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-foreground">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-foreground">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "signup" ? "At least 8 characters" : "••••••••"}
            className={inputCls}
          />
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-md border border-emerald-900/50 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
            {notice}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-gold-soft disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>

        <p className="text-center text-xs text-muted-foreground">
          {mode === "signin"
            ? "No account yet? Switch to Create account above."
            : "By creating an account you accept the terms of use and risk disclaimer."}
        </p>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Exploring first?{" "}
        <Link href="/" className="text-gold hover:underline">
          Back to the public site
        </Link>
      </p>
    </div>
  );
}
