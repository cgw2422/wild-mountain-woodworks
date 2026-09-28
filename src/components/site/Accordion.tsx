import { cn } from "@/lib/cn";

/**
 * Accessible disclosure list built on native <details>/<summary>: keyboard
 * and screen-reader support without JavaScript.
 */
export function Accordion({
  items,
  className,
  headingLevel = 3,
}: {
  items: Array<{ id: string; title: React.ReactNode; content: React.ReactNode; defaultOpen?: boolean }>;
  className?: string;
  headingLevel?: 2 | 3 | 4;
}) {
  const H = `h${headingLevel}` as "h2" | "h3" | "h4";
  return (
    <div className={cn("border-t border-stone", className)}>
      {items.map((item) => (
        <details key={item.id} className="group border-b border-stone" open={item.defaultOpen}>
          <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-6 py-5 [&::-webkit-details-marker]:hidden">
            <H className="text-[1.02rem] font-medium leading-snug text-charcoal">{item.title}</H>
            <span aria-hidden="true" className="relative h-3.5 w-3.5 shrink-0">
              <span className="absolute left-0 top-1/2 h-px w-full bg-charcoal" />
              <span className="absolute left-1/2 top-0 h-full w-px bg-charcoal transition-transform duration-300 group-open:scale-y-0" />
            </span>
          </summary>
          <div className="pb-7 pr-8">{item.content}</div>
        </details>
      ))}
    </div>
  );
}
