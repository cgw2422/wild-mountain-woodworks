import { cn } from "@/lib/cn";

export function Container({
  children,
  className,
  size = "default",
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  size?: "narrow" | "default" | "wide" | "full";
  as?: "div" | "section" | "header" | "footer" | "nav" | "article";
}) {
  const max = { narrow: "max-w-3xl", default: "max-w-7xl", wide: "max-w-[96rem]", full: "max-w-none" }[size];
  return <Tag className={cn("mx-auto w-full px-5 sm:px-8 lg:px-12", max, className)}>{children}</Tag>;
}
