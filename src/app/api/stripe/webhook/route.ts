import { logger } from "@/lib/logger";
import { processStripeEvent } from "@/lib/sales/payments";
import { verifyStripeWebhook } from "@/lib/sales/stripe";

export const dynamic = "force-dynamic";

/**
 * Stripe invoicing webhook. Inert (404) until STRIPE_WEBHOOK_SECRET is set.
 * The signature is verified before anything is read; invoices and payments
 * are only ever marked paid here — never from a browser redirect. Events are
 * idempotent (see processStripeEvent), so Stripe's retries are safe.
 *
 * Subscribe to: invoice.finalized, invoice.sent, invoice.updated,
 * invoice.paid, invoice.payment_succeeded, invoice.payment_failed,
 * invoice.voided, invoice.marked_uncollectible, charge.refunded.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response("Not found", { status: 404 });

  const payload = await request.text();
  if (payload.length > 1_000_000) return new Response("Payload too large", { status: 413 });
  let event: { id: string; type: string; data: { object: Record<string, unknown> } };
  try {
    event = verifyStripeWebhook(payload, request.headers.get("stripe-signature"), secret);
  } catch (error) {
    logger.warn("Rejected Stripe webhook", { error });
    return new Response("Invalid signature", { status: 400 });
  }
  if (typeof event.id !== "string" || typeof event.type !== "string" || !event.data?.object) {
    return new Response("Malformed event", { status: 400 });
  }

  try {
    const result = await processStripeEvent(event);
    return Response.json({ received: true, result });
  } catch (error) {
    // 500 → Stripe retries later; nothing was recorded for this event.
    logger.error("Stripe webhook handling failed", { error, type: event.type });
    return new Response("Webhook handler error", { status: 500 });
  }
}
