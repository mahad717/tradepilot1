import { Suspense } from "react";
import type { Metadata } from "next";
import { PRIVATE_ROBOTS } from "@/lib/seo";
import SignInClient from "@/components/terminal/signin-client";

export const metadata: Metadata = {
  title: "Sign in | TradePilot",
  robots: PRIVATE_ROBOTS,
};

export default function SignInPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <Suspense fallback={null}>
        <SignInClient />
      </Suspense>
    </main>
  );
}
