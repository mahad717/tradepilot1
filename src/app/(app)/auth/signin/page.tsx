import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PRIVATE_ROBOTS } from "@/lib/seo";
import { LogoMark } from "@/components/site/header";

export const metadata: Metadata = {
  title: "Sign in | TradePilot",
  robots: PRIVATE_ROBOTS,
};

export default function SignInPage() {
  // Demo authentication: in production this page wires to Supabase Auth
  // (email/password + magic link). For now, entering the terminal directly
  // opens the demo workspace.
  async function demoSignIn(formData: FormData) {
    "use server";
    redirect("/dashboard");
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center">
          <LogoMark className="h-10 w-10" />
          <h1 className="mt-4 text-xl font-bold tracking-tight text-foreground">
            Sign in to TradePilot
          </h1>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            Demo mode — authentication is prepared for Supabase Auth.
          </p>
        </div>
        <form
          action={demoSignIn}
          className="mt-8 space-y-4 rounded-xl border border-border bg-card p-6"
        >
          <div>
            <label
              htmlFor="email"
              className="mb-1.5 block text-sm font-medium text-foreground"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              placeholder="you@example.com"
              className="flex h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-sm font-medium text-foreground"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              placeholder="••••••••"
              className="flex h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <button
            type="submit"
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-gold-soft"
          >
            Enter demo terminal
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Don&apos;t need the terminal?{" "}
          <Link href="/" className="text-gold hover:underline">
            Back to the public site
          </Link>
        </p>
      </div>
    </main>
  );
}
