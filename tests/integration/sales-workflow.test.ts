import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AcceptedSnapshot, RevisionInput, RevisionLineInput } from "@/lib/sales/quotes";
import type { OrderUpdateInput } from "@/lib/sales/orders";

vi.mock("next/headers", async () => (await import("../support/next-request")).nextHeaders);
vi.mock("next/navigation", async () => (await import("../support/next-request")).nextNavigation);
vi.mock("next/cache", async () => (await import("../support/next-request")).nextCache);

const { prisma } = await import("@/lib/db");
const { resetRequest } = await import("../support/next-request");
const { createConfigurationQuote, createGeneralQuote } = await import("@/lib/services/submissions");
const quotes = await import("@/lib/sales/quotes");
const invoices = await import("@/lib/sales/invoices");
const payments = await import("@/lib/sales/payments");
const orders = await import("@/lib/sales/orders");
const { markPastDueInvoices } = await import("@/lib/sales/ledger");
const { loadCustomerQuote, customerInvoiceView, customerOrderView } = await import("@/lib/sales/views");
const { setInvoicingProviderForTests } = await import("@/lib/sales/stripe");
const { SalesError } = await import("@/lib/sales/errors");
const { hasTestDb, resetDb, seedRidge } = await import("../support/db");

const customer = { name: "Jamie Rivers", email: "Jamie@Example.com", phone: null, zipCode: "43215", timeline: null, notes: "Please call after 5." };
const meta = { ip: "198.51.100.7", userAgent: "Mozilla/5.0 test" };
let actor: { id: string; name: string };

async function requestQuote(quantity = 1) {
  const { product, ids } = await seedRidge();
  const quote = await createConfigurationQuote({
    ...customer,
    quantity,
    address: "12 Oak St, Columbus OH",
    productId: product.id,
    selection: { options: { [ids.size]: ids.s84, [ids.wood]: ids.walnut }, addOns: { [ids.bench]: 1 }, customDetails: {} },
  });
  return { quote, product, ids };
}

/** Save the current draft with simple lines: one piece + delivery, 50% deposit. */
async function priceDraft(quoteId: string, lines?: RevisionLineInput[], deposit: Partial<RevisionInput> = {}) {
  const q = await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quoteId }, include: { currentRevision: { include: { lineItems: { orderBy: { position: "asc" } } } } } });
  const rev = q.currentRevision!;
  return quotes.saveRevision(actor, quoteId, {
    customerName: rev.customerName,
    customerEmail: rev.customerEmail,
    customerPhone: rev.customerPhone,
    customerAddress: rev.customerAddress,
    customerNotes: "Built to order in our shop.",
    terms: "Deposit due to begin.",
    expiresAt: null,
    leadTime: "8–10 weeks",
    estimatedCompletion: "Early March",
    deliveryDetails: "White-glove delivery",
    depositType: "PERCENTAGE",
    depositPercentBps: 5000,
    depositAmountCents: null,
    taxCents: 0,
    lines:
      lines ??
      [
        ...rev.lineItems.map((l) => ({ sourceId: l.id, kind: l.kind, description: l.description, notes: l.notes, quantity: l.quantity, unitPriceCents: l.unitPriceCents, taxable: l.taxable, productId: l.productId })),
        { sourceId: null, kind: "DELIVERY" as const, description: "Delivery & setup", notes: null, quantity: 1, unitPriceCents: 15000, taxable: false, productId: null },
      ],
    ...deposit,
  });
}

describe.skipIf(!hasTestDb)("sales workflow: quote → order → invoice → payment", () => {
  beforeEach(async () => {
    await resetDb();
    resetRequest();
    await prisma.siteSetting.create({ data: { id: "default", defaultQuoteTerms: "Standard terms." } });
    const a = await prisma.adminUser.create({ data: { email: "owner@example.com", name: "Owner", role: "OWNER" } });
    actor = { id: a.id, name: a.name };
    setInvoicingProviderForTests(null);
  });
  afterEach(() => {
    setInvoicingProviderForTests(null);
    vi.unstubAllEnvs();
  });

  it("stores a request as a numbered quote with a customer, token and prefilled draft revision", async () => {
    const { quote } = await requestQuote(2);
    expect(quote).toMatchObject({ number: "WMQ-1001", status: "NEW", quantity: 2, address: "12 Oak St, Columbus OH" });
    expect(quote.customerToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const c = await prisma.customer.findFirstOrThrow();
    expect(c).toMatchObject({ email: "jamie@example.com", name: "Jamie Rivers", deliveryAddress: "12 Oak St, Columbus OH" });
    const rev = await prisma.quoteRevision.findFirstOrThrow({ where: { quoteId: quote.id }, include: { lineItems: { orderBy: { position: "asc" } } } });
    expect(rev).toMatchObject({ number: 1, status: "DRAFT", terms: "Standard terms.", depositType: "PERCENTAGE", depositPercentBps: 5000 });
    // Piece at base + options (1200 + 300 + 600), bench add-on 350 — both × 2.
    expect(rev.lineItems.map((l) => [l.kind, l.quantity, l.unitPriceCents])).toEqual([
      ["PRODUCT", 2, 210000],
      ["ADDON", 2, 35000],
    ]);
    expect(rev.totalCents).toBe(490000);
    expect(quote.estimatedTotalCents).toBe(490000);
    // Emails are logged (customer confirmation + admin notification only if an admin address exists).
    expect(await prisma.emailLog.count({ where: { template: "quote_request_received" } })).toBe(1);
    expect(await prisma.customerActivity.count({ where: { type: "quote.requested" } })).toBe(1);
    // A second request from the same email reuses the customer (exact match only).
    await createGeneralQuote({ ...customer, email: "jamie@example.com", interest: "Bench", requestedDimensions: null });
    await createGeneralQuote({ ...customer, email: "jamie.rivers@example.com", interest: "Desk", requestedDimensions: null });
    expect(await prisma.customer.count()).toBe(2);
    expect((await prisma.quoteRequest.findMany({ orderBy: { createdAt: "asc" } })).map((q) => q.number)).toEqual(["WMQ-1001", "WMQ-1002", "WMQ-1003"]);
  });

  it("edits the draft with server-computed totals and audited price changes; never trusts browser product ids", async () => {
    const { quote } = await requestQuote();
    const q = await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quote.id }, include: { currentRevision: { include: { lineItems: true } } } });
    const product = q.currentRevision!.lineItems.find((l) => l.kind === "PRODUCT")!;
    const totals = await priceDraft(quote.id, [
      { sourceId: product.id, kind: "PRODUCT", description: product.description, notes: null, quantity: 1, unitPriceCents: 200000, taxable: true, productId: product.productId },
      { sourceId: null, kind: "DISCOUNT", description: "Returning customer", notes: null, quantity: 1, unitPriceCents: 10000, taxable: true, productId: null },
      { sourceId: null, kind: "DELIVERY", description: "Delivery", notes: null, quantity: 1, unitPriceCents: 15000, taxable: false, productId: null },
      { sourceId: null, kind: "INSTALLATION", description: "Wall mounting", notes: null, quantity: 1, unitPriceCents: 5000, taxable: false, productId: null },
      { sourceId: null, kind: "CUSTOM", description: "Fake product", notes: null, quantity: 1, unitPriceCents: 1000, taxable: true, productId: "not-a-real-product" },
    ]);
    expect(totals).toMatchObject({ subtotalCents: 201000, discountCents: 10000, deliveryCents: 15000, otherChargesCents: 5000, totalCents: 211000, depositCents: 105500, balanceCents: 105500 });
    const lines = await prisma.quoteLineItem.findMany({ where: { revisionId: q.currentRevisionId! }, orderBy: { position: "asc" } });
    expect(lines[0]!.configuration).not.toBeNull(); // snapshot carried from the source line
    expect(lines[1]!.unitPriceCents).toBe(-10000); // discounts always negative
    expect(lines[4]!.productId).toBeNull(); // unknown product id dropped
    const audit = await prisma.activityLog.findFirstOrThrow({ where: { type: "quote.pricing_changed" } });
    expect(audit.message).toMatch(/\$2,100 × 1|1 × \$2,100 → 1 × \$2,000/);
    expect((await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe("DRAFT");
    // Fixed deposits are capped at the total; NONE is zero.
    expect(await priceDraft(quote.id, undefined, { depositType: "FIXED_AMOUNT", depositAmountCents: 99_999_999 })).toMatchObject({ depositCents: expect.any(Number), balanceCents: 0 });
    expect(await priceDraft(quote.id, undefined, { depositType: "NONE" })).toMatchObject({ depositCents: 0 });
  });

  it("sends, supersedes revisions and only accepts the current one", async () => {
    const { quote } = await requestQuote();
    await priceDraft(quote.id);
    const sent = await quotes.sendQuote(actor, quote.id);
    expect(sent.status).toBe("SENT");
    const log = await prisma.emailLog.findFirstOrThrow({ where: { template: "quote_sent" } });
    expect(log.html).toContain(`/quote/${quote.customerToken}`);
    expect(log.html).not.toContain(quote.id);
    const r1 = await prisma.quoteRevision.findFirstOrThrow({ where: { quoteId: quote.id, number: 1 } });
    expect(r1.status).toBe("SENT");
    expect(r1.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    // Sent revisions can't be edited.
    await expect(quotes.saveRevision(actor, quote.id, {} as RevisionInput)).rejects.toThrow(/can't be changed/);

    // Revision 2: the customer still sees revision 1 until it is sent.
    await quotes.createRevision(actor, quote.id);
    expect((await loadCustomerQuote(quote.customerToken!))!.view.revision!.number).toBe(1);
    await priceDraft(quote.id, undefined, { depositType: "FIXED_AMOUNT", depositAmountCents: 50000 });
    await quotes.sendQuote(actor, quote.id);
    expect(await prisma.emailLog.count({ where: { template: "quote_revised" } })).toBe(1);
    expect((await prisma.quoteRevision.findUniqueOrThrow({ where: { id: r1.id } })).status).toBe("SUPERSEDED");

    // Accepting the superseded revision is refused.
    const accept = { name: "Jamie Rivers", agreeTerms: true, agreeDeposit: true };
    await expect(quotes.acceptQuote(quote.customerToken!, { ...accept, revisionNumber: 1 }, meta)).rejects.toThrow(/updated/);
    // Missing confirmations are refused.
    await expect(quotes.acceptQuote(quote.customerToken!, { ...accept, revisionNumber: 2, agreeDeposit: false }, meta)).rejects.toThrow(/confirm/);
    // A bad token is refused.
    await expect(quotes.acceptQuote("x".repeat(43), { ...accept, revisionNumber: 2 }, meta)).rejects.toThrow(/not valid/);

    const order = await quotes.acceptQuote(quote.customerToken!, { ...accept, revisionNumber: 2 }, meta);
    const r2 = await prisma.quoteRevision.findFirstOrThrow({ where: { quoteId: quote.id, number: 2 } });
    expect(r2).toMatchObject({ status: "ACCEPTED", acceptedName: "Jamie Rivers", acceptedIp: meta.ip, acceptedUserAgent: meta.userAgent });
    const snap = r2.acceptedSnapshot as unknown as AcceptedSnapshot;
    expect(snap).toMatchObject({ revisionNumber: 2, quoteNumber: "WMQ-1001", totals: { totalCents: r2.totalCents, depositCents: 50000 }, terms: "Deposit due to begin." });
    expect(snap.agreements).toHaveLength(2);
    expect(await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quote.id } })).toMatchObject({ status: "ACCEPTED", acceptedRevisionId: r2.id });
    // Accepted twice? No.
    await expect(quotes.acceptQuote(quote.customerToken!, { ...accept, revisionNumber: 2 }, meta)).rejects.toThrow(/already been accepted/);

    // The order copies the accepted revision; a draft deposit invoice is ready.
    expect(order).toMatchObject({ number: "WMO-1001", productionStatus: "AWAITING_DEPOSIT", paymentStatus: "DEPOSIT_DUE", depositCents: 50000, totalCents: r2.totalCents });
    const deposit = await prisma.invoice.findFirstOrThrow({ where: { orderId: order.id } });
    expect(deposit).toMatchObject({ number: "WMI-1001", kind: "DEPOSIT", status: "DRAFT", totalCents: 50000 });

    // Later edits to the catalog or quote don't change the frozen acceptance.
    await prisma.product.updateMany({ data: { name: "Renamed", basePriceCents: 1 } });
    const again = (await prisma.quoteRevision.findUniqueOrThrow({ where: { id: r2.id } })).acceptedSnapshot as unknown as AcceptedSnapshot;
    expect(again.lines[0]!.description).toBe("The Ridge Dining Table");
  });

  it("records views, expiry (viewable but not acceptable), extension and decline", async () => {
    const { quote } = await requestQuote();
    await priceDraft(quote.id);
    await quotes.sendQuote(actor, quote.id);
    const loaded = (await loadCustomerQuote(quote.customerToken!))!;
    await quotes.recordQuoteView(loaded.internal.quoteId, loaded.internal.revisionId!, meta);
    expect((await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe("VIEWED");
    expect(await prisma.customerActivity.count({ where: { type: "quote.viewed" } })).toBe(1);
    await quotes.recordQuoteView(loaded.internal.quoteId, loaded.internal.revisionId!, meta);
    expect(await prisma.customerActivity.count({ where: { type: "quote.viewed" } })).toBe(1); // first view only

    await prisma.quoteRevision.updateMany({ where: { quoteId: quote.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = (await loadCustomerQuote(quote.customerToken!))!.view;
    expect(expired.status).toBe("EXPIRED");
    expect(expired.revision).not.toBeNull(); // still viewable
    expect(expired.blocker).toMatch(/expired/);
    await expect(quotes.acceptQuote(quote.customerToken!, { revisionNumber: 1, name: "Jamie", agreeTerms: true, agreeDeposit: true }, meta)).rejects.toThrow(/expired/);

    await quotes.extendQuote(actor, quote.id, new Date(Date.now() + 7 * 86_400_000));
    expect((await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe("VIEWED");
    expect((await loadCustomerQuote(quote.customerToken!))!.view.blocker).toBeNull();

    await quotes.declineQuote(quote.customerToken!, { revisionNumber: 1, reason: "Went with a smaller table" }, meta);
    expect(await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quote.id } })).toMatchObject({ status: "DECLINED" });
    expect(await prisma.quoteRevision.findFirstOrThrow({ where: { quoteId: quote.id } })).toMatchObject({ status: "DECLINED", declineReason: "Went with a smaller table" });
    await expect(quotes.acceptQuote(quote.customerToken!, { revisionNumber: 1, name: "Jamie", agreeTerms: true, agreeDeposit: true }, meta)).rejects.toThrow(/declined/);
  });

  it("customer views expose no internal data", async () => {
    const { quote } = await requestQuote();
    await prisma.internalNote.create({ data: { body: "SECRET margin 62%", quoteRequestId: quote.id } });
    await prisma.quoteRequest.update({ where: { id: quote.id }, data: { notes: "customer note" } });
    await priceDraft(quote.id);
    // Drafts are never shown.
    expect((await loadCustomerQuote(quote.customerToken!))!.view.revision).toBeNull();
    await quotes.sendQuote(actor, quote.id);
    const { view } = (await loadCustomerQuote(quote.customerToken!))!;
    const json = JSON.stringify(view);
    expect(json).not.toContain("SECRET");
    expect(json).not.toContain(quote.id);
    expect(json).not.toMatch(/"id"|productId|configuration|createdById|internal/i);
    expect(await loadCustomerQuote("not-a-token")).toBeNull();
    expect(await loadCustomerQuote("A".repeat(43))).toBeNull();
  });

  it("offline invoicing: deposit, partial and full manual payments, balance invoice, production advance", async () => {
    const { quote } = await requestQuote();
    await priceDraft(quote.id);
    await quotes.sendQuote(actor, quote.id);
    const order = await quotes.acceptQuote(quote.customerToken!, { revisionNumber: 1, name: "Jamie Rivers", agreeTerms: true, agreeDeposit: true }, meta);
    const deposit = await prisma.invoice.findFirstOrThrow({ where: { orderId: order.id, kind: "DEPOSIT" } });
    const total = order.totalCents;
    expect(deposit.totalCents).toBe(Math.floor((total * 5000 * 2 + 10000) / 20000));

    const sent = await invoices.sendInvoice(actor, deposit.id);
    expect(sent.via).toBe("wild_mountain");
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: deposit.id } })).toMatchObject({ status: "SENT", stripeInvoiceId: null });
    expect((await prisma.emailLog.findFirstOrThrow({ where: { template: "deposit_invoice" } })).html).toContain(`/invoice/${deposit.publicToken}`);
    expect((await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe("CONVERTED_TO_INVOICE");
    await expect(invoices.sendInvoice(actor, deposit.id)).rejects.toThrow(/already been sent/);

    // Guards: bad method, overpayment.
    const base = { invoiceId: deposit.id, receivedAt: new Date(), reference: "1042", notes: null, sendReceipt: true };
    await expect(payments.recordManualPayment(actor, { ...base, amountCents: 100, method: "STRIPE" })).rejects.toBeInstanceOf(SalesError);
    await expect(payments.recordManualPayment(actor, { ...base, amountCents: deposit.totalCents + 1, method: "CHECK" })).rejects.toThrow(/more than/);

    // Partial then full.
    await payments.recordManualPayment(actor, { ...base, amountCents: 20000, method: "CHECK" });
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: deposit.id } })).toMatchObject({ status: "PARTIALLY_PAID", amountPaidCents: 20000 });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ paymentStatus: "PARTIALLY_PAID", productionStatus: "AWAITING_DEPOSIT" });
    const second = await payments.recordManualPayment(actor, { ...base, amountCents: deposit.totalCents - 20000, method: "CASH" });
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: deposit.id } })).toMatchObject({ status: "PAID" });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ paymentStatus: "PARTIALLY_PAID", productionStatus: "DEPOSIT_PAID" });
    expect(await prisma.payment.count({ where: { source: "STRIPE" } })).toBe(0); // never a fake Stripe record
    expect(await prisma.emailLog.count({ where: { template: "payment_received" } })).toBe(2);

    // Voiding a mistaken payment re-opens the invoice; the record is kept.
    await payments.voidManualPayment(actor, second.id, "Entered twice");
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: deposit.id } })).toMatchObject({ status: "PARTIALLY_PAID", amountPaidCents: 20000 });
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({ status: "VOIDED", voidReason: "Entered twice" });
    await payments.recordManualPayment(actor, { ...base, amountCents: deposit.totalCents - 20000, method: "BANK_TRANSFER", sendReceipt: false });
    await expect(invoices.voidInvoice(actor, deposit.id, "oops")).rejects.toThrow(/has payments/);

    // Balance invoice = total − already invoiced; can't over-invoice.
    await expect(prisma.$transaction((tx) => invoices.createInvoiceForOrder(tx, order.id, "FULL", actor.id))).rejects.toThrow(/already invoiced/);
    const balance = await prisma.$transaction((tx) => invoices.createInvoiceForOrder(tx, order.id, "BALANCE", actor.id));
    expect(balance.totalCents).toBe(total - deposit.totalCents);
    await expect(prisma.$transaction((tx) => invoices.createInvoiceForOrder(tx, order.id, "BALANCE", actor.id))).rejects.toThrow(/already been invoiced/);
    await invoices.sendInvoice(actor, balance.id);
    await payments.recordManualPayment(actor, { ...base, invoiceId: balance.id, amountCents: balance.totalCents, method: "CHECK" });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ paymentStatus: "PAID" });

    // Refund bookkeeping (no deletion).
    const p = await prisma.payment.findFirstOrThrow({ where: { invoiceId: balance.id } });
    await payments.recordRefund(actor, p.id, 5000, "Scratch on delivery");
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedCents: 5000 });
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: balance.id } })).toMatchObject({ status: "PARTIALLY_PAID" });

    // Customer invoice/order pages.
    const iv = (await customerInvoiceView(balance.publicToken!))!;
    expect(iv).toMatchObject({ number: balance.number, amountDueCents: 5000, payUrl: null });
    expect(JSON.stringify(iv)).not.toContain(balance.id);
    const ov = (await customerOrderView(order.customerToken!))!;
    expect(ov).toMatchObject({ number: "WMO-1001", productionStatus: "DEPOSIT_PAID", balanceCents: 5000 });
    expect(JSON.stringify(ov)).not.toMatch(/productionNotes|"id"/);
    expect(await customerInvoiceView((await prisma.invoice.create({ data: { number: "WMI-9", customerName: "x", customerEmail: "x@x.com", publicToken: "D".repeat(43) } })).publicToken!)).toBeNull(); // drafts hidden
  });

  it("production, delivery and completion updates notify the customer only when asked", async () => {
    const { quote } = await requestQuote();
    await priceDraft(quote.id, undefined, { depositType: "NONE" });
    await quotes.sendQuote(actor, quote.id);
    const order = await quotes.acceptQuote(quote.customerToken!, { revisionNumber: 1, name: "Jamie", agreeTerms: true, agreeDeposit: true }, meta);
    expect(order).toMatchObject({ productionStatus: "QUOTE_ACCEPTED", paymentStatus: "UNPAID" });
    expect(await prisma.invoice.count()).toBe(0); // no deposit → no deposit invoice
    const base: OrderUpdateInput = { productionStatus: "IN_PRODUCTION", deliveryStatus: "NOT_SCHEDULED", deliveryDate: null, deliveryAddress: null, deliveryNotes: null, estimatedCompletion: "March", productionNotes: "Use board #12", customerNotes: null, notifyCustomer: false };
    await orders.updateOrder(actor, order.id, base);
    expect(await prisma.emailLog.count({ where: { template: "order_update" } })).toBe(0);
    await orders.updateOrder(actor, order.id, { ...base, productionStatus: "DELIVERY_SCHEDULED", deliveryStatus: "SCHEDULED", deliveryDate: new Date("2026-11-02T15:00:00Z"), notifyCustomer: true });
    expect(await prisma.emailLog.count({ where: { template: "delivery_scheduled" } })).toBe(1);
    await orders.updateOrder(actor, order.id, { ...base, productionStatus: "COMPLETED", deliveryStatus: "DELIVERED", notifyCustomer: true });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ productionStatus: "COMPLETED", completedAt: expect.any(Date) });
    expect((await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe("COMPLETED");
    expect(await prisma.statusEvent.count({ where: { orderId: order.id } })).toBeGreaterThanOrEqual(4);
  });

  it("Stripe invoicing (flag + keys): creates, finalizes and applies idempotent webhooks", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_x");
    const calls: string[] = [];
    setInvoicingProviderForTests({
      name: "fake",
      ensureCustomer: async (c) => (calls.push(`customer:${c.customerId}`), "cus_123"),
      createAndFinalizeInvoice: async (i) => {
        calls.push(`invoice:${i.number}:${i.lines.map((l) => l.amountCents).join(",")}`);
        const id = i.number === "WMI-1001" ? "in_123" : `in_${i.number}`;
        return { id, status: "open", hostedInvoiceUrl: `https://invoice.stripe.com/i/${id}`, invoicePdfUrl: `https://pay.stripe.com/invoice/${id}/pdf` };
      },
      sendInvoice: async (id) => void calls.push(`send:${id}`),
      voidInvoice: async (id) => void calls.push(`void:${id}`),
    });
    const { quote } = await requestQuote();
    await priceDraft(quote.id);
    await quotes.sendQuote(actor, quote.id);
    const order = await quotes.acceptQuote(quote.customerToken!, { revisionNumber: 1, name: "Jamie", agreeTerms: true, agreeDeposit: true }, meta);
    const deposit = await prisma.invoice.findFirstOrThrow({ where: { orderId: order.id } });

    // Flag off → offline even with keys.
    await prisma.siteSetting.update({ where: { id: "default" }, data: { stripeInvoicingEnabled: true } });
    const res = await invoices.sendInvoice(actor, deposit.id);
    expect(res.via).toBe("wild_mountain"); // option B: our email with the hosted link
    expect(calls).toEqual(["customer:" + order.customerId, `invoice:${deposit.number}:${deposit.totalCents}`]);
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: deposit.id } })).toMatchObject({ status: "OPEN", stripeInvoiceId: "in_123", stripeHostedInvoiceUrl: "https://invoice.stripe.com/i/in_123" });
    expect((await prisma.customer.findFirstOrThrow()).stripeCustomerId).toBe("cus_123");
    expect((await prisma.emailLog.findFirstOrThrow({ where: { template: "deposit_invoice" } })).html).toContain("https://invoice.stripe.com/i/in_123");
    expect((await customerInvoiceView(deposit.publicToken!))!.payUrl).toBe("https://invoice.stripe.com/i/in_123");

    const paid = { id: "evt_1", type: "invoice.paid", data: { object: { id: "in_123", status: "paid", amount_paid: deposit.totalCents, payment_intent: "pi_1", status_transitions: { paid_at: 1_790_000_000 } } } };
    expect(await payments.processStripeEvent(paid)).toBe("processed");
    expect(await payments.processStripeEvent(paid)).toBe("duplicate"); // same event again
    expect(await payments.processStripeEvent({ ...paid, id: "evt_2", type: "invoice.payment_succeeded" })).toBe("processed"); // sibling event, same money
    expect(await prisma.payment.count()).toBe(1);
    expect(await prisma.payment.findFirstOrThrow()).toMatchObject({ source: "STRIPE", method: "STRIPE", amountCents: deposit.totalCents, stripePaymentIntentId: "pi_1" });
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: deposit.id } })).toMatchObject({ status: "PAID", amountPaidCents: deposit.totalCents });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ productionStatus: "DEPOSIT_PAID" });

    // Refund via the Stripe dashboard.
    expect(await payments.processStripeEvent({ id: "evt_3", type: "charge.refunded", data: { object: { id: "ch_1", payment_intent: "pi_1", amount_refunded: 1000 } } })).toBe("processed");
    expect(await prisma.payment.findFirstOrThrow()).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedCents: 1000 });
    // Events for invoices we don't know are ignored.
    expect(await payments.processStripeEvent({ id: "evt_4", type: "invoice.paid", data: { object: { id: "in_other", amount_paid: 5 } } })).toBe("ignored");

    // Option A: Stripe emails the invoice.
    await prisma.siteSetting.update({ where: { id: "default" }, data: { invoiceEmailMode: "STRIPE" } });
    const balance = await prisma.$transaction((tx) => invoices.createInvoiceForOrder(tx, order.id, "BALANCE", actor.id));
    const r2 = await invoices.sendInvoice(actor, balance.id);
    expect(r2).toMatchObject({ via: "stripe", email: null });
    expect(calls.at(-1)).toBe("send:in_WMI-1002");
  });

  it("a Stripe failure leaves the invoice as an unsent draft", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_x");
    setInvoicingProviderForTests({
      name: "broken",
      ensureCustomer: async () => "cus_1",
      createAndFinalizeInvoice: async () => {
        throw new Error("card_declined? no: api down");
      },
      sendInvoice: async () => undefined,
      voidInvoice: async () => undefined,
    });
    await prisma.siteSetting.update({ where: { id: "default" }, data: { stripeInvoicingEnabled: true } });
    const { quote } = await requestQuote();
    await priceDraft(quote.id);
    await quotes.sendQuote(actor, quote.id);
    const order = await quotes.acceptQuote(quote.customerToken!, { revisionNumber: 1, name: "Jamie", agreeTerms: true, agreeDeposit: true }, meta);
    const deposit = await prisma.invoice.findFirstOrThrow({ where: { orderId: order.id } });
    await expect(invoices.sendInvoice(actor, deposit.id)).rejects.toThrow(/still a draft/);
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: deposit.id } })).toMatchObject({ status: "DRAFT", sentAt: null });
    expect(await prisma.emailLog.count({ where: { invoiceId: deposit.id } })).toBe(0);
  });

  it("past-due invoices, duplicate quote and manual acceptance", async () => {
    const { quote } = await requestQuote();
    await priceDraft(quote.id);
    await quotes.sendQuote(actor, quote.id);
    const copy = await quotes.duplicateQuote(actor, quote.id);
    expect(copy).toMatchObject({ number: "WMQ-1002", status: "DRAFT" });
    expect(copy.customerToken).not.toBe(quote.customerToken);
    const copyRev = await prisma.quoteRevision.findUniqueOrThrow({ where: { id: copy.currentRevisionId }, include: { lineItems: true } });
    const origRev = await prisma.quoteRevision.findFirstOrThrow({ where: { quoteId: quote.id } });
    expect(copyRev).toMatchObject({ status: "DRAFT", totalCents: origRev.totalCents, acceptedAt: null, sentAt: null });

    const order = await quotes.acceptQuoteManually(actor, quote.id, "Accepted by phone 10/2");
    const rev = await prisma.quoteRevision.findFirstOrThrow({ where: { quoteId: quote.id } });
    expect(rev).toMatchObject({ status: "ACCEPTED", acceptedManuallyById: actor.id, acceptedIp: null });
    const deposit = await prisma.invoice.findFirstOrThrow({ where: { orderId: order.id } });
    await invoices.sendInvoice(actor, deposit.id);
    await prisma.invoice.update({ where: { id: deposit.id }, data: { dueDate: new Date(Date.now() - 86_400_000) } });
    expect(await markPastDueInvoices()).toBe(1);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: deposit.id } })).status).toBe("PAST_DUE");
  });
});
