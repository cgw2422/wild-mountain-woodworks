import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { generateReference } from "@/lib/references";
import { commerceState, getSettings } from "@/lib/settings";
import { siteUrl } from "@/lib/site-url";
import { priceCart, type CartLine } from "./cart";
import { StripeCheckoutProvider } from "./payments/stripe";
import type { PaymentProvider } from "./payments/types";

export class CommerceDisabledError extends Error {
  constructor() {
    super("Online purchasing is not enabled.");
  }
}

export function getPaymentProvider(): PaymentProvider | null {
  const key = process.env.STRIPE_SECRET_KEY;
  return key ? new StripeCheckoutProvider(key) : null;
}

/**
 * Future flow: cart → customer info → Stripe Checkout. Creates a
 * PENDING_PAYMENT order with immutable configuration snapshots, then hands off
 * to Stripe-hosted Checkout. The order becomes PAID only via the verified
 * webhook (src/app/api/stripe/webhook/route.ts).
 *
 * Not reachable from the UI while ecommerceEnabled = false.
 */
export async function startCheckout(input: { lines: CartLine[]; customer: { name: string; email: string; phone?: string | null } }) {
  const settings = await getSettings();
  const provider = getPaymentProvider();
  if (!commerceState(settings).ecommerce || !provider) throw new CommerceDisabledError();

  const cart = await priceCart(input.lines);
  // Taxes and delivery are calculated here when implemented (e.g. Stripe Tax
  // / delivery zones). Kept at zero until the business defines them.
  const taxCents = 0;
  const shippingCents = 0;

  const order = await prisma.order.create({
    data: {
      number: generateReference("O"),
      customerName: input.customer.name,
      customerEmail: input.customer.email,
      customerPhone: input.customer.phone ?? null,
      subtotalCents: cart.subtotalCents,
      taxCents,
      shippingCents,
      totalCents: cart.subtotalCents + taxCents + shippingCents,
      items: {
        create: cart.lines.map((l) => ({
          productId: l.line.productId,
          productName: l.snapshot.product.name,
          sku: l.snapshot.product.sku,
          configuration: l.snapshot as unknown as Prisma.InputJsonValue,
          unitPriceCents: l.unitPriceCents,
          quantity: l.line.quantity,
          lineTotalCents: l.lineTotalCents,
        })),
      },
      statusEvents: { create: { toStatus: "PENDING_PAYMENT" } },
    },
  });

  const session = await provider.createCheckoutSession({
    orderId: order.id,
    orderNumber: order.number,
    customerEmail: order.customerEmail,
    lineItems: cart.lines.map((l) => ({
      name: l.snapshot.product.name,
      description: l.snapshot.options.map((o) => `${o.groupDisplayName}: ${o.valueDisplayName}`).join(" · "),
      unitAmountCents: l.unitPriceCents,
      quantity: l.line.quantity,
    })),
    successUrl: siteUrl(`/order/confirmed?order=${order.number}`),
    cancelUrl: siteUrl("/cart"),
  });
  await prisma.order.update({ where: { id: order.id }, data: { stripeCheckoutSessionId: session.id } });
  await logActivity("order.created", `Order ${order.number} started checkout`, { entityType: "order", entityId: order.id });
  return { orderId: order.id, checkoutUrl: session.url };
}
