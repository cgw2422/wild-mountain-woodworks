import type { CheckoutSessionInfo, CreateCheckoutInput, InvoicingProvider } from "@/lib/sales/stripe";

/**
 * In-memory stand-in for Stripe (invoices + Checkout Sessions). Sessions are
 * keyed by idempotency key like the real API, so a repeated create returns
 * the same session. Tests drive state with `complete`, `expire` and `events`.
 */
export function fakeStripe(overrides: Partial<InvoicingProvider> = {}) {
  const calls: string[] = [];
  const sessions = new Map<string, CheckoutSessionInfo & { input: CreateCheckoutInput }>();
  const byKey = new Map<string, string>();
  let invoiceSeq = 0;
  let sessionSeq = 0;

  const provider: InvoicingProvider = {
    name: "fake",
    ensureCustomer: async (c) => (calls.push(`customer:${c.customerId}`), "cus_123"),
    createAndFinalizeInvoice: async (i) => {
      calls.push(`invoice:${i.number}:${i.lines.map((l) => l.amountCents).join(",")}`);
      const id = `in_${++invoiceSeq}`;
      return { id, status: "open", hostedInvoiceUrl: `https://invoice.stripe.com/i/${id}`, invoicePdfUrl: `https://pay.stripe.com/invoice/${id}/pdf` };
    },
    sendInvoice: async (id) => void calls.push(`send:${id}`),
    voidInvoice: async (id) => void calls.push(`void:${id}`),
    createCheckoutSession: async (input) => {
      const existing = byKey.get(input.idempotencyKey);
      if (existing) return sessions.get(existing)!;
      const id = `cs_test_${++sessionSeq}`;
      calls.push(`checkout:${input.amountCents}`);
      const s = { id, url: `https://checkout.stripe.com/c/pay/${id}`, status: "open", paymentStatus: "unpaid", expiresAt: new Date(Date.now() + 86_400_000), amountTotal: input.amountCents, input };
      sessions.set(id, s);
      byKey.set(input.idempotencyKey, id);
      return s;
    },
    retrieveCheckoutSession: async (id) => {
      const s = sessions.get(id);
      if (!s) throw new Error(`No such checkout.session: ${id}`);
      return s;
    },
    expireCheckoutSession: async (id) => {
      const s = sessions.get(id);
      if (!s) throw new Error(`No such checkout.session: ${id}`);
      if (s.status !== "open") throw new Error("Only open sessions can be expired.");
      calls.push(`expire:${id}`);
      s.status = "expired";
    },
    ...overrides,
  };

  /** The Stripe event a finished/expired session would send to the webhook. */
  function event(eventId: string, type: string, id: string) {
    const s = sessions.get(id)!;
    return {
      id: eventId,
      type,
      data: {
        object: {
          id: s.id,
          object: "checkout.session",
          status: s.status,
          payment_status: s.paymentStatus,
          amount_total: s.amountTotal,
          client_reference_id: s.input.clientReferenceId,
          metadata: s.input.metadata,
          payment_intent: s.paymentStatus === "paid" ? `pi_${s.id}` : null,
          created: Math.floor(Date.now() / 1000),
        },
      },
    };
  }

  return {
    provider,
    calls,
    sessions,
    /** The customer finished paying on Stripe's page (not yet confirmed to us). */
    complete(id: string, paymentStatus: "paid" | "unpaid" = "paid") {
      const s = sessions.get(id)!;
      s.status = "complete";
      s.paymentStatus = paymentStatus;
      return s;
    },
    /** Stripe expired the session (24h passed). */
    expire(id: string) {
      sessions.get(id)!.status = "expired";
    },
    event,
    latest() {
      return [...sessions.values()].at(-1)!;
    },
  };
}
