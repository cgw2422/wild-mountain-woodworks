import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RevisionInput } from "@/lib/sales/quotes";
import type { OrderUpdateInput } from "@/lib/sales/orders";

vi.mock("next/headers", async () => (await import("../support/next-request")).nextHeaders);
vi.mock("next/navigation", async () => (await import("../support/next-request")).nextNavigation);
vi.mock("next/cache", async () => (await import("../support/next-request")).nextCache);

const { prisma } = await import("@/lib/db");
const { createSignedInAdmin, resetRequest, jar } = await import("../support/next-request");
const { createConfigurationQuote } = await import("@/lib/services/submissions");
const quotes = await import("@/lib/sales/quotes");
const invoices = await import("@/lib/sales/invoices");
const payments = await import("@/lib/sales/payments");
const orders = await import("@/lib/sales/orders");
const { startDepositCheckout } = await import("@/lib/sales/checkout");
const { loadCustomerQuote, customerInvoiceView } = await import("@/lib/sales/views");
const { quoteListWhere, invoiceListWhere } = await import("@/lib/sales/list-filters");
const { voidReasonText } = await import("@/lib/sales/voiding");
const { setInvoicingProviderForTests } = await import("@/lib/sales/stripe");
const sales = await import("@/app/admin/(panel)/sales-actions");
const { acceptQuoteAction } = await import("@/app/(documents)/quote/[token]/actions");
const { hasTestDb, resetDb, seedRidge } = await import("../support/db");
const { fakeStripe } = await import("../support/fake-stripe");

const meta = { ip: "198.51.100.7", userAgent: "test" };
const accept = { name: "Jamie Rivers", agreeTerms: true, agreeDeposit: true };
let actor: { id: string; name: string };
let seeded: Awaited<ReturnType<typeof seedRidge>> | null = null;

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function draftQuote(email = "jamie@example.com", name = "Jamie Rivers") {
  seeded ??= await seedRidge();
  const { product, ids } = seeded;
  return createConfigurationQuote({ name, email, phone: null, zipCode: "43215", timeline: null, notes: null, address: "12 Oak St", productId: product.id, selection: { options: { [ids.size]: ids.s60, [ids.wood]: ids.pine }, addOns: {}, customDetails: {} } });
}

async function price(quoteId: string, unitPriceCents = 100000, deposit: Partial<RevisionInput> = {}) {
  const rev = (await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quoteId }, include: { currentRevision: true } })).currentRevision!;
  await quotes.saveRevision(actor, quoteId, {
    customerName: rev.customerName, customerEmail: rev.customerEmail, customerPhone: null, customerAddress: "12 Oak St", customerNotes: null, terms: null, expiresAt: null, leadTime: null, estimatedCompletion: null, deliveryDetails: null,
    depositType: "PERCENTAGE", depositPercentBps: 5000, depositAmountCents: null, taxCents: 0,
    lines: [{ sourceId: null, kind: "PRODUCT", description: "Table", notes: null, quantity: 1, unitPriceCents, taxable: false, productId: null }],
    ...deposit,
  });
}

async function sentQuote(email?: string, name?: string) {
  const q = await draftQuote(email, name);
  await price(q.id);
  await quotes.sendQuote(actor, q.id);
  return prisma.quoteRequest.findUniqueOrThrow({ where: { id: q.id } });
}

const cancelOrder: OrderUpdateInput = { productionStatus: "CANCELED", deliveryStatus: "NOT_SCHEDULED", deliveryDate: null, deliveryAddress: null, deliveryNotes: null, estimatedCompletion: null, productionNotes: null, customerNotes: null, notifyCustomer: false };

describe("void reasons", () => {
  it("accepts the listed reasons and needs details for Other", () => {
    expect(voidReasonText("Pricing mistake", "")).toBe("Pricing mistake");
    expect(voidReasonText("Customer canceled", "Moved out of state")).toBe("Customer canceled — Moved out of state");
    expect(() => voidReasonText("Other", "")).toThrow(/Describe/);
    expect(voidReasonText("Other", "Wrong customer")).toBe("Other — Wrong customer");
    expect(() => voidReasonText("Because", "")).toThrow(/Choose a reason/);
  });
});

describe.skipIf(!hasTestDb)("quotes and invoices are voided, never deleted", () => {
  beforeEach(async () => {
    await resetDb();
    resetRequest();
    seeded = null;
    await prisma.siteSetting.create({ data: { id: "default" } });
    const a = await prisma.adminUser.create({ data: { email: "owner@example.com", name: "Owner", role: "OWNER" } });
    actor = { id: a.id, name: a.name };
  });
  afterEach(() => {
    setInvoicingProviderForTests(null);
    vi.unstubAllEnvs();
  });

  it("the database refuses to hard-delete quotes, revisions, invoices, payments, orders and audit history", async () => {
    const q = await sentQuote();
    const { order } = await quotes.acceptQuote(q.customerToken!, { ...accept, revisionNumber: 1 }, meta);
    const deposit = await prisma.invoice.findFirstOrThrow({ where: { orderId: order.id } });
    const payment = await payments.recordManualPayment(actor, { invoiceId: deposit.id, amountCents: 1000, method: "CASH", receivedAt: new Date(), reference: null, notes: null, sendReceipt: false });
    const permanent = /permanent business records/;
    await expect(prisma.quoteRequest.delete({ where: { id: q.id } })).rejects.toThrow(permanent);
    await expect(prisma.quoteRequest.deleteMany({})).rejects.toThrow(permanent);
    await expect(prisma.quoteRevision.deleteMany({ where: { quoteId: q.id } })).rejects.toThrow(permanent);
    await expect(prisma.invoice.delete({ where: { id: deposit.id } })).rejects.toThrow(permanent);
    await expect(prisma.payment.delete({ where: { id: payment.id } })).rejects.toThrow(permanent);
    await expect(prisma.order.delete({ where: { id: order.id } })).rejects.toThrow(permanent);
    await expect(prisma.orderItem.deleteMany({ where: { orderId: order.id } })).rejects.toThrow(permanent);
    await expect(prisma.statusEvent.deleteMany({ where: { quoteRequestId: q.id } })).rejects.toThrow(permanent);
    await expect(prisma.activityLog.deleteMany({})).rejects.toThrow(permanent);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "Invoice"`)).rejects.toThrow(permanent);
    // Even a bare invoice with nothing attached can't be deleted.
    const bare = await prisma.invoice.create({ data: { number: "WMI-9999", customerName: "x", customerEmail: "x@example.com" } });
    await expect(prisma.invoice.delete({ where: { id: bare.id } })).rejects.toThrow(permanent);
    // Lines of what the customer saw are permanent too.
    await expect(prisma.quoteLineItem.deleteMany({ where: { revision: { quoteId: q.id } } })).rejects.toThrow(/sent quote revision/);
    await expect(prisma.invoiceLineItem.deleteMany({ where: { invoiceId: deposit.id } })).rejects.toThrow(/issued invoice/);
    expect(await prisma.quoteRequest.count()).toBe(1);
    expect(await prisma.invoice.count()).toBe(2);
    expect(await prisma.payment.count()).toBe(1);
    expect(await prisma.order.count()).toBe(1);
    // There is no delete action for any of them in the admin.
    for (const name of Object.keys(sales)) expect(name, name).not.toMatch(/delete|remove(?!SalesAttachment)/i);
  });

  it("drafts can still be edited (their lines are replaced, not the record)", async () => {
    const q = await draftQuote();
    await price(q.id, 100000);
    await price(q.id, 120000);
    expect((await prisma.quoteRevision.findFirstOrThrow({ where: { quoteId: q.id } })).totalCents).toBe(120000);
  });

  it("voiding a quote keeps everything, records who/when/why, and blocks acceptance, sending and changes", async () => {
    const q = await sentQuote();
    const loaded = (await loadCustomerQuote(q.customerToken!))!;
    await quotes.recordQuoteView(loaded.internal.quoteId, loaded.internal.revisionId!, meta);
    await createSignedInAdmin({ role: "ADMIN", email: "staff@example.com" });
    const staff = await prisma.adminUser.findUniqueOrThrow({ where: { email: "staff@example.com" } });

    expect(await sales.voidQuoteAction(q.id, form({ reason: "Other" }))).toMatchObject({ ok: false, fieldErrors: { details: expect.any(String) } });
    expect(await sales.voidQuoteAction(q.id, form({ reason: "Replaced by new quote", details: "See WMQ-1002" }))).toMatchObject({ ok: true });

    const v = await prisma.quoteRequest.findUniqueOrThrow({ where: { id: q.id }, include: { revisions: { include: { lineItems: true } }, statusEvents: true, customer: true } });
    expect(v).toMatchObject({ status: "VOIDED", voidedById: staff.id, voidReason: "Replaced by new quote — See WMQ-1002", voidedFromStatus: "VIEWED", voidedAt: expect.any(Date) });
    expect(v.revisions).toHaveLength(1);
    expect(v.revisions[0]).toMatchObject({ status: "SENT", viewedAt: expect.any(Date), sentAt: expect.any(Date) });
    expect(v.revisions[0]!.lineItems).toHaveLength(1);
    expect(v.customer).not.toBeNull();
    expect(v.statusEvents.at(-1)).toMatchObject({ fromStatus: "VIEWED", toStatus: "VOIDED", authorId: staff.id });
    const log = await prisma.activityLog.findFirstOrThrow({ where: { type: "quote.voided" } });
    expect(log).toMatchObject({ actorId: staff.id, entityId: q.id, createdAt: expect.any(Date) });
    expect(log.message).toContain("Replaced by new quote");

    // The customer sees it as no longer valid; nothing can be accepted.
    const view = (await loadCustomerQuote(q.customerToken!))!.view;
    expect(view).toMatchObject({ voided: true, status: "VOIDED", blocker: expect.stringMatching(/no longer valid/) });
    jar.clear();
    expect(await acceptQuoteAction(q.customerToken!, form({ revision: "1", name: "Jamie", agreeTerms: "on", agreeDeposit: "on" }))).toMatchObject({ status: "error", message: expect.stringMatching(/no longer valid/) });
    await expect(quotes.acceptQuote(q.customerToken!, { ...accept, revisionNumber: 1 }, meta)).rejects.toThrow(/no longer valid/);
    await expect(quotes.acceptQuoteManually(actor, q.id, "by phone")).rejects.toThrow(/voided/);
    await expect(quotes.resendQuote(actor, q.id)).rejects.toThrow(/voided/);
    await expect(quotes.createRevision(actor, q.id)).rejects.toThrow(/voided/);
    await expect(quotes.extendQuote(actor, q.id, new Date(Date.now() + 86_400_000 * 5))).rejects.toThrow(/voided/);
    await expect(quotes.setQuoteStatus(actor, q.id, "REVIEWING", null)).rejects.toThrow(/voided/);
    await expect(quotes.voidQuote(actor, q.id, "Duplicate record")).rejects.toThrow(/already voided/);
    expect(await prisma.order.count()).toBe(0);
    // Duplicating is the way forward: new number, new link.
    const copy = await quotes.duplicateQuote(actor, q.id);
    expect(copy.number).toBe("WMQ-1002");
  });

  it("a quote with a live order or active invoice can't be voided until those are dealt with; then nothing can be invoiced from it", async () => {
    const q = await sentQuote();
    const { order } = await quotes.acceptQuote(q.customerToken!, { ...accept, revisionNumber: 1 }, meta);
    await expect(quotes.voidQuote(actor, q.id, "Customer canceled")).rejects.toThrow(/Order WMO-1001/);
    await orders.updateOrder(actor, order.id, cancelOrder);
    await expect(quotes.voidQuote(actor, q.id, "Customer canceled")).rejects.toThrow(/Invoice WMI-1001 is still active/);
    const deposit = await prisma.invoice.findFirstOrThrow({ where: { orderId: order.id } });
    await invoices.voidInvoice(actor, deposit.id, "Customer canceled");
    await quotes.voidQuote(actor, q.id, "Customer canceled");
    expect((await prisma.quoteRequest.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("VOIDED");
    // Accepted history is preserved.
    expect(await prisma.quoteRevision.findFirstOrThrow({ where: { quoteId: q.id } })).toMatchObject({ status: "ACCEPTED", acceptedName: "Jamie Rivers", acceptedSnapshot: expect.anything() });
    // An accepted-then-voided quote can't be reopened (ambiguous) — duplicate instead.
    await expect(quotes.reopenQuote(actor, q.id)).rejects.toThrow(/Duplicate it/);
  });

  it("nothing can be invoiced from a voided quote", async () => {
    const q = await sentQuote();
    const { order } = await quotes.acceptQuote(q.customerToken!, { ...accept, revisionNumber: 1 }, meta);
    // Even if a quote were voided behind an open order, invoicing refuses it.
    await prisma.quoteRequest.update({ where: { id: q.id }, data: { status: "VOIDED" } });
    await expect(prisma.$transaction((tx) => invoices.createInvoiceForOrder(tx, order.id, "BALANCE", actor.id))).rejects.toThrow(/voided/);
    await expect(invoices.createCustomInvoice(actor, { customerId: order.customerId!, orderId: order.id, lines: [{ kind: "CUSTOM", description: "Extra", quantity: 1, unitPriceCents: 1000, taxable: false }], dueDate: null, customerNotes: null })).rejects.toThrow(/voided/);
  });

  it("owners/admins can reopen a voided quote when it's safe; editors can't void or reopen", async () => {
    const q = await sentQuote();
    await quotes.voidQuote(actor, q.id, "Created in error");
    await createSignedInAdmin({ role: "EDITOR", email: "editor@example.com" });
    expect(await sales.reopenQuoteAction(q.id)).toMatchObject({ ok: false });
    expect(await sales.voidQuoteAction(q.id, form({ reason: "Pricing mistake" }))).toMatchObject({ ok: false });
    await createSignedInAdmin({ role: "ADMIN", email: "admin2@example.com" });
    expect(await sales.reopenQuoteAction(q.id)).toMatchObject({ ok: true });
    expect(await prisma.quoteRequest.findUniqueOrThrow({ where: { id: q.id } })).toMatchObject({ status: "SENT", voidedAt: null, voidReason: null });
    expect(await prisma.activityLog.count({ where: { type: "quote.reopened" } })).toBe(1);
    expect((await loadCustomerQuote(q.customerToken!))!.view.blocker).toBeNull();
    // The void stays in the history.
    expect(await prisma.statusEvent.count({ where: { quoteRequestId: q.id, toStatus: "VOIDED" } })).toBe(1);
    expect(await prisma.activityLog.count({ where: { type: "quote.voided" } })).toBe(1);
  });

  it("a superseded revision is kept and viewable but can't be accepted or invoiced", async () => {
    const q = await sentQuote();
    await quotes.createRevision(actor, q.id);
    await price(q.id, 130000);
    await quotes.sendQuote(actor, q.id);
    const r1 = await prisma.quoteRevision.findFirstOrThrow({ where: { quoteId: q.id, number: 1 }, include: { lineItems: true } });
    expect(r1).toMatchObject({ status: "SUPERSEDED", totalCents: 100000, sentAt: expect.any(Date) });
    expect(r1.lineItems[0]).toMatchObject({ unitPriceCents: 100000 });
    expect(await prisma.activityLog.findFirstOrThrow({ where: { type: "quote.superseded" } })).toMatchObject({ entityId: q.id, message: expect.stringContaining("rev 1 superseded by rev 2") });
    await expect(quotes.acceptQuote(q.customerToken!, { ...accept, revisionNumber: 1 }, meta)).rejects.toThrow(/updated/);
    const { order } = await quotes.acceptQuote(q.customerToken!, { ...accept, revisionNumber: 2 }, meta);
    // Only the accepted revision is ever invoiced.
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { acceptedRevision: true } });
    expect(o.acceptedRevision!.number).toBe(2);
    expect(o.totalCents).toBe(130000);
    expect(await prisma.invoice.count({ where: { revisionId: r1.id } })).toBe(0);
  });

  it("a voided invoice can't take new payments, and payment history survives the void", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_x");
    const stripe = fakeStripe();
    setInvoicingProviderForTests(stripe.provider);
    await prisma.siteSetting.update({ where: { id: "default" }, data: { stripeInvoicingEnabled: true } });
    const q = await sentQuote();
    const { order } = await quotes.acceptQuote(q.customerToken!, { ...accept, revisionNumber: 1 }, meta);
    const deposit = await prisma.invoice.findFirstOrThrow({ where: { orderId: order.id } });

    // Paid → can't be voided (would make the history inconsistent).
    const p = await payments.recordManualPayment(actor, { invoiceId: deposit.id, amountCents: 20000, method: "CHECK", receivedAt: new Date(), reference: "1042", notes: null, sendReceipt: false });
    await expect(invoices.voidInvoice(actor, deposit.id, "Created in error")).rejects.toThrow(/has payments/);
    // After a full refund it can be voided — the payment and refund stay on record.
    await payments.recordRefund(actor, p.id, 20000, "Customer canceled");
    await createSignedInAdmin({ role: "OWNER", email: "boss@example.com" });
    const boss = await prisma.adminUser.findUniqueOrThrow({ where: { email: "boss@example.com" } });
    expect(await sales.voidInvoiceAction(deposit.id, form({ reason: "Customer canceled" }))).toMatchObject({ ok: true });
    const v = await prisma.invoice.findUniqueOrThrow({ where: { id: deposit.id }, include: { payments: true, lineItems: true } });
    expect(v).toMatchObject({ status: "VOID", number: "WMI-1001", voidedById: boss.id, voidReason: "Customer canceled", voidedAt: expect.any(Date), orderId: order.id, quoteId: q.id });
    expect(v.lineItems).toHaveLength(1);
    expect(v.payments).toEqual([expect.objectContaining({ id: p.id, amountCents: 20000, refundedCents: 20000, status: "REFUNDED", reference: "1042" })]);
    expect(await prisma.activityLog.findFirstOrThrow({ where: { type: "invoice.voided" } })).toMatchObject({ actorId: boss.id, message: expect.stringContaining("Reason: Customer canceled") });

    // No new money can be taken against it.
    await expect(payments.recordManualPayment(actor, { invoiceId: deposit.id, amountCents: 100, method: "CASH", receivedAt: new Date(), reference: null, notes: null, sendReceipt: false })).rejects.toThrow(/void/);
    expect(await startDepositCheckout(order.customerToken!)).toEqual({ kind: "nothing_due" });
    expect(await sales.resendDepositLinkAction(deposit.id)).toMatchObject({ ok: false });
    expect((await customerInvoiceView(deposit.publicToken!))!).toMatchObject({ voided: true, payUrl: null, paymentInstructions: null });
    expect(stripe.calls.filter((c) => c.startsWith("checkout:"))).toEqual([]);
    // It stays in the customer's history on the quote page, marked void with nothing to pay.
    expect((await loadCustomerQuote(q.customerToken!))!.view.invoices).toEqual([expect.objectContaining({ number: "WMI-1001", status: "VOID", payUrl: null })]);
  });

  it("voiding a Stripe-backed invoice voids it in Stripe too", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_x");
    const stripe = fakeStripe();
    setInvoicingProviderForTests(stripe.provider);
    const q = await sentQuote();
    const { order } = await quotes.acceptQuote(q.customerToken!, { ...accept, revisionNumber: 1 }, meta);
    await prisma.siteSetting.update({ where: { id: "default" }, data: { stripeInvoicingEnabled: true } });
    const deposit = await prisma.invoice.findFirstOrThrow({ where: { orderId: order.id } });
    await payments.recordManualPayment(actor, { invoiceId: deposit.id, amountCents: deposit.totalCents, method: "CHECK", receivedAt: new Date(), reference: null, notes: null, sendReceipt: false });
    const balance = await prisma.$transaction((tx) => invoices.createInvoiceForOrder(tx, order.id, "BALANCE", actor.id));
    await invoices.sendInvoice(actor, balance.id);
    await invoices.voidInvoice(actor, balance.id, "Pricing mistake");
    expect(stripe.calls).toContain("void:in_1");
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: balance.id } })).toMatchObject({ status: "VOID", stripeInvoiceId: "in_1", stripeHostedInvoiceUrl: expect.any(String) });
    expect((await customerInvoiceView(balance.publicToken!))!.payUrl).toBeNull();
    // A replacement gets a new number; the voided one keeps its own.
    const replacement = await prisma.$transaction((tx) => invoices.createInvoiceForOrder(tx, order.id, "BALANCE", actor.id));
    expect(replacement.number).toBe("WMI-1003");
    expect(replacement.totalCents).toBe(balance.totalCents);
  });

  it("numbers are never reused after voiding", async () => {
    const a = await sentQuote();
    await quotes.voidQuote(actor, a.id, "Duplicate record");
    const b = await sentQuote("b@example.com", "Bo Bailey");
    expect([a.number, b.number]).toEqual(["WMQ-1001", "WMQ-1002"]);

    const { order } = await quotes.acceptQuote(b.customerToken!, { ...accept, revisionNumber: 1 }, meta);
    const deposit = await prisma.invoice.findFirstOrThrow({ where: { orderId: order.id } });
    await invoices.voidInvoice(actor, deposit.id, "Created in error");
    const again = await prisma.$transaction((tx) => invoices.createInvoiceForOrder(tx, order.id, "DEPOSIT", actor.id));
    expect([deposit.number, again.number]).toEqual(["WMI-1001", "WMI-1002"]);

    await orders.updateOrder(actor, order.id, cancelOrder);
    const c = await sentQuote("c@example.com", "Cy Cole");
    const { order: order2 } = await quotes.acceptQuote(c.customerToken!, { ...accept, revisionNumber: 1 }, meta);
    expect([order.number, order2.number]).toEqual(["WMO-1001", "WMO-1002"]);
    expect(c.number).toBe("WMQ-1003");
  });

  it("voided records stay out of the active view but are always searchable", async () => {
    const live = await sentQuote("live@example.com", "Lee Live");
    const gone = await sentQuote("gone@example.com", "Gwen Gone");
    const { order } = await quotes.acceptQuote(gone.customerToken!, { ...accept, revisionNumber: 1 }, meta);
    const deposit = await prisma.invoice.findFirstOrThrow({ where: { orderId: order.id } });
    await orders.updateOrder(actor, order.id, cancelOrder);
    await invoices.voidInvoice(actor, deposit.id, "Customer canceled");
    await quotes.voidQuote(actor, gone.id, "Customer canceled");

    const numbers = async (where: Parameters<typeof prisma.quoteRequest.findMany>[0]) => (await prisma.quoteRequest.findMany(where)).map((r) => r.number).sort();
    expect(await numbers({ where: quoteListWhere("", "") })).toEqual([live.number]);
    expect(await numbers({ where: quoteListWhere("voided", "") })).toEqual([gone.number]);
    expect(await numbers({ where: quoteListWhere("all", "") })).toEqual([live.number, gone.number].sort());
    for (const term of [gone.number!, "Gwen Gone", "gone@example.com", order.number, deposit.number]) {
      expect(await numbers({ where: quoteListWhere("", term) }), term).toEqual([gone.number]);
    }

    const invNumbers = async (tab: string, q: string) => (await prisma.invoice.findMany({ where: invoiceListWhere(tab, q) })).map((i) => i.number);
    expect(await invNumbers("", "")).toEqual([]);
    expect(await invNumbers("void", "")).toEqual([deposit.number]);
    for (const term of [deposit.number, order.number, gone.number!, "gone@example.com", "Gwen"]) expect(await invNumbers("", term), term).toEqual([deposit.number]);
  });
});
