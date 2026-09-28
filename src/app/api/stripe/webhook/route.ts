import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { logActivity } from "@/lib/activity";
import { verifyStripeWebhook } from "@/lib/commerce/payments/stripe";
import { sendOrderConfirmation } from "@/lib/email/notifications";

export const dynamic = "force-dynamic";

/**
 * Stripe webhook (future). Inert until STRIPE_WEBHOOK_SECRET is configured.
 * Orders only become PAID here, after Stripe's signature is verified — never
 * from a browser redirect.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response("Not found", { status: 404 });

  const payload = await request.text();
  let event: { id?: string; type: string; data: { object: Record<string, unknown> } };
  try {
    event = verifyStripeWebhook(payload, request.headers.get("stripe-signature"), secret);
  } catch (error) {
    logger.warn("Rejected Stripe webhook", { error });
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object as { id: string; payment_status?: string; payment_intent?: string | null; metadata?: { orderId?: string } };
      if (session.payment_status !== "paid") return Response.json({ received: true });
      const order = await prisma.order.findFirst({
        where: { OR: [{ stripeCheckoutSessionId: session.id }, ...(session.metadata?.orderId ? [{ id: session.metadata.orderId }] : [])] },
      });
      if (order && order.paymentStatus !== "PAID") {
        await prisma.order.update({
          where: { id: order.id },
          data: {
            status: "PAID",
            paymentStatus: "PAID",
            paidAt: new Date(),
            stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
            statusEvents: { create: { fromStatus: order.status, toStatus: "PAID" } },
          },
        });
        await logActivity("order.created", `Order ${order.number} paid`, { entityType: "order", entityId: order.id });
        void sendOrderConfirmation(order).catch((error) => logger.error("Order confirmation email failed", { error }));
      }
    }
    return Response.json({ received: true });
  } catch (error) {
    logger.error("Stripe webhook handling failed", { error, type: event.type });
    return new Response("Webhook handler error", { status: 500 });
  }
}
