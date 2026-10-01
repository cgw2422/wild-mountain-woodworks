import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManualPaymentInput } from "@/lib/sales/payments";
import type { OrderUpdateInput } from "@/lib/sales/orders";

vi.mock("next/headers", async () => (await import("../support/next-request")).nextHeaders);
vi.mock("next/navigation", async () => (await import("../support/next-request")).nextNavigation);
vi.mock("next/cache", async () => (await import("../support/next-request")).nextCache);

/** A controllable email provider so delivery failures can be simulated. */
const mail = vi.hoisted(() => ({ fail: false, sent: [] as Array<{ to: string | string[]; subject: string; text: string; html?: string }> }));
vi.mock("@/lib/email/provider", () => ({
  getEmailProvider: () => ({
    name: "test",
    send: async (m: { to: string | string[]; subject: string; text: string; html?: string }) => {
      if (mail.fail) throw new Error("Mailbox unavailable");
      mail.sent.push(m);
    },
  }),
  sendEmailSafely: async () => undefined,
}));

const { prisma } = await import("@/lib/db");
const { createSignedInAdmin, resetRequest } = await import("../support/next-request");
const { createConfigurationQuote } = await import("@/lib/services/submissions");
const quotes = await import("@/lib/sales/quotes");
const invoices = await import("@/lib/sales/invoices");
const payments = await import("@/lib/sales/payments");
const terminal = await import("@/lib/sales/terminal");
const orders = await import("@/lib/sales/orders");
const status = await import("@/lib/sales/status");
const checkout = await import("@/lib/sales/checkout");
const { customerInvoiceView, customerOrderView } = await import("@/lib/sales/views");
const { setInvoicingProviderForTests, terminalPaymentIntentParams } = await import("@/lib/sales/stripe");
const webhook = await import("@/app/api/stripe/webhook/route");
const sales = await import("@/app/admin/(panel)/sales-actions");
const { hasTestDb, resetDb, seedRidge } = await import("../support/db");
const { fakeStripe } = await import("../support/fake-stripe");

const meta = { ip: "198.51.100.7", userAgent: "Mozilla/5.0 test" };
const acceptance = { revisionNumber: 1, name: "Jamie Rivers", agreeTerms: true, agreeDeposit: true };
let owner: { id: string; name: string; role: string };
let stripe: ReturnType<typeof fakeStripe>;
let seeded: Awaited<ReturnType<typeof seedRidge>> | null = null;

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function signed(event: unknown) {
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", "whsec_x").update(`${t}.${body}`).digest("hex");
  return webhook.POST(new Request("http://localhost/api/stripe/webhook", { method: "POST", body, headers: { "stripe-signature": `t=${t},v1=${sig}` } }));
}

/** An accepted $2,000 order (one $2,000 piece), $1,000 deposit. */
async function acceptedOrder() {
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
  await quotes.saveRevision(owner, quote.id, {
    customerName: rev.customerName,
    customerEmail: rev.customerEmail,
    customerPhone: rev.customerPhone,
    customerAddress: rev.customerAddress,
    customerNotes: null,
    terms: "Balance due before delivery.",
    expiresAt: null,
    leadTime: "8–10 weeks",
    estimatedCompletion: "Early March",
    deliveryDetails: null,
    depositType: "PERCENTAGE",
    depositPercentBps: 5000,
    depositAmountCents: null,
    taxCents: 0,
    lines: [{ sourceId: null, kind: "PRODUCT", description: "The Ridge Dining Table", notes: null, quantity: 1, unitPriceCents: 200000, taxable: false, productId: null }],
  });
  await quotes.sendQuote(owner, quote.id);
  const r = await quotes.acceptQuote(quote.customerToken!, acceptance, meta);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: r.order.id } });
  const invoice = await prisma.invoice.findFirstOrThrow({ where: { orderId: order.id } });
  return { quote, order, invoice };
}

const inv = (id: string) => prisma.invoice.findUniqueOrThrow({ where: { id } });
const ord = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });
const cash = (invoiceId: string, amountCents: number, extra: Partial<ManualPaymentInput> = {}) =>
  payments.recordManualPayment(owner, { invoiceId, amountCents, method: "CASH", receivedAt: new Date(), reference: null, notes: "Paid at the shop — internal note", sendReceipt: false, ...extra });

describe("Terminal PaymentIntent parameters", () => {
  it("are card_present, captured automatically, and never save the card", () => {
    const params = terminalPaymentIntentParams({ idempotencyKey: "k", amountCents: 100000, description: "Payment", metadata: { invoice_id: "inv_1", payment_type: "FINAL_BALANCE", expected_amount: "100000" } });
    expect(params).toMatchObject({
      amount: "100000",
      currency: "usd",
      "payment_method_types[0]": "card_present",
      capture_method: "automatic",
      "metadata[invoice_id]": "inv_1",
      "metadata[payment_type]": "FINAL_BALANCE",
      "metadata[expected_amount]": "100000",
    });
    expect(Object.keys(params).join(" ")).not.toMatch(/setup_future_usage|\bcustomer\b|off_session/);
  });
});

describe("production statuses", () => {
  it("are only the seven simplified stages — no Finishing/Sanding/Curing/Materials", () => {
    expect([...status.PRODUCTION_STATUSES]).toEqual(["AWAITING_DEPOSIT", "ORDER_CONFIRMED", "IN_PRODUCTION", "READY_FOR_DELIVERY", "DELIVERY_SCHEDULED", "COMPLETED", "CANCELED"]);
    for (const old of ["FINISHING", "SANDING", "CURING", "MATERIALS_ORDERED", "DESIGN_REVIEW", "DEPOSIT_PAID", "QUOTE_ACCEPTED"]) {
      expect(status.PRODUCTION_STATUSES as readonly string[]).not.toContain(old);
    }
    expect(status.CUSTOMER_PROGRESS.map((s) => s.label)).toEqual(["Order confirmed", "In production", "Ready for delivery", "Delivery scheduled", "Completed"]);
    expect(Object.keys(orders.STATUS_EMAIL_TEMPLATES)).not.toContain("AWAITING_DEPOSIT");
  });
});

describe.skipIf(!hasTestDb)("one invoice per order, many payments", () => {
  beforeEach(async () => {
    await resetDb();
    resetRequest();
    seeded = null;
    mail.fail = false;
    mail.sent.length = 0;
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_x");
    await prisma.siteSetting.create({ data: { id: "default", stripeInvoicingEnabled: true, terminalReaderId: "tmr_shop", terminalReaderLabel: "Shop counter" } });
    const a = await prisma.adminUser.create({ data: { email: "owner@example.com", name: "Owner", role: "OWNER" } });
    owner = { id: a.id, name: a.name, role: "OWNER" };
    stripe = fakeStripe();
    setInvoicingProviderForTests(stripe.provider);
  });
  afterEach(() => {
    setInvoicingProviderForTests(null);
    vi.unstubAllEnvs();
  });

  it("accepting creates exactly one invoice for the full total, carrying the deposit", async () => {
    const { order, invoice, quote } = await acceptedOrder();
    expect(await prisma.invoice.count()).toBe(1);
    expect(invoice).toMatchObject({ kind: "FULL", totalCents: 200000, depositCents: 100000, status: "DEPOSIT_DUE", quoteId: quote.id, stripeInvoiceId: null });
    expect(order).toMatchObject({ productionStatus: "AWAITING_DEPOSIT", paymentStatus: "DEPOSIT_DUE" });
    // A second "order invoice" is refused while one is live.
    await expect(prisma.$transaction((tx) => invoices.createOrderInvoice(tx, order.id, owner.id))).rejects.toThrow();
  });

  it("deposit + mark balance due + mixed cash/check/Terminal payments all land on the same invoice and reach PAID", async () => {
    const { order, invoice } = await acceptedOrder();
    // Deposit in cash with a receipt → order confirmed automatically.
    await cash(invoice.id, 100000, { sendReceipt: true });
    expect(await inv(invoice.id)).toMatchObject({ status: "PARTIALLY_PAID", amountPaidCents: 100000 });
    expect(await ord(order.id)).toMatchObject({ productionStatus: "ORDER_CONFIRMED", paymentStatus: "PARTIALLY_PAID" });
    expect(await prisma.payment.findFirstOrThrow()).toMatchObject({ type: "DEPOSIT", method: "CASH" });
    expect(await prisma.statusNotification.findFirstOrThrow()).toMatchObject({ toStatus: "ORDER_CONFIRMED", status: "SENT" });

    // Mark balance due: same invoice, no Stripe invoice, WMW link emailed.
    await invoices.markBalanceDue(owner, invoice.id);
    expect(await prisma.invoice.count()).toBe(1);
    expect(stripe.calls.filter((c) => c.startsWith("invoice:"))).toEqual([]);
    expect(await inv(invoice.id)).toMatchObject({ status: "BALANCE_DUE" });
    expect(await ord(order.id)).toMatchObject({ paymentStatus: "BALANCE_DUE" });
    const balanceMail = await prisma.emailLog.findFirstOrThrow({ where: { template: "balance_due" } });
    expect(balanceMail.html).toContain(`/invoice/${invoice.publicToken}`);
    expect(balanceMail.html).not.toContain("stripe.com");
    await expect(invoices.markBalanceDue(owner, invoice.id)).rejects.toThrow(/already due/);

    // $300 check — pending, so not counted as paid, but held against what's collectible.
    const check = await payments.recordManualPayment(owner, { invoiceId: invoice.id, amountCents: 30000, method: "CHECK", receivedAt: new Date(), reference: "1042", payerName: "First Bank", receivedBy: "Sam", notes: null, sendReceipt: false });
    expect(check).toMatchObject({ status: "PENDING", payerName: "First Bank", receivedBy: "Sam" });
    expect(await inv(invoice.id)).toMatchObject({ amountPaidCents: 100000, pendingCents: 30000, status: "BALANCE_DUE" });
    await payments.markCheckCleared(owner, check.id);
    expect(await inv(invoice.id)).toMatchObject({ amountPaidCents: 130000, pendingCents: 0 });

    // $500 in-person card (partial), then the $200 remainder online.
    const tp = await terminal.startTerminalPayment(owner, invoice.id, { amountCents: 50000 });
    expect(tp).toMatchObject({ status: "PENDING", method: "STRIPE_TERMINAL", amountCents: 50000, type: "PARTIAL_PAYMENT", stripeTerminalReaderId: "tmr_shop" });
    expect(stripe.calls).toContain(`process:tmr_shop:${tp.stripePaymentIntentId}`);
    stripe.succeedIntent(tp.stripePaymentIntentId!);
    expect((await signed(stripe.intentEvent("evt_t1", "payment_intent.succeeded", tp.stripePaymentIntentId!))).status).toBe(200);
    expect(await inv(invoice.id)).toMatchObject({ amountPaidCents: 180000, status: "BALANCE_DUE" });

    expect((await checkout.startInvoicePageCheckout(invoice.publicToken!)).kind).toBe("redirect");
    const s = stripe.latest();
    expect(s.input.amountCents).toBe(20000);
    expect(s.input.metadata).toMatchObject({ payment_type: "FINAL_BALANCE", expected_amount: "20000", invoice_id: invoice.id, order_id: order.id });
    stripe.complete(s.id);
    await signed(stripe.event("evt_c1", "checkout.session.completed", s.id));

    expect(await inv(invoice.id)).toMatchObject({ status: "PAID", amountPaidCents: 200000, pendingCents: 0 });
    expect(await ord(order.id)).toMatchObject({ paymentStatus: "PAID" });
    expect(await prisma.invoice.count()).toBe(1);
    const all = await prisma.payment.findMany({ orderBy: { createdAt: "asc" } });
    expect(all.map((p) => [p.method, p.status, p.invoiceId])).toEqual([
      ["CASH", "SUCCEEDED", invoice.id],
      ["CHECK", "SUCCEEDED", invoice.id],
      ["STRIPE_TERMINAL", "SUCCEEDED", invoice.id],
      ["STRIPE_ONLINE", "SUCCEEDED", invoice.id],
    ]);
    // Nothing more is due: no pay button, Terminal/manual payments refused.
    expect((await checkout.startInvoicePageCheckout(invoice.publicToken!)).kind).toBe("nothing_due");
    await expect(cash(invoice.id, 100)).rejects.toThrow(/more than/);
  });

  it("duplicate Terminal webhooks apply once; a decline doesn't count; cancel leaves nothing paid", async () => {
    const { invoice } = await acceptedOrder();
    const t1 = await terminal.startTerminalPayment(owner, invoice.id); // defaults to the remaining balance
    expect(t1.amountCents).toBe(200000);
    expect(t1.type).toBe("FINAL_BALANCE");
    const pi = stripe.intents.get(t1.stripePaymentIntentId!)!;
    expect(pi.params).toMatchObject({ "payment_method_types[0]": "card_present", "metadata[payment_id]": t1.id, "metadata[invoice_id]": invoice.id });
    // A second in-person payment can't start while one is on the reader.
    await expect(terminal.startTerminalPayment(owner, invoice.id, { amountCents: 100 })).rejects.toThrow(/already waiting/);

    stripe.declineIntent(t1.stripePaymentIntentId!);
    await signed(stripe.intentEvent("evt_f1", "payment_intent.payment_failed", t1.stripePaymentIntentId!));
    // A declined card is recorded as a failed attempt (kept in the history) and never counts as paid.
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: t1.id } })).toMatchObject({ status: "FAILED", failureMessage: "Your card was declined." });
    expect(await inv(invoice.id)).toMatchObject({ amountPaidCents: 0, pendingCents: 0, status: "DEPOSIT_DUE" });

    // An attempt canceled by the admin before the customer taps leaves nothing paid.
    const t0 = await terminal.startTerminalPayment(owner, invoice.id, { amountCents: 5000 });
    await terminal.cancelTerminalPayment(owner, t0.id);
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: t0.id } })).toMatchObject({ status: "FAILED" });
    expect(stripe.intents.get(t0.stripePaymentIntentId!)!.status).toBe("canceled");
    expect(await inv(invoice.id)).toMatchObject({ amountPaidCents: 0, pendingCents: 0, status: "DEPOSIT_DUE" });

    // Overpaying on the reader is refused server-side.
    await expect(terminal.startTerminalPayment(owner, invoice.id, { amountCents: 200001 })).rejects.toThrow(/more than/);
    // An offline reader fails cleanly and leaves nothing pending.
    await expect(terminal.startTerminalPayment(owner, invoice.id, { amountCents: 100000, readerId: "tmr_truck" })).rejects.toThrow(/reader/);
    expect(await inv(invoice.id)).toMatchObject({ pendingCents: 0 });

    const t2 = await terminal.startTerminalPayment(owner, invoice.id, { amountCents: 100000 });
    expect(t2.type).toBe("DEPOSIT");
    stripe.succeedIntent(t2.stripePaymentIntentId!);
    const ev = stripe.intentEvent("evt_s2", "payment_intent.succeeded", t2.stripePaymentIntentId!);
    await signed(ev);
    await signed(ev);
    await signed({ ...ev, id: "evt_s2_again" }); // same intent, different event id
    expect(await inv(invoice.id)).toMatchObject({ amountPaidCents: 100000, status: "PARTIALLY_PAID" });
    expect(await prisma.payment.count({ where: { status: "SUCCEEDED" } })).toBe(1);
    expect(await prisma.order.findFirstOrThrow()).toMatchObject({ productionStatus: "ORDER_CONFIRMED" });
    // A refresh after success changes nothing.
    await terminal.refreshTerminalPayment(t2.id);
    expect(await inv(invoice.id)).toMatchObject({ amountPaidCents: 100000 });
  });

  it("Terminal: test-mode simulation and the admin actions are finance-only", async () => {
    const { invoice } = await acceptedOrder();
    await createSignedInAdmin({ role: "EDITOR", email: "editor@example.com" });
    expect(await sales.startTerminalPaymentAction(invoice.id, form({}))).toMatchObject({ ok: false });
    expect(await prisma.payment.count()).toBe(0);
    resetRequest();
    await createSignedInAdmin({ role: "OWNER", email: "boss@example.com" });
    expect(await sales.startTerminalPaymentAction(invoice.id, form({ amount: "250" }))).toMatchObject({ ok: true });
    const p = await prisma.payment.findFirstOrThrow();
    expect(p).toMatchObject({ amountCents: 25000, status: "PENDING" });
    expect(await sales.simulateTerminalPaymentAction(p.id)).toMatchObject({ ok: true });
    expect(await prisma.payment.findFirstOrThrow()).toMatchObject({ status: "SUCCEEDED" });
  });

  it("prevents overpayment unless an owner explicitly approves it", async () => {
    const { invoice } = await acceptedOrder();
    const admin = { id: owner.id, name: "Admin", role: "ADMIN" };
    await expect(payments.recordManualPayment(admin, { invoiceId: invoice.id, amountCents: 200001, method: "CASH", receivedAt: new Date(), reference: null, notes: null, sendReceipt: false, allowOverpayment: true })).rejects.toThrow(/more than/);
    await expect(cash(invoice.id, 200001)).rejects.toThrow(/more than/);
    // Pending money counts against what can still be collected.
    await payments.recordManualPayment(owner, { invoiceId: invoice.id, amountCents: 150000, method: "CHECK", receivedAt: new Date(), reference: "1", notes: null, sendReceipt: false });
    await expect(cash(invoice.id, 60000)).rejects.toThrow(/pending/);
    const over = await cash(invoice.id, 60000, { allowOverpayment: true });
    expect(over.overpaymentApprovedById).toBe(owner.id);
    expect(await prisma.activityLog.count({ where: { type: "payment.overpayment_approved" } })).toBe(1);
  });

  it("a returned check stops counting; payments are voided, never deleted", async () => {
    const { invoice } = await acceptedOrder();
    const check = await payments.recordManualPayment(owner, { invoiceId: invoice.id, amountCents: 100000, method: "CHECK", receivedAt: new Date(), reference: "77", notes: null, sendReceipt: false, checkStatus: "SUCCEEDED" });
    expect(await inv(invoice.id)).toMatchObject({ amountPaidCents: 100000 });
    await payments.markCheckReturned(owner, check.id, "Insufficient funds");
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: check.id } })).toMatchObject({ status: "RETURNED", voidReason: "Insufficient funds" });
    expect(await inv(invoice.id)).toMatchObject({ amountPaidCents: 0 });
    const c = await cash(invoice.id, 5000);
    await payments.voidManualPayment(owner, c.id, "Entered twice");
    await expect(prisma.payment.delete({ where: { id: c.id } })).rejects.toThrow();
    expect(await prisma.payment.count()).toBe(2);
    expect(await inv(invoice.id)).toMatchObject({ amountPaidCents: 0 });
  });

  it("the customer invoice page shows the money, history and terms — never notes, references or Stripe ids", async () => {
    const { invoice } = await acceptedOrder();
    await payments.recordManualPayment(owner, { invoiceId: invoice.id, amountCents: 40000, method: "CHECK", receivedAt: new Date(), reference: "SECRET-REF-1042", payerName: "First Bank", notes: "Internal: customer was rude", sendReceipt: false, checkStatus: "SUCCEEDED" });
    await prisma.invoice.update({ where: { id: invoice.id }, data: { internalNotes: { create: { body: "Internal margin 40%" } } } });
    const view = (await customerInvoiceView(invoice.publicToken!))!;
    expect(view).toMatchObject({ number: invoice.number, orderNumber: "WMO-1001", quoteNumber: "WMQ-1001", totalCents: 200000, paidCents: 40000, remainingCents: 160000, dueNowCents: 60000, dueNowType: "DEPOSIT", terms: "Balance due before delivery." });
    expect(view.payments).toHaveLength(1);
    const json = JSON.stringify(view);
    for (const secret of ["SECRET-REF-1042", "customer was rude", "Internal margin", "First Bank", "pi_", "cs_test", "tmr_"]) expect(json).not.toContain(secret);
  });

  it("canceled orders block balance requests and new payments", async () => {
    const { order, invoice } = await acceptedOrder();
    await cash(invoice.id, 100000);
    await orders.updateOrder(owner, order.id, { productionStatus: "CANCELED", deliveryDate: null, deliveryAddress: null, deliveryNotes: null, estimatedCompletion: null, productionNotes: null, customerNotes: null, notifyCustomer: false });
    await expect(invoices.markBalanceDue(owner, invoice.id)).rejects.toThrow(/canceled/);
    await expect(cash(invoice.id, 1000)).rejects.toThrow(/canceled/);
    await expect(terminal.startTerminalPayment(owner, invoice.id)).rejects.toThrow(/canceled/);
    await expect(orders.updateOrder(owner, order.id, { productionStatus: "IN_PRODUCTION", deliveryDate: null, deliveryAddress: null, deliveryNotes: null, estimatedCompletion: null, productionNotes: null, customerNotes: null, notifyCustomer: false })).rejects.toThrow(/canceled/);
    const view = (await customerOrderView(order.customerToken!))!;
    expect(view).toMatchObject({ canceled: true, due: null, productionStatus: "CANCELED" });
  });
});

describe.skipIf(!hasTestDb)("production status emails", () => {
  beforeEach(async () => {
    await resetDb();
    resetRequest();
    seeded = null;
    mail.fail = false;
    mail.sent.length = 0;
    await prisma.siteSetting.create({ data: { id: "default" } });
    const a = await prisma.adminUser.create({ data: { email: "owner@example.com", name: "Owner", role: "OWNER" } });
    owner = { id: a.id, name: a.name, role: "OWNER" };
  });

  const update = (orderId: string, productionStatus: string, extra: Partial<OrderUpdateInput> = {}) =>
    orders.updateOrder(owner, orderId, { productionStatus: productionStatus as OrderUpdateInput["productionStatus"], deliveryDate: null, deliveryAddress: null, deliveryNotes: null, estimatedCompletion: null, productionNotes: "Shop: use the walnut slab #4", customerNotes: null, notifyCustomer: true, ...extra });

  it("payment and production are independent; a deposit moves Awaiting Deposit → Order Confirmed", async () => {
    const { order, invoice } = await acceptedOrder();
    await update(order.id, "IN_PRODUCTION", { notifyCustomer: false });
    // Starting production doesn't change what's owed.
    expect(await ord(order.id)).toMatchObject({ productionStatus: "IN_PRODUCTION", paymentStatus: "DEPOSIT_DUE" });
    await cash(invoice.id, 100000);
    // Paying doesn't move production backwards.
    expect(await ord(order.id)).toMatchObject({ productionStatus: "IN_PRODUCTION", paymentStatus: "PARTIALLY_PAID" });
  });

  it("each stage sends its template with the secure order link; unchanged status sends nothing; suppress works", async () => {
    const { order, invoice } = await acceptedOrder();
    await cash(invoice.id, 100000); // → ORDER_CONFIRMED (no receipt asked → suppressed)
    expect(await prisma.statusNotification.findFirstOrThrow()).toMatchObject({ toStatus: "ORDER_CONFIRMED", status: "SUPPRESSED" });

    const expected: Array<[string, string]> = [
      ["IN_PRODUCTION", "order_in_production"],
      ["READY_FOR_DELIVERY", "order_ready"],
      ["COMPLETED", "order_completed"],
    ];
    for (const [s, template] of expected) {
      const r = await update(order.id, s);
      expect(r).toMatchObject({ productionChanged: true, notification: "SENT" });
      const log = await prisma.emailLog.findFirstOrThrow({ where: { template }, orderBy: { createdAt: "desc" } });
      expect(log.to).toBe("jamie@example.com");
      expect(log.html).toContain(`/order/${order.customerToken}`);
      expect(log.html).toContain("View Your Order");
      expect(log.html).toContain("WMO-1001");
      expect(log.html).not.toContain("walnut slab"); // internal notes never reach the customer
    }
    const before = await prisma.emailLog.count();
    expect(await update(order.id, "COMPLETED")).toMatchObject({ productionChanged: false, notification: "NONE" });
    expect(await prisma.emailLog.count()).toBe(before);

    const second = await acceptedOrder();
    expect(await update(second.order.id, "IN_PRODUCTION", { notifyCustomer: false })).toMatchObject({ notification: "SUPPRESSED" });
    expect(await prisma.emailLog.count({ where: { orderId: second.order.id, template: "order_in_production" } })).toBe(0);
    expect(await prisma.statusNotification.findFirstOrThrow({ where: { orderId: second.order.id } })).toMatchObject({ status: "SUPPRESSED", initiatedById: owner.id, fromStatus: "AWAITING_DEPOSIT", toStatus: "IN_PRODUCTION" });

    // The order's status history is kept.
    expect((await prisma.statusEvent.findMany({ where: { orderId: order.id }, orderBy: { createdAt: "asc" } })).map((e) => e.toStatus)).toEqual(expect.arrayContaining(["IN_PRODUCTION", "READY_FOR_DELIVERY", "COMPLETED"]));
  });

  it("delivery scheduled needs a date and includes the date, window and method in the email", async () => {
    const { order } = await acceptedOrder();
    await expect(update(order.id, "DELIVERY_SCHEDULED")).rejects.toThrow(/date/);
    const r = await update(order.id, "DELIVERY_SCHEDULED", { deliveryDate: new Date("2026-11-05T14:00:00Z"), deliveryWindow: "9am–12pm", deliveryMethod: "WHITE_GLOVE" });
    expect(r.notification).toBe("SENT");
    const log = await prisma.emailLog.findFirstOrThrow({ where: { template: "delivery_scheduled" } });
    expect(log.text).toContain("November 5, 2026");
    expect(log.text).toContain("9am–12pm");
    expect(log.text).toMatch(/white glove/i);
    expect(log.html).toContain(`/order/${order.customerToken}`);
  });

  it("a failed email never rolls back the status, is logged, and can be resent", async () => {
    const { order } = await acceptedOrder();
    mail.fail = true;
    const r = await update(order.id, "IN_PRODUCTION");
    expect(r).toMatchObject({ productionChanged: true, notification: "FAILED", error: expect.stringContaining("Mailbox unavailable") });
    expect(await ord(order.id)).toMatchObject({ productionStatus: "IN_PRODUCTION" });
    expect(await prisma.statusNotification.findFirstOrThrow()).toMatchObject({ status: "FAILED", error: expect.stringContaining("Mailbox unavailable"), email: "jamie@example.com", customerId: order.customerId });

    mail.fail = false;
    const again = await orders.resendStatusEmail(owner, order.id);
    expect(again.status).toBe("SENT");
    expect(mail.sent.at(-1)!.html).toContain(`/order/${order.customerToken}`);
    expect(await prisma.statusNotification.count({ where: { status: "SENT" } })).toBe(1);
    // Notification records are audit history: never deleted.
    await expect(prisma.statusNotification.deleteMany({})).rejects.toThrow();
  });

  it("the admin action rejects removed stages and reports the email outcome", async () => {
    const { order } = await acceptedOrder();
    await createSignedInAdmin({ role: "OWNER", email: "boss@example.com" });
    for (const old of ["FINISHING", "SANDING", "CURING", "MATERIALS_ORDERED"]) {
      expect(await sales.updateOrderAction(order.id, form({ productionStatus: old, notifyCustomer: "on" }))).toMatchObject({ ok: false });
    }
    expect(await ord(order.id)).toMatchObject({ productionStatus: "AWAITING_DEPOSIT" });
    expect(await sales.updateOrderAction(order.id, form({ productionStatus: "IN_PRODUCTION", notifyCustomer: "on" }))).toMatchObject({ ok: true, message: expect.stringMatching(/emailed/) });
    expect(await sales.updateOrderAction(order.id, form({ productionStatus: "READY_FOR_DELIVERY" }))).toMatchObject({ ok: true, message: expect.stringMatching(/no email/) });
  });

  it("the customer order page shows the stage, progress and milestones without internal notes", async () => {
    const { order, invoice } = await acceptedOrder();
    await cash(invoice.id, 100000);
    await update(order.id, "IN_PRODUCTION", { customerNotes: "We picked a lovely board for you." });
    let view = (await customerOrderView(order.customerToken!))!;
    expect(view).toMatchObject({ productionStatus: "IN_PRODUCTION", paymentStatus: "PARTIALLY_PAID", paidCents: 100000, balanceCents: 100000, customerNotes: "We picked a lovely board for you." });
    expect(view.milestones.map((m) => [m.kind, m.label])).toEqual(expect.arrayContaining([["payment", "Deposit received"], ["production", "Order confirmed"], ["production", "In production"]]));
    expect(JSON.stringify(view)).not.toContain("walnut slab");
    expect(JSON.stringify(view)).not.toContain("internal note");
    await update(order.id, "COMPLETED");
    view = (await customerOrderView(order.customerToken!))!;
    expect(view.productionStatus).toBe("COMPLETED");
  });
});
