import { terminalPaymentIntentParams, type CheckoutSessionInfo, type CreateCheckoutInput, type InvoicingProvider, type PaymentIntentInfo, type TerminalReaderInfo } from "@/lib/sales/stripe";

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
  let intentSeq = 0;
  const intents = new Map<string, PaymentIntentInfo & { params: Record<string, string>; key: string }>();
  const intentByKey = new Map<string, string>();
  const readers = new Map<string, TerminalReaderInfo>([
    ["tmr_shop", { id: "tmr_shop", label: "Shop counter", status: "online", deviceType: "stripe_s700", serialNumber: "S700-1", locationId: "tml_1", action: null }],
    ["tmr_truck", { id: "tmr_truck", label: "Delivery truck", status: "offline", deviceType: "bbpos_wisepos_e", serialNumber: "WPE-2", locationId: "tml_1", action: null }],
  ]);

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
    listTerminalReaders: async () => [...readers.values()],
    retrieveTerminalReader: async (id) => {
      const r = readers.get(id);
      if (!r) throw new Error(`No such reader: ${id}`);
      return r;
    },
    createTerminalPaymentIntent: async (c) => {
      const existing = intentByKey.get(c.idempotencyKey);
      if (existing) return intents.get(existing)!;
      const id = `pi_term_${++intentSeq}`;
      const params = terminalPaymentIntentParams(c);
      calls.push(`terminal_intent:${c.amountCents}`);
      const pi = { id, status: "requires_payment_method", amount: c.amountCents, failureMessage: null, latestChargeId: null, paymentMethodType: null, params, key: c.idempotencyKey };
      intents.set(id, pi);
      intentByKey.set(c.idempotencyKey, id);
      return pi;
    },
    processOnReader: async (readerId, paymentIntentId) => {
      const r = readers.get(readerId);
      if (!r) throw new Error(`No such reader: ${readerId}`);
      if (r.status === "offline") throw new Error("Reader is offline");
      calls.push(`process:${readerId}:${paymentIntentId}`);
      r.action = { type: "process_payment_intent", status: "in_progress", failureMessage: null, paymentIntentId };
      return r;
    },
    cancelReaderAction: async (readerId) => {
      calls.push(`reader_cancel:${readerId}`);
      const r = readers.get(readerId);
      if (r) r.action = null;
    },
    retrievePaymentIntent: async (id) => {
      const pi = intents.get(id);
      if (!pi) throw new Error(`No such payment_intent: ${id}`);
      return pi;
    },
    cancelPaymentIntent: async (id) => {
      const pi = intents.get(id);
      if (pi && pi.status !== "succeeded") pi.status = "canceled";
      calls.push(`pi_cancel:${id}`);
    },
    simulateReaderPayment: async (readerId) => {
      const r = readers.get(readerId);
      const pi = r?.action?.paymentIntentId ? intents.get(r.action.paymentIntentId) : null;
      if (pi) {
        pi.status = "succeeded";
        pi.latestChargeId = `ch_${pi.id}`;
        r!.action = { ...r!.action!, status: "succeeded" };
      }
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

  /** The webhook Stripe sends for a Terminal PaymentIntent. */
  function intentEvent(eventId: string, type: "payment_intent.succeeded" | "payment_intent.payment_failed" | "payment_intent.canceled", id: string) {
    const pi = intents.get(id)!;
    return { id: eventId, type, data: { object: { id: pi.id, object: "payment_intent", status: pi.status, amount: pi.amount, amount_received: pi.status === "succeeded" ? pi.amount : 0, latest_charge: pi.latestChargeId, last_payment_error: pi.failureMessage ? { message: pi.failureMessage } : null } } };
  }

  return {
    provider,
    calls,
    sessions,
    intents,
    readers,
    intentEvent,
    /** The card was approved on the reader. */
    succeedIntent(id: string) {
      const pi = intents.get(id)!;
      pi.status = "succeeded";
      pi.latestChargeId = `ch_${id}`;
      return pi;
    },
    /** The card was declined on the reader. */
    declineIntent(id: string, message = "Your card was declined.") {
      const pi = intents.get(id)!;
      pi.failureMessage = message;
      return pi;
    },
    /** The customer finished paying on Stripe's page (not yet confirmed to us), with the method they chose. */
    complete(id: string, paymentStatus: "paid" | "unpaid" = "paid", paymentMethodType = "card") {
      const s = sessions.get(id)!;
      s.status = "complete";
      s.paymentStatus = paymentStatus;
      // The session's PaymentIntent, as Stripe would report it (with the method used).
      intents.set(`pi_${id}`, { id: `pi_${id}`, status: paymentStatus === "paid" ? "succeeded" : "processing", amount: s.amountTotal ?? 0, failureMessage: null, latestChargeId: `ch_${id}`, paymentMethodType, params: {}, key: `checkout-${id}` });
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
