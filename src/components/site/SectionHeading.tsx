import { cn } from "@/lib/cn";
import { Eyebrow } from "@/components/ui/Eyebrow";

export function SectionHeading({
  eyebrow,
  heading,
  subheading,
  align = "left",
  as: Tag = "h2",
  size = "lg",
  light,
  className,
  action,
}: {
  eyebrow?: string | null;
  heading?: string | null;
  subheading?: string | null;
  align?: "left" | "center";
  as?: "h1" | "h2" | "h3";
  size?: "xl" | "lg" | "md";
  light?: boolean;
  className?: string;
  action?: React.ReactNode;
}) {
  if (!heading && !eyebrow && !subheading) return null;
  const sizeClass = { xl: "display-xl", lg: "display-lg", md: "display-md" }[size];
  return (
    <div
      className={cn(
        "flex flex-col gap-6",
        align === "center" ? "items-center text-center" : "md:flex-row md:items-end md:justify-between",
        className,
      )}
    >
      <div className={cn("max-w-3xl", align === "center" && "mx-auto flex flex-col items-center")}>
        {eyebrow ? <Eyebrow light={light} className="mb-5">{eyebrow}</Eyebrow> : null}
        {heading ? <Tag className={cn(sizeClass, light ? "text-ivory" : "text-charcoal")}>{heading}</Tag> : null}
        {subheading ? <p className={cn("lede mt-5 max-w-xl", light ? "text-ivory/75" : "text-muted")}>{subheading}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
