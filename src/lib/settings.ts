import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";
import type { SiteSetting } from "@/generated/prisma/client";

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
 * Sales feature flags. Wild Mountain Woodworks sells through quotes → invoices; there is
 * no cart or checkout.
 *
 * Stripe invoicing is only effective when the Settings flag is on AND the
 * Stripe secret key and webhook secret are configured, so flipping the switch
 * early can never send a customer to a broken payment page. Manual payments
 * (cash, check, bank transfer) always work, with or without Stripe.
 */
export function salesFlags(settings: Pick<SiteSetting, "stripeInvoicingEnabled" | "quotesEnabled" | "customOrdersEnabled" | "taxEnabled">) {
  const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
  return {
    quotes: settings.quotesEnabled,
    customOrders: settings.customOrdersEnabled,
    stripeInvoicing: settings.stripeInvoicingEnabled && stripeConfigured,
    /** Online card payment: Checkout for deposits at acceptance, Invoices for balances (same switch + keys). */
    onlinePayments: settings.stripeInvoicingEnabled && stripeConfigured,
    stripeInvoicingFlag: settings.stripeInvoicingEnabled,
    stripeConfigured,
    tax: settings.taxEnabled,
  };
}
