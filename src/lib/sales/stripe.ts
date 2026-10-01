import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe is used only to collect money: Checkout (payment mode) for the
 * deposit at quote acceptance, and Invoices (hosted invoice page + PDF)
 * for final balances and later requests, plus webhooks. Wild Mountain owns
 * quotes, orders and the amounts due; Stripe Quotes and carts are never used.
 *
 * Every write sends an Idempotency-Key derived from the Wild Mountain record,
 * so a retried request can never create a duplicate customer, invoice or
 * invoice item. No card data ever touches this server.
 */

export interface StripeInvoiceLine {
  description: string;
  /** Line total in cents (negative for discounts). */
  amountCents: number;
}

export interface CreatedStripeInvoice {
  id: string;
  status: string;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
}

export interface CheckoutSessionInfo {
  id: string;
  url: string | null;
  /** open | complete | expired */
  status: string;
  /** paid | unpaid | no_payment_required */
  paymentStatus: string;
  expiresAt: Date | null;
  amountTotal: number | null;
}

export interface CreateCheckoutInput {
  /** Same key → same session (Stripe idempotency), so retries/double clicks never create two. */
  idempotencyKey: string;
  amountCents: number;
  productName: string;
  description: string;
  customerEmail: string;
  clientReferenceId: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}

export interface InvoicingProvider {
  readonly name: string;
  ensureCustomer(c: { customerId: string; name: string; email: string; stripeCustomerId: string | null }): Promise<string>;
  createAndFinalizeInvoice(i: {
    invoiceId: string;
    number: string;
    stripeCustomerId: string;
    lines: StripeInvoiceLine[];
    dueDate: Date;
    description?: string | null;
    footer?: string | null;
    /** Changes whenever the draft's content changes, so an edited draft never reuses a stale idempotency key. */
    version: string;
  }): Promise<CreatedStripeInvoice>;
  /** Ask Stripe to email the hosted invoice (email option A). */
  sendInvoice(stripeInvoiceId: string, idempotencyKey: string): Promise<void>;
  voidInvoice(stripeInvoiceId: string, idempotencyKey: string): Promise<void>;
  /** Stripe Checkout, payment mode — one-time payment; the card is never saved. */
  createCheckoutSession(c: CreateCheckoutInput): Promise<CheckoutSessionInfo>;
  retrieveCheckoutSession(id: string): Promise<CheckoutSessionInfo>;
  /** Close an open session so it can't be paid (e.g. paid another way). */
  expireCheckoutSession(id: string): Promise<void>;
}

function toSessionInfo(o: StripeObject): CheckoutSessionInfo {
  return {
    id: String(o.id),
    url: typeof o.url === "string" ? o.url : null,
    status: String(o.status ?? "open"),
    paymentStatus: String(o.payment_status ?? "unpaid"),
    expiresAt: typeof o.expires_at === "number" ? new Date(o.expires_at * 1000) : null,
    amountTotal: typeof o.amount_total === "number" ? o.amount_total : null,
  };
}

/**
 * Form parameters for a deposit Checkout Session. Deliberately never sets
 * setup_future_usage, saved_payment_method_options or a Stripe Customer,
 * so no payment method is saved for later or off-session use. It also never
 * sets payment_method_types: Stripe's dynamic payment methods show whatever
 * is enabled in the Dashboard and eligible for this customer and amount
 * (card, bank, wallets, Affirm, Klarna…).
 */
export function checkoutSessionParams(c: CreateCheckoutInput): Record<string, string> {
  const params: Record<string, string> = {
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(c.amountCents),
    "line_items[0][price_data][product_data][name]": c.productName.slice(0, 250),
    "line_items[0][price_data][product_data][description]": c.description.slice(0, 500),
    customer_email: c.customerEmail,
    client_reference_id: c.clientReferenceId,
    success_url: c.successUrl,
    cancel_url: c.cancelUrl,
    "payment_intent_data[description]": c.description.slice(0, 500),
  };
  for (const [k, v] of Object.entries(c.metadata)) {
    params[`metadata[${k}]`] = v;
    params[`payment_intent_data[metadata][${k}]`] = v;
  }
  return params;
}

type StripeObject = Record<string, unknown> & { id?: string; error?: { message?: string } };

class StripeInvoicingProvider implements InvoicingProvider {
  readonly name = "stripe";
  constructor(private secretKey: string) {}

  private async call(path: string, params: Record<string, string>, idempotencyKey: string): Promise<StripeObject> {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": idempotencyKey,
      },
      body: new URLSearchParams(params),
    });
    const json = (await res.json().catch(() => ({}))) as StripeObject;
    if (!res.ok) throw new Error(`Stripe: ${json.error?.message ?? `HTTP ${res.status}`}`);
    return json;
  }

  async ensureCustomer(c: { customerId: string; name: string; email: string; stripeCustomerId: string | null }) {
    if (c.stripeCustomerId) return c.stripeCustomerId;
    const created = await this.call("customers", { name: c.name, email: c.email, "metadata[wmCustomerId]": c.customerId }, `wm-customer-${c.customerId}`);
    return String(created.id);
  }

  async createAndFinalizeInvoice(i: Parameters<InvoicingProvider["createAndFinalizeInvoice"]>[0]) {
    const invoice = await this.call(
      "invoices",
      {
        customer: i.stripeCustomerId,
        collection_method: "send_invoice",
        due_date: String(Math.floor(i.dueDate.getTime() / 1000)),
        auto_advance: "false",
        pending_invoice_items_behavior: "exclude",
        currency: "usd",
        "metadata[wmInvoiceId]": i.invoiceId,
        "metadata[wmInvoiceNumber]": i.number,
        ...(i.description ? { description: i.description.slice(0, 500) } : {}),
        ...(i.footer ? { footer: i.footer.slice(0, 500) } : {}),
      },
      `wm-invoice-${i.invoiceId}-${i.version}`,
    );
    const stripeId = String(invoice.id);
    for (const [n, line] of i.lines.entries()) {
      await this.call(
        "invoiceitems",
        { customer: i.stripeCustomerId, invoice: stripeId, amount: String(line.amountCents), currency: "usd", description: line.description.slice(0, 500) },
        `wm-invoice-${i.invoiceId}-${i.version}-item-${n}`,
      );
    }
    const finalized = await this.call(`invoices/${stripeId}/finalize`, { auto_advance: "false" }, `wm-invoice-${i.invoiceId}-${i.version}-finalize`);
    return {
      id: stripeId,
      status: String(finalized.status ?? "open"),
      hostedInvoiceUrl: typeof finalized.hosted_invoice_url === "string" ? finalized.hosted_invoice_url : null,
      invoicePdfUrl: typeof finalized.invoice_pdf === "string" ? finalized.invoice_pdf : null,
    };
  }

  async sendInvoice(stripeInvoiceId: string, idempotencyKey: string) {
    await this.call(`invoices/${stripeInvoiceId}/send`, {}, idempotencyKey);
  }

  async voidInvoice(stripeInvoiceId: string, idempotencyKey: string) {
    await this.call(`invoices/${stripeInvoiceId}/void`, {}, idempotencyKey);
  }

  async createCheckoutSession(c: CreateCheckoutInput) {
    return toSessionInfo(await this.call("checkout/sessions", checkoutSessionParams(c), c.idempotencyKey));
  }

  async retrieveCheckoutSession(id: string) {
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${this.secretKey}` } });
    const json = (await res.json().catch(() => ({}))) as StripeObject;
    if (!res.ok) throw new Error(`Stripe: ${json.error?.message ?? `HTTP ${res.status}`}`);
    return toSessionInfo(json);
  }

  async expireCheckoutSession(id: string) {
    await this.call(`checkout/sessions/${encodeURIComponent(id)}/expire`, {}, `wm-checkout-expire-${id}`);
  }
}

let override: InvoicingProvider | null = null;

/** Tests substitute a fake provider; production uses Stripe's REST API. */
export function setInvoicingProviderForTests(provider: InvoicingProvider | null) {
  override = provider;
}

/** The Stripe provider, or null when no secret key is configured. */
export function getInvoicingProvider(): InvoicingProvider | null {
  if (override) return override;
  const key = process.env.STRIPE_SECRET_KEY;
  return key ? new StripeInvoicingProvider(key) : null;
}

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

/**
 * Verify a Stripe webhook signature (Stripe-Signature header, v1 scheme,
 * timing-safe compare, 5-minute tolerance). Returns the parsed event or throws.
 */
export function verifyStripeWebhook<T = StripeEvent>(payload: string, signatureHeader: string | null, secret: string, toleranceSeconds = 300, now = Date.now()): T {
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

/**
 * Publishable key for Stripe's read-only Payment Method Messaging Element
 * (Affirm/Klarna eligibility shown on quote and order pages). Publishable
 * keys are public by design; optional — without it customers see our
 * term-free wording only.
 */
export function stripePublishableKey(): string | null {
  const key = process.env.STRIPE_PUBLISHABLE_KEY?.trim();
  return key && /^pk_(live|test)_[A-Za-z0-9]+$/.test(key) ? key : null;
}
