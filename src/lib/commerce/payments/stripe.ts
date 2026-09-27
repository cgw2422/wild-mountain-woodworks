import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { CreateCheckoutParams, PaymentProvider } from "./types";

/**
 * Stripe-hosted Checkout, via Stripe's REST API.
 *
 * - mode=payment, guest checkout (no Stripe Customer is created)
 * - `setup_future_usage` is intentionally NEVER set, so cards are not saved
 * - amounts come exclusively from server-side pricing
 */
export class StripeCheckoutProvider implements PaymentProvider {
  readonly name = "stripe";
  constructor(private secretKey: string) {}

  async createCheckoutSession(p: CreateCheckoutParams) {
    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("success_url", p.successUrl);
    form.set("cancel_url", p.cancelUrl);
    form.set("customer_email", p.customerEmail);
    form.set("client_reference_id", p.orderId);
    form.set("metadata[orderId]", p.orderId);
    form.set("metadata[orderNumber]", p.orderNumber);
    form.set("payment_intent_data[metadata][orderId]", p.orderId);
    form.set("billing_address_collection", "required");
    form.set("shipping_address_collection[allowed_countries][0]", "US");
    p.lineItems.forEach((item, i) => {
      form.set(`line_items[${i}][quantity]`, String(item.quantity));
      form.set(`line_items[${i}][price_data][currency]`, "usd");
      form.set(`line_items[${i}][price_data][unit_amount]`, String(item.unitAmountCents));
      form.set(`line_items[${i}][price_data][product_data][name]`, item.name);
      if (item.description) form.set(`line_items[${i}][price_data][product_data][description]`, item.description.slice(0, 500));
    });
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.secretKey}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": `order-${p.orderId}` },
      body: form,
    });
    const json = (await res.json()) as { id?: string; url?: string; error?: { message: string } };
    if (!res.ok || !json.id || !json.url) throw new Error(`Stripe error: ${json.error?.message ?? res.status}`);
    return { id: json.id, url: json.url };
  }
}

/**
 * Verify a Stripe webhook signature (Stripe-Signature header, v1 scheme).
 * Returns the parsed event or throws.
 */
export function verifyStripeWebhook<T = { type: string; data: { object: Record<string, unknown> } }>(
  payload: string,
  signatureHeader: string | null,
  secret: string,
  toleranceSeconds = 300,
  now = Date.now(),
): T {
  if (!signatureHeader) throw new Error("Missing Stripe-Signature header");
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((kv) => {
      const [k, ...rest] = kv.split("=");
      return [k!.trim(), rest.join("=")];
    }),
  ) as Record<string, string>;
  const timestamp = Number(parts.t);
  const signatures = signatureHeader
    .split(",")
    .filter((kv) => kv.trim().startsWith("v1="))
    .map((kv) => kv.trim().slice(3));
  if (!timestamp || signatures.length === 0) throw new Error("Malformed Stripe-Signature header");
  if (Math.abs(now / 1000 - timestamp) > toleranceSeconds) throw new Error("Stripe webhook timestamp outside tolerance");
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const ok = signatures.some((sig) => {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  });
  if (!ok) throw new Error("Invalid Stripe webhook signature");
  return JSON.parse(payload) as T;
}
