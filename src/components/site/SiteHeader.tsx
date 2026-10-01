import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { ButtonLink } from "@/components/ui/Button";
import type { NavLink as NavLinkData } from "@/lib/navigation/menus";
import { HeaderShell, MainNav, MobileMenu } from "./HeaderClient";

/** The header's links come from the MAIN menu (Admin → Navigation). */
export function SiteHeader({
  items,
  cta,
  contact,
}: {
  items: NavLinkData[];
  /** Null when neither the quote page nor the contact page is published. */
  cta: { label: string; href: string } | null;
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
          <MainNav items={items} />
        </nav>
        <div className="flex items-center gap-3">
          {cta ? (
            <span className="hidden sm:block">
              <ButtonLink href={cta.href} variant="primary" className="min-h-11 px-5">
                {cta.label}
              </ButtonLink>
            </span>
          ) : null}
          <MobileMenu items={items} cta={cta} contact={contact} />
        </div>
      </div>
    </HeaderShell>
  );
}
