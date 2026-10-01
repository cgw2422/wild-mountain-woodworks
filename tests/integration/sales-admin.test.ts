import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("../support/next-request")).nextHeaders);
vi.mock("next/navigation", async () => (await import("../support/next-request")).nextNavigation);
vi.mock("next/cache", async () => (await import("../support/next-request")).nextCache);

const { prisma } = await import("@/lib/db");
const { createSignedInAdmin, resetRequest, jar } = await import("../support/next-request");
const { can } = await import("@/lib/auth/permissions");
const { requirePermission } = await import("@/lib/auth/session");
const sales = await import("@/app/admin/(panel)/sales-actions");
const inbox = await import("@/app/admin/(panel)/inbox-actions");
const { acceptQuoteAction, declineQuoteAction } = await import("@/app/(documents)/quote/[token]/actions");
const webhook = await import("@/app/api/stripe/webhook/route");
const { ensureQuoteReady } = await import("@/lib/sales/quotes");
const { resolveEditContext } = await import("@/lib/admin-bar/context");
const { createConfigurationQuote } = await import("@/lib/services/submissions");
const { RESERVED_PAGE_SLUGS } = await import("@/lib/cms/definitions");
const robots = (await import("@/app/robots")).default;
const { hasTestDb, resetDb, seedRidge } = await import("../support/db");

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function newQuote() {
  const { product, ids } = await seedRidge();
  return createConfigurationQuote({
    name: "Jamie Rivers",
    email: "jamie@example.com",
    phone: null,
    zipCode: "43215",
    timeline: null,
    notes: null,
    productId: product.id,
    selection: { options: { [ids.size]: ids.s60, [ids.wood]: ids.pine }, addOns: {}, customDetails: {} },
  });
}

/** The editor's JSON payload for the current draft, as the browser would send it. */
async function payloadFor(quoteId: string, patch: Record<string, unknown> = {}) {
  const q = await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quoteId }, include: { currentRevision: { include: { lineItems: { orderBy: { position: "asc" } } } } } });
  const r = q.currentRevision!;
  return form({
    payload: JSON.stringify({
      customerName: r.customerName,
      customerEmail: r.customerEmail,
      customerPhone: "",
      customerAddress: "",
      customerNotes: "",
      terms: "Terms",
      expiresOn: "",
      leadTime: "",
      estimatedCompletion: "",
      deliveryDetails: "",
      depositType: "PERCENTAGE",
      depositPercent: "50",
      depositAmountCents: null,
      taxCents: 0,
      lines: r.lineItems.map((l) => ({ sourceId: l.id, kind: l.kind, description: l.description, notes: l.notes, quantity: l.quantity, unitPriceCents: l.unitPriceCents, taxable: l.taxable, productId: l.productId })),
      ...patch,
    }),
  });
}

describe("sales permissions", () => {
  it("gives admins and owners sales + finance, editors neither", () => {
    for (const p of ["sales", "finance"] as const) {
      expect(can("OWNER", p)).toBe(true);
      expect(can("ADMIN", p)).toBe(true);
      expect(can("EDITOR", p)).toBe(false);
    }
  });
});

describe.skipIf(!hasTestDb)("sales admin actions", () => {
  beforeEach(async () => {
    await resetDb();
    resetRequest();
    await prisma.siteSetting.create({ data: { id: "default" } });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("refuses editors on every quote, invoice, payment and customer operation", async () => {
    const quote = await newQuote();
    await createSignedInAdmin({ role: "EDITOR", email: "editor@example.com" });
    await expect(requirePermission("sales")).rejects.toThrow(/REDIRECT \/admin\?denied=1/);
    await expect(requirePermission("finance")).rejects.toThrow(/REDIRECT/);
    const denied = { ok: false, message: expect.stringMatching(/role/) };
    expect(await sales.saveQuoteRevisionAction(quote.id, await payloadFor(quote.id))).toMatchObject(denied);
    expect(await sales.sendQuoteAction(quote.id)).toMatchObject(denied);
    expect(await sales.duplicateQuoteAction(quote.id)).toMatchObject(denied);
    expect(await sales.acceptQuoteManuallyAction(quote.id, form({ note: "by phone" }))).toMatchObject(denied);
    expect(await sales.setQuoteStatusAction(quote.id, form({ status: "CANCELED" }))).toMatchObject(denied);
    expect(await sales.createManualQuoteAction(form({ name: "X Y", email: "x@example.com" }))).toMatchObject(denied);
    expect(await sales.recordPaymentAction("any", form({ amount: "10", method: "CASH", receivedOn: "2026-10-01" }))).toMatchObject(denied);
    expect(await sales.recordRefundAction("any", form({ amount: "10", reason: "x" }))).toMatchObject(denied);
    expect(await sales.updateCustomerAction(quote.customerId!, form({ name: "Hacked", email: "h@example.com" }))).toMatchObject(denied);
    expect(await inbox.addNoteAction("quote", quote.id, form({ body: "hi" }))).toMatchObject({ ok: false });
    expect(await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quote.id } })).toMatchObject({ status: "NEW" });
    expect((await prisma.customer.findFirstOrThrow()).name).toBe("Jamie Rivers");
    expect(await prisma.quoteRequest.count()).toBe(1);
    // Editors get no admin-bar link to sales records either.
    expect((await resolveEditContext(`/quote/${quote.customerToken}`, "EDITOR")).edit).toBeNull();
  });

  it("lets an admin price, send and manually accept a quote, then invoice and record payment", async () => {
    const quote = await newQuote();
    await createSignedInAdmin({ role: "ADMIN", email: "admin@example.com" });
    // Tampered payload: unknown line kind and absurd prices are rejected by the server.
    expect(await sales.saveQuoteRevisionAction(quote.id, await payloadFor(quote.id, { lines: [{ kind: "FREE", description: "x", quantity: 1, unitPriceCents: 1 }] }))).toMatchObject({ ok: false });
    expect(await sales.saveQuoteRevisionAction(quote.id, await payloadFor(quote.id, { lines: [{ kind: "CUSTOM", description: "x", quantity: 1, unitPriceCents: 1e12 }] }))).toMatchObject({ ok: false });
    expect(await sales.saveQuoteRevisionAction(quote.id, await payloadFor(quote.id, { depositPercent: "150" }))).toMatchObject({ ok: false });
    // Browser-sent totals are ignored — the server recomputes.
    expect(await sales.saveQuoteRevisionAction(quote.id, await payloadFor(quote.id, { totalCents: 1, depositCents: 1 }))).toMatchObject({ ok: true });
    const rev = await prisma.quoteRevision.findFirstOrThrow({ where: { quoteId: quote.id } });
    expect(rev.totalCents).toBe(120000);
    expect(rev.depositCents).toBe(60000);

    expect(await sales.sendQuoteAction(quote.id)).toMatchObject({ ok: true });
    expect(await sales.sendQuoteAction(quote.id)).toMatchObject({ ok: false, message: expect.stringMatching(/already sent/) });
    const accepted = await sales.acceptQuoteManuallyAction(quote.id, form({ note: "Accepted by phone" }));
    expect(accepted).toMatchObject({ ok: true, id: expect.any(String) });
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { orderId: accepted.id } });
    // The deposit request is issued at acceptance — there's nothing to "send"; resending emails it again.
    expect(invoice).toMatchObject({ kind: "DEPOSIT", status: "SENT" });
    expect(await sales.sendInvoiceAction(invoice.id)).toMatchObject({ ok: false, message: expect.stringMatching(/already been sent/) });
    expect(await sales.resendInvoiceAction(invoice.id, false)).toMatchObject({ ok: true });
    expect(await sales.recordPaymentAction(invoice.id, form({ amount: "abc", method: "CASH", receivedOn: "2026-10-01" }))).toMatchObject({ ok: false, fieldErrors: { amount: expect.any(String) } });
    expect(await sales.recordPaymentAction(invoice.id, form({ amount: "600", method: "CHECK", receivedOn: "2026-10-01", reference: "1042" }))).toMatchObject({ ok: true });
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).toMatchObject({ status: "PAID" });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: accepted.id } })).toMatchObject({ productionStatus: "DEPOSIT_PAID" });
    // Audit trail for pricing and payments, never secrets.
    const audit = await prisma.activityLog.findMany({ select: { type: true, message: true } });
    expect(audit.map((a) => a.type)).toEqual(expect.arrayContaining(["quote.sent", "quote.accepted", "invoice.sent", "payment.recorded"]));
    expect(JSON.stringify(audit)).not.toContain(quote.customerToken!);

    // Admin bar links the customer pages back to admin.
    expect((await resolveEditContext(`/quote/${quote.customerToken}`, "ADMIN")).edit).toMatchObject({ label: "Open Quote In Admin", href: `/admin/quotes/${quote.id}` });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: accepted.id } });
    expect((await resolveEditContext(`/order/${order.customerToken}`, "ADMIN")).edit).toMatchObject({ label: "Open Order In Admin" });
  });

  it("customer accept/decline actions validate input and never trust the browser", async () => {
    const quote = await newQuote();
    await createSignedInAdmin({ role: "OWNER" });
    await sales.saveQuoteRevisionAction(quote.id, await payloadFor(quote.id));
    await sales.sendQuoteAction(quote.id);
    jar.clear(); // the customer is anonymous
    expect(await acceptQuoteAction("bad-token", form({ revision: "1", name: "Jamie", agreeTerms: "on", agreeDeposit: "on" }))).toMatchObject({ status: "error", message: /not valid/ });
    expect(await acceptQuoteAction(quote.customerToken!, form({ revision: "1", name: "Jamie" }))).toMatchObject({ status: "error", fieldErrors: { agreeTerms: expect.any(String), agreeDeposit: expect.any(String) } });
    expect(await acceptQuoteAction(quote.customerToken!, form({ revision: "2", name: "Jamie", agreeTerms: "on", agreeDeposit: "on" }))).toMatchObject({ status: "error", message: /updated/ });
    expect(await declineQuoteAction(quote.customerToken!, form({ revision: "1", reason: "x".repeat(1001) }))).toMatchObject({ status: "error" });
    // A price in the form is ignored entirely.
    const ok = await acceptQuoteAction(quote.customerToken!, form({ revision: "1", name: "Jamie Rivers", agreeTerms: "on", agreeDeposit: "on", totalCents: "1" }));
    expect(ok).toMatchObject({ status: "success", reference: "WMO-1001" });
    expect(await prisma.order.findFirstOrThrow()).toMatchObject({ totalCents: 120000 });
    const rev = await prisma.quoteRevision.findFirstOrThrow({ where: { quoteId: quote.id } });
    expect(rev).toMatchObject({ acceptedIp: "203.0.113.9", acceptedUserAgent: "vitest" });
  });

  it("migrates a legacy quote (no number, token, customer or revision) on first open", async () => {
    const legacy = await prisma.quoteRequest.create({
      data: { reference: "WM-Q-260901-ABCD", status: "REVIEWING", name: "Old Customer", email: "Old@Example.com", zipCode: "43215", productName: "Bench", estimatedTotalCents: 50000 },
    });
    await prisma.counter.create({ data: { key: "quote", value: 1004 } });
    const ready = await ensureQuoteReady(legacy.id);
    expect(ready).toMatchObject({ number: "WMQ-1005", customerToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    const q = await prisma.quoteRequest.findUniqueOrThrow({ where: { id: legacy.id }, include: { customer: true, revisions: true } });
    expect(q.reference).toBe("WM-Q-260901-ABCD"); // kept for old emails
    expect(q.customer).toMatchObject({ email: "old@example.com" });
    expect(q.revisions).toHaveLength(1);
    expect(q.revisions[0]).toMatchObject({ number: 1, status: "DRAFT" });
    // Idempotent.
    expect(await ensureQuoteReady(legacy.id)).toMatchObject({ number: "WMQ-1005" });
    expect(await prisma.quoteRevision.count()).toBe(1);
  });

  it("the Stripe webhook is inert without a secret and rejects bad signatures", async () => {
    const body = JSON.stringify({ id: "evt_1", type: "invoice.paid", data: { object: { id: "in_1" } } });
    expect((await webhook.POST(new Request("http://x/api/stripe/webhook", { method: "POST", body }))).status).toBe(404);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
    const bad = await webhook.POST(new Request("http://x/api/stripe/webhook", { method: "POST", body, headers: { "stripe-signature": `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}` } }));
    expect(bad.status).toBe(400);
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", "whsec_test").update(`${t}.${body}`).digest("hex");
    const good = await webhook.POST(new Request("http://x/api/stripe/webhook", { method: "POST", body, headers: { "stripe-signature": `t=${t},v1=${sig}` } }));
    expect(good.status).toBe(200);
    expect(await good.json()).toMatchObject({ received: true, result: "ignored" }); // unknown invoice
    const again = await webhook.POST(new Request("http://x/api/stripe/webhook", { method: "POST", body, headers: { "stripe-signature": `t=${t},v1=${sig}` } }));
    expect(await again.json()).toMatchObject({ result: "duplicate" });
  });

  it("keeps customer documents out of search and CMS page slugs", () => {
    for (const slug of ["quote", "invoice", "order", "cart", "checkout"]) expect(RESERVED_PAGE_SLUGS.has(slug)).toBe(true);
    const rules = robots().rules as { disallow: string[] }[];
    expect(rules[0]!.disallow).toEqual(expect.arrayContaining(["/quote/", "/invoice/", "/order/"]));
  });
});
