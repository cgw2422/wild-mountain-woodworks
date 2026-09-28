import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";
import type { SiteSetting } from "@/generated/prisma/client";
import { CHECKOUT_UI_READY } from "@/lib/commerce/config";

export type SiteSettings = SiteSetting & {
  defaultOgImage: { url: string; width: number; height: number; alt: string } | null;
};

/** Site settings + feature flags (single row). Memoized per request. */
export const getSettings = cache(async (): Promise<SiteSettings> => {
  const existing = await prisma.siteSetting.findUnique({
    where: { id: "default" },
    include: { defaultOgImage: { select: { url: true, width: true, height: true, alt: true } } },
  });
  if (existing) return existing;
  return prisma.siteSetting.create({
    data: { id: "default" },
    include: { defaultOgImage: { select: { url: true, width: true, height: true, alt: true } } },
  });
});

/**
 * Commerce feature flags. E-commerce is only effective when the flag is on
 * AND Stripe is configured AND the checkout UI has shipped
 * (src/lib/commerce/config.ts), so flipping the flag can never expose a
 * broken or unfinished checkout.
 */
export function commerceState(settings: Pick<SiteSetting, "ecommerceEnabled" | "quotesEnabled" | "customOrdersEnabled">) {
  const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY && process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
  return {
    ecommerce: settings.ecommerceEnabled && stripeConfigured && CHECKOUT_UI_READY,
    checkoutUiReady: CHECKOUT_UI_READY,
    ecommerceFlag: settings.ecommerceEnabled,
    stripeConfigured,
    quotes: settings.quotesEnabled,
    customOrders: settings.customOrdersEnabled,
  };
}
