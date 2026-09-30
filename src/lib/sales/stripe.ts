import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe is used ONLY for invoicing: customers, invoices, hosted invoice
 * pages/payment links, invoice PDFs and webhooks. Wild Mountain owns quotes;
 * Stripe Quotes, Checkout and carts are never used.
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
