import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import { Container, Section } from "@/components/site/ui";
import { Breadcrumbs } from "@/components/site/breadcrumbs";

export const metadata: Metadata = buildMetadata({
  title: "Privacy Policy | TradePilot",
  description:
    "How TradePilot collects, uses and protects data: analytics with privacy in mind, no sale of personal data, and clear third-party processor disclosure.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <>
      <Container className="pt-8">
        <Breadcrumbs items={[{ name: "Privacy policy", path: "/privacy" }]} />
      </Container>
      <Section ariaLabel="Privacy policy">
        <Container>
          <div className="prose-tp mx-auto max-w-3xl space-y-6">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              Privacy policy
            </h1>
            <p>
              Last updated: August 14, 2026. This policy explains what data
              TradePilot collects and why. We keep it short and readable
              because privacy documents written to be skimmed are privacy
              documents written to be ignored.
            </p>

            <h2 className="text-xl font-bold text-foreground">What we collect</h2>
            <p>
              <strong>Usage analytics:</strong> when Google Analytics is
              enabled, we collect standard, aggregated usage metrics — pages
              visited, session duration, referral source, approximate region —
              with IP anonymization enabled. No personally identifiable
              information is attached to analytics events.
            </p>
            <p>
              <strong>Account data:</strong> if you create an account, we store
              your email address and authentication record. We use Supabase as
              our authentication and database processor; your credentials are
              never accessible to us in plaintext.
            </p>
            <p>
              <strong>Workspace data:</strong> your backtests, journals and
              settings are stored to provide the service and are visible only
              to you (or your team, on the Team plan).
            </p>

            <h2 className="text-xl font-bold text-foreground">What we never do</h2>
            <p>
              We do not sell personal data. We do not run advertising networks
              or third-party ad trackers. We do not collect data from the
              public educational pages beyond the anonymized analytics
              described above.
            </p>

            <h2 className="text-xl font-bold text-foreground">Your choices</h2>
            <p>
              You can use the entire public knowledge base without an account.
              If you have an account and want your data deleted, contact
              support and we will remove it within 30 days. Depending on your
              jurisdiction (including EU/EEA residents under GDPR), you may
              have additional rights to access, correct or export your data.
            </p>

            <h2 className="text-xl font-bold text-foreground">Contact</h2>
            <p>
              Questions about this policy can be sent to our support address
              listed on the about page. Changes to this policy will be posted
              on this page with an updated date.
            </p>
          </div>
        </Container>
      </Section>
    </>
  );
}
