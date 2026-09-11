import Link from "next/link";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbSchema } from "@/lib/schema";

export interface Crumb {
  name: string;
  path: string;
}

/**
 * Visible breadcrumbs (matching BreadcrumbList JSON-LD).
 * Improves navigation, crawl depth and rich results.
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const allItems: Crumb[] = [{ name: "Home", path: "/" }, ...items];

  return (
    <nav aria-label="Breadcrumb">
      <JsonLd data={breadcrumbSchema(allItems)} />
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        {allItems.map((item, i) => {
          const isLast = i === allItems.length - 1;
          return (
            <li key={item.path} className="flex items-center gap-1.5">
              {i > 0 ? (
                <span aria-hidden="true" className="text-border">
                  /
                </span>
              ) : null}
              {isLast ? (
                <span aria-current="page" className="font-medium text-foreground">
                  {item.name}
                </span>
              ) : (
                <Link
                  href={item.path}
                  className="transition-colors hover:text-gold"
                >
                  {item.name}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
