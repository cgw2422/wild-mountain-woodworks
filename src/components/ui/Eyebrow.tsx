import { cn } from "@/lib/cn";

export function Eyebrow({ children, className, light }: { children: React.ReactNode; className?: string; light?: boolean }) {
  if (!children) return null;
  return (
    <p className={cn("eyebrow flex items-center gap-3", light ? "text-bronze-light" : "text-bronze-text", className)}>
      <span aria-hidden="true" className={cn("h-px w-8", light ? "bg-bronze-light/70" : "bg-bronze")} />
      <span>{children}</span>
    </p>
  );
}
