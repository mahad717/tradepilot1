interface JsonLdProps {
  data: Record<string, unknown> | Record<string, unknown>[];
}

/**
 * Renders one or more JSON-LD structured data blocks.
 * `<` is escaped to prevent script-tag injection.
 */
export function JsonLd({ data }: JsonLdProps) {
  const payload = Array.isArray(data)
    ? data.map((d) => ({ "@context": "https://schema.org", ...d }))
    : [{ "@context": "https://schema.org", ...data }];

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(payload).replace(/</g, "\\u003c"),
      }}
    />
  );
}
