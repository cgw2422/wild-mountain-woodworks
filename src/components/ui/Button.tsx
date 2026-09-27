import Link from "next/link";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "light" | "outline-light" | "text" | "text-light";
type Size = "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-3 text-[0.74rem] font-semibold uppercase tracking-[0.16em] transition-colors duration-300 disabled:opacity-60 select-none";

const variants: Record<Variant, string> = {
  primary: "bg-charcoal text-ivory hover:bg-walnut border border-charcoal hover:border-walnut",
  secondary: "border border-charcoal text-charcoal hover:bg-charcoal hover:text-ivory",
  light: "bg-ivory text-charcoal border border-ivory hover:bg-stone hover:border-stone",
  "outline-light": "border border-ivory/70 text-ivory hover:bg-ivory hover:text-charcoal",
  text: "text-charcoal link-underline !px-0 !min-h-0 py-1",
  "text-light": "text-ivory link-underline !px-0 !min-h-0 py-1",
};

const sizes: Record<Size, string> = {
  md: "min-h-12 px-7",
  lg: "min-h-14 px-9",
};

export function buttonClasses(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClasses(variant, size, className)} {...props} />;
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
  arrow,
  ...rest
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: React.ReactNode;
  arrow?: boolean;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const external = /^(https?:|mailto:|tel:)/.test(href);
  const content = (
    <>
      <span>{children}</span>
      {arrow ? <Arrow /> : null}
    </>
  );
  if (external) {
    return (
      <a href={href} className={buttonClasses(variant, size, className)} {...rest}>
        {content}
      </a>
    );
  }
  return (
    <Link href={href} className={buttonClasses(variant, size, className)} {...rest}>
      {content}
    </Link>
  );
}

export function Arrow({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 10" className={cn("h-2.5 w-6 shrink-0", className)} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M0 5h22M18 1l4 4-4 4" />
    </svg>
  );
}
