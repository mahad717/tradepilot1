"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export interface FaqItem {
  question: string;
  answer: string;
}

/**
 * Visible FAQ content. The FAQPage JSON-LD is rendered next to this
 * component (server-side) and matches these items exactly.
 */
export function FaqList({ items }: { items: FaqItem[] }) {
  return (
    <Accordion type="single" collapsible className="w-full">
      {items.map((item, i) => (
        <AccordionItem key={item.question} value={`item-${i}`}>
          <AccordionTrigger className="text-left text-[15.5px] font-medium text-foreground hover:text-gold hover:no-underline">
            {item.question}
          </AccordionTrigger>
          <AccordionContent className="text-[15px] leading-7 text-muted-foreground">
            {item.answer}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
