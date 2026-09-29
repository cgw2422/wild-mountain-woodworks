import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { ButtonLink } from "@/components/ui/Button";
import { HeaderShell, MobileMenu, NavLink } from "./HeaderClient";

export const PRIMARY_NAV = [
  { href: "/furniture", label: "Furniture" },
  { href: "/our-work", label: "Our Work" },
  { href: "/custom-furniture", label: "Custom Furniture" },
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
];

export function SiteHeader({
  cta,
  contact,
}: {
  cta: { label: string; href: string };
  contact: { email: string | null; phone: string | null };
}) {
  return (
    <HeaderShell>
      <div className="mx-auto flex h-full w-full max-w-[96rem] items-center justify-between gap-6 px-5 sm:px-8 lg:px-12">
        <Link href="/" className="shrink-0 text-charcoal" aria-label="Wild Mountain Woodworks — home">
          <Logo variant="compact" className="h-[2.35rem] w-auto xl:hidden" title="" />
          <Logo variant="horizontal" className="hidden h-[1.8rem] w-auto xl:block 2xl:h-[2.1rem]" title="" />
        </Link>
        <nav aria-label="Main" className="hidden lg:block">
          <ul className="flex items-center gap-7 xl:gap-9">
            {PRIMARY_NAV.map((item) => (
              <li key={item.href}>
                <NavLink href={item.href}>{item.label}</NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex items-center gap-3">
          <span className="hidden sm:block">
            <ButtonLink href={cta.href} variant="primary" className="min-h-11 px-5">
              {cta.label}
            </ButtonLink>
          </span>
          <MobileMenu items={PRIMARY_NAV} cta={cta} contact={contact} />
        </div>
      </div>
    </HeaderShell>
  );
}
