import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RevisionInput } from "@/lib/sales/quotes";

vi.mock("next/headers", async () => (await import("../support/next-request")).nextHeaders);
vi.mock("next/navigation", async () => (await import("../support/next-request")).nextNavigation);
vi.mock("next/cache", async () => (await import("../support/next-request")).nextCache);

const { prisma } = await import("@/lib/db");
const { createSignedInAdmin, resetRequest, jar } = await import("../support/next-request");
const { createConfigurationQuote } = await import("@/lib/services/submissions");
const quotes = await import("@/lib/sales/quotes");
const payments = await import("@/lib/sales/payments");
const checkout = await import("@/lib/sales/checkout");
const { customerOrderView, loadCustomerQuote } = await import("@/lib/sales/views");
const { checkoutSessionParams, setInvoicingProviderForTests } = await import("@/lib/sales/stripe");
const { acceptQuoteAction } = await import("@/app/(documents)/quote/[token]/actions");
const payRoute = await import("@/app/(documents)/order/[token]/pay/route");
const webhook = await import("@/app/api/stripe/webhook/route");
const sales = await import("@/app/admin/(panel)/sales-actions");
const { hasTestDb, resetDb, seedRidge } = await import("../support/db");
const { fakeStripe } = await import("../support/fake-stripe");

const meta = { ip: "198.51.100.7", userAgent: "Mozilla/5.0 test" };
const acceptance = { revisionNumber: 1, name: "Jamie Rivers", agreeTerms: true, agreeDeposit: true };
let actor: { id: string; name: string };
let stripe: ReturnType<typeof fakeStripe>;
let seeded: Awaited<ReturnType<typeof seedRidge>> | null = null;

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** A sent quote: one $1,000 piece + $150 delivery = $1,150, deposit as given (default 50% = $575). */
async function sentQuote(deposit: Partial<RevisionInput> = {}) {
  seeded ??= await seedRidge();
  const { product, ids } = seeded;
  const quote = await createConfigurationQuote({
    name: "Jamie Rivers",
    email: "jamie@example.com",
    phone: null,
    zipCode: "43215",
    timeline: null,
    notes: null,
    address: "12 Oak St, Columbus OH",
    productId: product.id,
    selection: { options: { [ids.size]: ids.s60, [ids.wood]: ids.pine }, addOns: {}, customDetails: {} },
  });
  const rev = (await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quote.id }, include: { currentRevision: true } })).currentRevision!;
  await quotes.saveRevision(actor, quote.id, {
    customerName: rev.customerName,
    customerEmail: rev.customerEmail,
    customerPhone: rev.customerPhone,
    customerAddress: rev.customerAddress,
    customerNotes: null,
    terms: "Deposit due to begin.",
    expiresAt: null,
    leadTime: "8–10 weeks",
    estimatedCompletion: "Early March",
    deliveryDetails: null,
    depositType: "PERCENTAGE",
    depositPercentBps: 5000,
    depositAmountCents: null,
    taxCents: 0,
    lines: [
      { sourceId: null, kind: "PRODUCT", description: "The Ridge Dining Table", notes: null, quantity: 1, unitPriceCents: 100000, taxable: false, productId: null },
      { sourceId: null, kind: "DELIVERY", description: "Delivery & setup", notes: null, quantity: 1, unitPriceCents: 15000, taxable: false, productId: null },
    ],
    ...deposit,
  });
  await quotes.sendQuote(actor, quote.id);
  return quote;
}

async function acceptOnline(deposit: Partial<RevisionInput> = {}) {
  const quote = await sentQuote(deposit);
  const r = await quotes.acceptQuote(quote.customerToken!, acceptance, meta);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: r.order.id } });
  return { quote, order, payNow: r.payNow };
}

const pay = (token: string, query = "") => payRoute.GET(new Request(`http://localhost/order/${token}/pay${query}`), { params: Promise.resolve({ token }) });
/** The order's one invoice (the deposit is paid against it). */
const depositOf = (orderId: string) => prisma.invoice.findFirstOrThrow({ where: { orderId } });

function signed(event: unknown) {
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", "whsec_x").update(`${t}.${body}`).digest("hex");
  return webhook.POST(new Request("http://localhost/api/stripe/webhook", { method: "POST", body, headers: { "stripe-signature": `t=${t},v1=${sig}` } }));
}

describe("Checkout Session parameters", () => {
  it("is a one-time payment that never saves or reuses a card", () => {
    const params = checkoutSessionParams({
      idempotencyKey: "k",
      amountCents: 57500,
      productName: "Deposit — order WMO-1001",
      description: "Deposit",
      customerEmail: "jamie@example.com",
      clientReferenceId: "inv_1",
      successUrl: "https://x/s",
      cancelUrl: "https://x/c",
      metadata: { payment_type: "deposit", order_number: "WMO-1001" },
    });
    expect(params).toMatchObject({
      mode: "payment",
      "line_items[0][price_data][unit_amount]": "57500",
      customer_email: "jamie@example.com",
      client_reference_id: "inv_1",
      "metadata[payment_type]": "deposit",
      "payment_intent_data[metadata][order_number]": "WMO-1001",
    });
    const keys = Object.keys(params).join(" ");
    expect(keys).not.toMatch(/setup_future_usage|saved_payment_method|payment_method_save|off_session|^customer$|\bcustomer\b(?!_email)|customer_creation|consent_collection/);
    expect(params).not.toHaveProperty("customer");
  });
});

describe("quote response wording", () => {
  it("offers 'Accept Quote & Pay $X Deposit' with the totals, and plain 'Accept Quote' otherwise", () => {
    const src = readFileSync(path.resolve("src/components/documents/QuoteResponse.tsx"), "utf8");
    expect(src).toContain("`Accept Quote & Pay ${formatCents(depositCents)} Deposit`");
    expect(src).toMatch(/Quote total[\s\S]*Deposit due today[\s\S]*Remaining balance/);
    expect(src).toContain('"Accept Quote"');
  });
});

describe.skipIf(!hasTestDb)("accept quote & pay deposit (Stripe Checkout)", () => {
  beforeEach(async () => {
    await resetDb();
    resetRequest();
    seeded = null;
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_x");
    await prisma.siteSetting.create({ data: { id: "default", stripeInvoicingEnabled: true, paymentInstructions: "Checks payable to Wild Mountain." } });
    const a = await prisma.adminUser.create({ data: { email: "owner@example.com", name: "Owner", role: "OWNER" } });
    actor = { id: a.id, name: a.name };
    stripe = fakeStripe();
    setInvoicingProviderForTests(stripe.provider);
  });
  afterEach(() => {
    setInvoicingProviderForTests(null);
    vi.unstubAllEnvs();
  });

  it("shows the deposit summary and accept-and-pay wording on the quote", async () => {
    const quote = await sentQuote();
    const { view } = (await loadCustomerQuote(quote.customerToken!))!;
    expect(view.onlinePayments).toBe(true);
    expect(view.revision).toMatchObject({ totals: { totalCents: 115000 }, depositCents: 57500, balanceCents: 57500 });
  });

  it("accepting with a deposit creates the order and sends the customer on to Checkout for exactly the deposit", async () => {
    const quote = await sentQuote();
    jar.clear(); // anonymous customer
    // A browser-sent price/amount is ignored entirely.
    const res = await acceptQuoteAction(quote.customerToken!, form({ revision: "1", name: "Jamie Rivers", agreeTerms: "on", agreeDeposit: "on", amount: "1", depositCents: "1", totalCents: "1" }));
    const order = await prisma.order.findFirstOrThrow();
    expect(res).toEqual({ status: "success", reference: "WMO-1001", redirect: `/order/${order.customerToken}/pay` });
    expect(order).toMatchObject({ totalCents: 115000, depositCents: 57500, productionStatus: "AWAITING_DEPOSIT", paymentStatus: "DEPOSIT_DUE" });
    expect((await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe("ACCEPTED");
    const deposit = await depositOf(order.id);
    expect(deposit).toMatchObject({ kind: "FULL", status: "DEPOSIT_DUE", totalCents: 115000, depositCents: 57500, stripeInvoiceId: null });
    expect(await prisma.invoice.count()).toBe(1);
    // Paying now: no "quote accepted" email before payment.
    expect(await prisma.emailLog.count({ where: { template: "quote_accepted" } })).toBe(0);

    // The pay link opens a Checkout Session; a query-string amount is ignored too.
    const r = await pay(order.customerToken!, "?amount=1");
    expect(r.status).toBe(303);
    const session = stripe.latest();
    expect(r.headers.get("location")).toBe(session.url);
    expect(session.input).toMatchObject({
      amountCents: 57500,
      customerEmail: "jamie@example.com",
      clientReferenceId: deposit.id,
      successUrl: expect.stringContaining(`/order/${order.customerToken}/payment-success?session_id={CHECKOUT_SESSION_ID}`),
      cancelUrl: expect.stringContaining(`/order/${order.customerToken}?payment=canceled`),
      metadata: {
        payment_type: "DEPOSIT",
        expected_amount: "57500",
        invoice_id: deposit.id,
        invoice_number: deposit.number,
        order_id: order.id,
        order_number: "WMO-1001",
        quote_id: quote.id,
        quote_number: "WMQ-1001",
        quote_revision: "1",
        customer_id: order.customerId,
      },
    });
    expect(await depositOf(order.id)).toMatchObject({ stripeCheckoutSessionId: session.id, stripeCheckoutStatus: "open", checkoutAttempts: 1 });
    expect(stripe.calls.filter((c) => c.startsWith("invoice:"))).toEqual([]); // the deposit is never a Stripe Invoice
  });

  it("no deposit: plain acceptance straight to the order page, no Stripe", async () => {
    const quote = await sentQuote({ depositType: "NONE" });
    jar.clear();
    const view = (await loadCustomerQuote(quote.customerToken!))!.view;
    expect(view.revision!.depositCents).toBe(0);
    const res = await acceptQuoteAction(quote.customerToken!, form({ revision: "1", name: "Jamie Rivers", agreeTerms: "on", agreeDeposit: "on" }));
    const order = await prisma.order.findFirstOrThrow();
    expect(res).toMatchObject({ status: "success", redirect: `/order/${order.customerToken}` });
    expect(await prisma.invoice.findFirstOrThrow()).toMatchObject({ kind: "FULL", status: "OPEN", depositCents: 0 }); // one invoice, nothing due yet
    expect((await pay(order.customerToken!)).headers.get("location")).toBe(`/order/${order.customerToken}`);
    expect(stripe.calls).toEqual([]);
    expect(await prisma.emailLog.count({ where: { template: "quote_accepted" } })).toBe(1);
  });

  it("the redirect back alone never marks the deposit paid; failed and unpaid sessions don't either", async () => {
    const { order } = await acceptOnline();
    await pay(order.customerToken!);
    const s = stripe.latest();
    // Customer lands on the success page without having paid.
    await checkout.noteCheckoutReturn(order.customerToken!, s.id);
    expect((await customerOrderView(order.customerToken!))!.deposit).toMatchObject({ paid: false, confirming: false });
    // A forged session id is ignored.
    await checkout.noteCheckoutReturn(order.customerToken!, "cs_test_forged");
    expect(await prisma.payment.count()).toBe(0);

    // Completed but the bank payment is still clearing: processing, not paid.
    stripe.complete(s.id, "unpaid");
    await checkout.noteCheckoutReturn(order.customerToken!, s.id);
    expect((await customerOrderView(order.customerToken!))!.deposit).toMatchObject({ paid: false, confirming: true });
    expect(await payments.processStripeEvent(stripe.event("evt_c1", "checkout.session.completed", s.id))).toBe("processed");
    expect(await prisma.payment.count()).toBe(0);
    // ...then it fails.
    expect(await payments.processStripeEvent(stripe.event("evt_c2", "checkout.session.async_payment_failed", s.id))).toBe("processed");
    expect(await prisma.payment.count()).toBe(0);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ productionStatus: "AWAITING_DEPOSIT", paymentStatus: "DEPOSIT_DUE" });
    expect(await depositOf(order.id)).toMatchObject({ stripeCheckoutStatus: "failed", amountPaidCents: 0 });
  });

  it("a verified webhook marks the deposit paid, stores Stripe ids, advances production and emails once; duplicates change nothing", async () => {
    const { quote, order } = await acceptOnline();
    await pay(order.customerToken!);
    const s = stripe.complete(stripe.latest().id);
    // Unsigned/forged events are rejected before anything is read.
    const forged = await webhook.POST(new Request("http://localhost/api/stripe/webhook", { method: "POST", body: JSON.stringify(stripe.event("evt_x", "checkout.session.completed", s.id)), headers: { "stripe-signature": `t=1,v1=${"0".repeat(64)}` } }));
    expect(forged.status).toBe(400);
    expect(await prisma.payment.count()).toBe(0);

    const first = await signed(stripe.event("evt_paid", "checkout.session.completed", s.id));
    expect(await first.json()).toMatchObject({ result: "processed" });
    const payment = await prisma.payment.findFirstOrThrow();
    expect(payment).toMatchObject({ source: "STRIPE", method: "STRIPE_ONLINE", type: "DEPOSIT", status: "SUCCEEDED", amountCents: 57500, stripeCheckoutSessionId: s.id, stripePaymentIntentId: `pi_${s.id}` });
    expect(await depositOf(order.id)).toMatchObject({ status: "PARTIALLY_PAID", amountPaidCents: 57500, stripeCheckoutStatus: "complete" });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ productionStatus: "ORDER_CONFIRMED", paymentStatus: "PARTIALLY_PAID" });

    // Confirmation email, sent after payment, with the requested wording.
    const mail = await prisma.emailLog.findFirstOrThrow({ where: { template: "deposit_received" } });
    expect(mail.html).toContain(`received your acceptance of quote ${quote.number} and your $575 deposit`);
    expect(mail.html).toContain("Your order number is WMO-1001");
    expect(mail.html).toMatch(/next stage of production/);
    expect(mail.html).toMatch(/View Your Order/);
    expect(mail.html).not.toMatch(/send (you )?an invoice/i);

    // Same event again, and the sibling event for the same money: no second payment or email.
    expect(await (await signed(stripe.event("evt_paid", "checkout.session.completed", s.id))).json()).toMatchObject({ result: "duplicate" });
    expect(await payments.processStripeEvent(stripe.event("evt_paid_2", "checkout.session.async_payment_succeeded", s.id))).toBe("processed");
    expect(await prisma.payment.count()).toBe(1);
    expect(await prisma.emailLog.count({ where: { template: "deposit_received" } })).toBe(1);

    // The success page now shows the paid state.
    expect((await customerOrderView(order.customerToken!))!).toMatchObject({ deposit: { paid: true }, balanceCents: 57500, productionStatus: "ORDER_CONFIRMED" });
  });

  it("abandoned checkout: order keeps waiting, the customer can retry, and an expired session is replaced automatically", async () => {
    const { quote, order } = await acceptOnline();
    const token = order.customerToken!;
    await pay(token);
    const first = stripe.latest();
    // Clicking Pay again while the session is open reuses it (no duplicate payment pages).
    expect((await pay(token)).headers.get("location")).toBe(first.url);
    expect(stripe.sessions.size).toBe(1);

    // Customer walks away; Stripe expires the session and tells us.
    stripe.expire(first.id);
    expect(await payments.processStripeEvent(stripe.event("evt_exp1", "checkout.session.expired", first.id))).toBe("processed");
    expect((await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe("ACCEPTED");
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ productionStatus: "AWAITING_DEPOSIT", paymentStatus: "DEPOSIT_DUE" });
    const ov = (await customerOrderView(token))!;
    expect(ov.deposit).toMatchObject({ paid: false, dueCents: 57500, payHref: `/order/${token}/pay` });
    // One reminder with the stable pay link.
    const reminder = await prisma.emailLog.findFirstOrThrow({ where: { template: "deposit_payment_request" } });
    expect(reminder.html).toContain(`/order/${token}/pay`);

    // Retry: a fresh session replaces the expired one.
    const r = await pay(token);
    const second = stripe.latest();
    expect(second.id).not.toBe(first.id);
    expect(r.headers.get("location")).toBe(second.url);
    expect(second.amountTotal).toBe(57500);
    expect(await depositOf(order.id)).toMatchObject({ stripeCheckoutSessionId: second.id, stripeCheckoutStatus: "open", checkoutAttempts: 2 });

    // Expired at Stripe without (or before) the webhook: still replaced on the next click.
    stripe.expire(second.id);
    await pay(token);
    expect(stripe.latest().id).not.toBe(second.id);
    // Later expiries don't send another reminder.
    expect(await payments.processStripeEvent(stripe.event("evt_exp2", "checkout.session.expired", second.id))).toBe("processed");
    expect(await prisma.emailLog.count({ where: { template: "deposit_payment_request" } })).toBe(1);
    expect(await prisma.payment.count()).toBe(0);

    // A late payment on an older session still counts (money received), but only once.
    stripe.complete(first.id);
    await payments.processStripeEvent(stripe.event("evt_late", "checkout.session.completed", first.id));
    expect(await prisma.payment.count()).toBe(1);
  });

  it("an already-paid deposit can't be paid again", async () => {
    const { order } = await acceptOnline();
    await pay(order.customerToken!);
    const s = stripe.complete(stripe.latest().id);
    await payments.processStripeEvent(stripe.event("evt_paid", "checkout.session.completed", s.id));
    const sessions = stripe.sessions.size;
    expect(await checkout.startDepositCheckout(order.customerToken!)).toEqual({ kind: "nothing_due" });
    expect((await pay(order.customerToken!)).headers.get("location")).toBe(`/order/${order.customerToken}`);
    expect(stripe.sessions.size).toBe(sessions);
    expect((await customerOrderView(order.customerToken!))!.deposit).toMatchObject({ paid: true, payHref: null });
  });

  it("a manual payment closes the open checkout and blocks a duplicate online payment", async () => {
    const { order } = await acceptOnline();
    await pay(order.customerToken!);
    const s = stripe.latest();
    const deposit = await depositOf(order.id);
    await payments.recordManualPayment(actor, { invoiceId: deposit.id, amountCents: 57500, method: "CHECK", checkStatus: "SUCCEEDED", receivedAt: new Date(), reference: "1042", notes: null, sendReceipt: false });
    expect(stripe.calls).toContain(`expire:${s.id}`);
    expect(await depositOf(order.id)).toMatchObject({ status: "PARTIALLY_PAID", amountPaidCents: 57500, stripeCheckoutStatus: "expired" });
    expect(await checkout.startDepositCheckout(order.customerToken!)).toEqual({ kind: "nothing_due" });
    expect(stripe.sessions.size).toBe(1);

    // And the other way round: once the customer has completed checkout, a manual payment is refused.
    const other = await acceptOnline();
    await pay(other.order.customerToken!);
    stripe.complete(stripe.latest().id);
    const otherDeposit = await depositOf(other.order.id);
    await expect(payments.recordManualPayment(actor, { invoiceId: otherDeposit.id, amountCents: 1000, method: "CASH", receivedAt: new Date(), reference: null, notes: null, sendReceipt: false })).rejects.toThrow(/already paid this online|just paid this online/);
    expect(await prisma.payment.count({ where: { invoiceId: otherDeposit.id } })).toBe(0);
  });

  it("a partial manual payment re-prices the next checkout to what's still owed", async () => {
    const { order } = await acceptOnline();
    await pay(order.customerToken!);
    const deposit = await depositOf(order.id);
    await payments.recordManualPayment(actor, { invoiceId: deposit.id, amountCents: 7500, method: "CASH", receivedAt: new Date(), reference: null, notes: null, sendReceipt: false });
    await pay(order.customerToken!);
    expect(stripe.latest().amountTotal).toBe(50000);
  });

  it("the final balance is requested on the same invoice and paid through Stripe Checkout", async () => {
    const { order } = await acceptOnline();
    await pay(order.customerToken!);
    const s = stripe.complete(stripe.latest().id);
    await payments.processStripeEvent(stripe.event("evt_paid", "checkout.session.completed", s.id));
    const invoice = await depositOf(order.id);
    // Nothing more is due until the balance is requested.
    expect(await checkout.startInvoicePageCheckout(invoice.publicToken!)).toEqual({ kind: "nothing_due" });
    await createSignedInAdmin({ role: "OWNER", email: "boss@example.com" });
    expect(await sales.markBalanceDueAction(invoice.id)).toMatchObject({ ok: true });
    expect(await prisma.invoice.count()).toBe(1);
    const mail = await prisma.emailLog.findFirstOrThrow({ where: { template: "balance_due" } });
    expect(mail.html).toContain(`/invoice/${invoice.publicToken}`);
    expect(mail.html).not.toContain("stripe.com");
    // Customer pays from the invoice page: exactly the remaining balance.
    const r = await payRoute.GET(new Request("http://localhost/x"), { params: Promise.resolve({ token: order.customerToken! }) });
    expect(r.headers.get("location")).toBe(stripe.latest().url);
    expect(stripe.latest().input).toMatchObject({ amountCents: 57500, metadata: { payment_type: "FINAL_BALANCE", expected_amount: "57500", invoice_number: invoice.number } });
    expect(stripe.calls.filter((c) => c.startsWith("invoice:"))).toEqual([]); // never a Stripe Invoice
    const s2 = stripe.complete(stripe.latest().id);
    await payments.processStripeEvent(stripe.event("evt_bal", "checkout.session.completed", s2.id));
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).toMatchObject({ status: "PAID", amountPaidCents: 115000 });
    expect(await prisma.payment.findMany({ where: { invoiceId: invoice.id }, orderBy: { receivedAt: "asc" } })).toEqual([expect.objectContaining({ type: "DEPOSIT" }), expect.objectContaining({ type: "FINAL_BALANCE", method: "STRIPE_ONLINE" })]);
    expect((await customerOrderView(order.customerToken!))!).toMatchObject({ balanceCents: 0, paidCents: 115000, paymentStatus: "PAID" });
  });

  it("admin: resend the payment link and cancel the payment request (closing the open checkout)", async () => {
    const { order } = await acceptOnline();
    await pay(order.customerToken!);
    const s = stripe.latest();
    const deposit = await depositOf(order.id);
    await createSignedInAdmin({ role: "OWNER", email: "boss@example.com" });
    expect(await sales.resendDepositLinkAction(deposit.id)).toMatchObject({ ok: true });
    expect((await prisma.emailLog.findFirstOrThrow({ where: { template: "deposit_payment_request" } })).html).toContain(`/order/${order.customerToken}/pay`);
    expect(await prisma.activityLog.count({ where: { type: "payment.link_sent" } })).toBe(1);

    expect(await sales.voidInvoiceAction(deposit.id, form({ reason: "Other", details: "Customer will pay in person" }))).toMatchObject({ ok: true });
    expect(stripe.calls).toContain(`expire:${s.id}`);
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: deposit.id } })).toMatchObject({ status: "VOIDED", stripeCheckoutStatus: "expired" });
    expect(await checkout.startDepositCheckout(order.customerToken!)).toEqual({ kind: "nothing_due" });
    expect(await sales.resendDepositLinkAction(deposit.id)).toMatchObject({ ok: false });

    // A replacement invoice can be created (new number); it's ready to pay online (no send step).
    expect(await sales.createOrderInvoiceAction(order.id)).toMatchObject({ ok: true });
    expect(await prisma.invoice.findFirstOrThrow({ where: { orderId: order.id, status: "DEPOSIT_DUE" } })).toMatchObject({ number: "WMI-1002", totalCents: 115000, depositCents: 57500 });
  });

  it("the finance permission is required for payment-link actions", async () => {
    const { order } = await acceptOnline();
    const deposit = await depositOf(order.id);
    await createSignedInAdmin({ role: "EDITOR", email: "editor@example.com" });
    expect(await sales.resendDepositLinkAction(deposit.id)).toMatchObject({ ok: false });
    expect(await prisma.emailLog.count({ where: { template: "deposit_payment_request" } })).toBe(0);
  });

  it("with online payments off, acceptance shows offline instructions and never opens Stripe", async () => {
    await prisma.siteSetting.update({ where: { id: "default" }, data: { stripeInvoicingEnabled: false } });
    const { order, payNow } = await acceptOnline();
    expect(payNow).toBe(false);
    expect(await depositOf(order.id)).toMatchObject({ status: "DEPOSIT_DUE" });
    expect((await customerOrderView(order.customerToken!))!.deposit).toMatchObject({ payHref: null, instructions: "Checks payable to Wild Mountain." });
    expect((await pay(order.customerToken!)).headers.get("location")).toBe(`/order/${order.customerToken}`);
    expect(stripe.calls).toEqual([]);
    const mail = await prisma.emailLog.findFirstOrThrow({ where: { template: "quote_accepted" } });
    expect(mail.html).not.toMatch(/send (you )?an invoice/i);
  });
});
