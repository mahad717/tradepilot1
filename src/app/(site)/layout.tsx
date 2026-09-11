import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { JsonLd } from "@/components/seo/json-ld";
import { organizationSchema, webSiteSchema } from "@/lib/schema";

export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Site-wide structured data: Organization + WebSite */}
      <JsonLd data={[organizationSchema(), webSiteSchema()]} />
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </>
  );
}
