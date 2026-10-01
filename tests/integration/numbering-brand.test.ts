import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("../support/next-request")).nextHeaders);
vi.mock("next/navigation", async () => (await import("../support/next-request")).nextNavigation);
vi.mock("next/cache", async () => (await import("../support/next-request")).nextCache);

const { prisma } = await import("@/lib/db");
const { resetRequest } = await import("../support/next-request");
const { createConfigurationQuote } = await import("@/lib/services/submissions");
const quotes = await import("@/lib/sales/quotes");
const invoices = await import("@/lib/sales/invoices");
const orders = await import("@/lib/sales/orders");
const checkout = await import("@/lib/sales/checkout");
const { nextNumber, NUMBER_PREFIXES, FIRST_NUMBER, QUOTE_NUMBER_PATTERN } = await import("@/lib/sales/numbers");
const { quoteSearch, invoiceSearch, orderSearch } = await import("@/lib/sales/list-filters");
const { customerInvoiceView, customerOrderView, loadCustomerQuote } = await import("@/lib/sales/views");
const { EMAIL_TEMPLATES } = await import("@/lib/email/template-definitions");
const { setInvoicingProviderForTests } = await import("@/lib/sales/stripe");
const { hasTestDb, resetDb, seedRidge } = await import("../support/db");
const { fakeStripe } = await import("../support/fake-stripe");

/** "Wild Mountain" on its own (not followed by "Woodworks"). */
const SHORT_NAME = /Wild Mountain(?! Woodworks)(?![\w])/;

const meta = { ip: "198.51.100.7", userAgent: "Mozilla/5.0 test" };
let actor: { id: string; name: string };
let seeded: Awaited<ReturnType<typeof seedRidge>> | null = null;

async function newQuote(sent = true) {
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
  if (!sent) return quote;
  const rev = (await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quote.id }, include: { currentRevision: true } })).currentRevision!;
  await quotes.saveRevision(actor, quote.id, {
    customerName: rev.customerName,
    customerEmail: rev.customerEmail,
    customerPhone: rev.customerPhone,
    customerAddress: rev.customerAddress,
    customerNotes: null,
    terms: null,
    expiresAt: null,
    leadTime: null,
    estimatedCompletion: null,
    deliveryDetails: null,
    depositType: "PERCENTAGE",
    depositPercentBps: 5000,
    depositAmountCents: null,
    taxCents: 0,
    lines: [{ sourceId: null, kind: "PRODUCT", description: "The Ridge Dining Table", notes: null, quantity: 1, unitPriceCents: 156900, taxable: false, productId: null }],
  });
  await quotes.sendQuote(actor, quote.id);
  return prisma.quoteRequest.findUniqueOrThrow({ where: { id: quote.id } });
}

async function accepted() {
  const quote = await newQuote();
  const r = await quotes.acceptQuote(quote.customerToken!, { revisionNumber: 1, name: "Jamie Rivers", agreeTerms: true, agreeDeposit: true }, meta);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: r.order.id } });
  const invoice = await prisma.invoice.findFirstOrThrow({ where: { orderId: order.id } });
  return { quote, order, invoice };
}

describe("number formats", () => {
  it("issues WMWQ / WMWO / WMWI numbers from 2001 and still recognizes historical quote numbers", () => {
    expect(NUMBER_PREFIXES).toEqual({ quote: "WMWQ", order: "WMWO", invoice: "WMWI" });
    expect(FIRST_NUMBER).toBe(2001);
    for (const ok of ["WMWQ-2001", "WMWQ-12345", "WMQ-1001"]) expect(QUOTE_NUMBER_PATTERN.test(ok)).toBe(true);
    for (const bad of ["WMW-Q-2001", "Q-2001", "WMWO-2001", "WMWQ-1"]) expect(QUOTE_NUMBER_PATTERN.test(bad)).toBe(false);
  });
});

describe.skipIf(!hasTestDb)("WMW numbering", () => {
  beforeEach(async () => {
    await resetDb();
    resetRequest();
    seeded = null;
    await prisma.siteSetting.create({ data: { id: "default" } });
    const a = await prisma.adminUser.create({ data: { email: "owner@example.com", name: "Owner", role: "OWNER" } });
    actor = { id: a.id, name: a.name };
  });

  it("starts each sequence at 2001 and keeps them independent", async () => {
    const q1 = await newQuote(false);
    const q2 = await newQuote(false);
    expect([q1.number, q2.number]).toEqual(["WMWQ-2001", "WMWQ-2002"]);
    // Two quotes already issued — the first order and invoice still start at 2001.
    const { quote, order, invoice } = await accepted();
    expect(quote.number).toBe("WMWQ-2003");
    expect(order.number).toBe("WMWO-2001");
    expect(invoice.number).toBe("WMWI-2001");
    const second = await accepted();
    expect([second.quote.number, second.order.number, second.invoice.number]).toEqual(["WMWQ-2004", "WMWO-2002", "WMWI-2002"]);
    // New quotes reuse their number as the legacy reference.
    expect(q1.reference).toBe("WMWQ-2001");
  });

  it("never renumbers historical records, and both formats stay searchable", async () => {
    // A production database as it was before this change.
    await prisma.counter.createMany({ data: [{ key: "quote", value: 1001 }, { key: "order", value: 1001 }, { key: "invoice", value: 1001 }] });
    const oldQuote = await prisma.quoteRequest.create({ data: { reference: "WM-Q-260901-ABCD", number: "WMQ-1001", status: "ACCEPTED", name: "Pat Lee", email: "pat@example.com", zipCode: "43215" } });
    const oldOrder = await prisma.order.create({ data: { number: "WMO-1001", quoteId: oldQuote.id, customerName: "Pat Lee", customerEmail: "pat@example.com", subtotalCents: 100000, totalCents: 100000 } });
    const oldInvoice = await prisma.invoice.create({ data: { number: "WMI-1001", orderId: oldOrder.id, quoteId: oldQuote.id, status: "PAID", customerName: "Pat Lee", customerEmail: "pat@example.com", totalCents: 100000, amountPaidCents: 100000 } });

    const fresh = await accepted();
    expect([fresh.quote.number, fresh.order.number, fresh.invoice.number]).toEqual(["WMWQ-2001", "WMWO-2001", "WMWI-2001"]);
    expect((await prisma.quoteRequest.findUniqueOrThrow({ where: { id: oldQuote.id } })).number).toBe("WMQ-1001");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: oldOrder.id } })).number).toBe("WMO-1001");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: oldInvoice.id } })).number).toBe("WMI-1001");
    // The retired counters are left exactly as they were.
    expect(await prisma.counter.findMany({ where: { key: { in: ["quote", "order", "invoice"] } }, orderBy: { key: "asc" } })).toEqual([
      { key: "invoice", value: 1001 },
      { key: "order", value: 1001 },
      { key: "quote", value: 1001 },
    ]);

    const find = {
      quote: async (q: string) => (await prisma.quoteRequest.findMany({ where: quoteSearch(q) })).map((r) => r.number),
      order: async (q: string) => (await prisma.order.findMany({ where: orderSearch(q) })).map((r) => r.number),
      invoice: async (q: string) => (await prisma.invoice.findMany({ where: invoiceSearch(q) })).map((r) => r.number),
    };
    expect(await find.quote("WMWQ-2001")).toEqual(["WMWQ-2001"]);
    expect(await find.quote("wmq-1001")).toEqual(["WMQ-1001"]);
    expect(await find.order("WMWO-2001")).toEqual(["WMWO-2001"]);
    expect(await find.order("WMO-1001")).toEqual(["WMO-1001"]);
    expect(await find.invoice("WMWI-2001")).toEqual(["WMWI-2001"]);
    expect(await find.invoice("WMI-1001")).toEqual(["WMI-1001"]);
  });

  it("never reuses voided, canceled or superseded numbers", async () => {
    const q1 = await newQuote();
    await quotes.voidQuote(actor, q1.id, "Created in error");
    expect((await newQuote(false)).number).toBe("WMWQ-2002");

    const first = await accepted(); // WMWQ-2003, WMWO-2001, WMWI-2001
    await orders.updateOrder(actor, first.order.id, { productionStatus: "CANCELED", deliveryDate: null, deliveryAddress: null, deliveryNotes: null, estimatedCompletion: null, productionNotes: null, customerNotes: null, notifyCustomer: false });
    await invoices.voidInvoice(actor, first.invoice.id, "Customer canceled");
    const next = await accepted();
    expect([next.quote.number, next.order.number, next.invoice.number]).toEqual(["WMWQ-2004", "WMWO-2002", "WMWI-2002"]);
    // Any later invoice continues the sequence too.
    const custom = await invoices.createCustomInvoice(actor, { customerId: next.order.customerId!, orderId: null, lines: [{ kind: "CUSTOM", description: "Extra leaf", quantity: 1, unitPriceCents: 20000 }], dueDate: null, customerNotes: null });
    expect(custom.number).toBe("WMWI-2003");
  });

  it("revisions keep the quote number; duplicates get a new one", async () => {
    const q = await newQuote(); // WMWQ-2001, revision 1 sent
    await quotes.createRevision(actor, q.id);
    const revisions = await prisma.quoteRevision.findMany({ where: { quoteId: q.id }, orderBy: { number: "asc" } });
    expect(revisions.map((r) => r.number)).toEqual([1, 2]);
    expect((await prisma.quoteRequest.findUniqueOrThrow({ where: { id: q.id } })).number).toBe("WMWQ-2001");
    expect(await prisma.quoteRequest.count()).toBe(1);

    const copy = await quotes.duplicateQuote(actor, q.id);
    expect(copy.number).toBe("WMWQ-2002");
    expect((await newQuote(false)).number).toBe("WMWQ-2003");
  });

  it("concurrent creation never produces duplicate numbers", async () => {
    const issued = await Promise.all(Array.from({ length: 30 }, (_, i) => nextNumber(i % 3 === 0 ? "order" : "quote")));
    const quotesIssued = issued.filter((n) => n.startsWith("WMWQ-"));
    const ordersIssued = issued.filter((n) => n.startsWith("WMWO-"));
    expect(new Set(issued).size).toBe(30);
    expect([...quotesIssued].sort()).toEqual(Array.from({ length: 20 }, (_, i) => `WMWQ-${2001 + i}`));
    expect([...ordersIssued].sort()).toEqual(Array.from({ length: 10 }, (_, i) => `WMWO-${2001 + i}`));

    // Whole quote submissions racing each other.
    seeded = await seedRidge();
    const made = await Promise.all(Array.from({ length: 6 }, () => newQuote(false)));
    expect(new Set(made.map((q) => q.number)).size).toBe(6);
    expect(made.every((q) => /^WMWQ-20(2[1-6])$/.test(q.number!))).toBe(true);
  });
});

describe.skipIf(!hasTestDb)("business name: Wild Mountain Woodworks", () => {
  beforeEach(async () => {
    await resetDb();
    resetRequest();
    seeded = null;
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_x");
    await prisma.siteSetting.create({ data: { id: "default", stripeInvoicingEnabled: true, email: "hello@example.com" } });
    const a = await prisma.adminUser.create({ data: { email: "owner@example.com", name: "Owner", role: "OWNER" } });
    actor = { id: a.id, name: a.name };
  });
  afterEach(() => {
    setInvoicingProviderForTests(null);
    vi.unstubAllEnvs();
  });

  it("emails, customer pages and Stripe descriptions use the full name and the stored numbers", async () => {
    const stripe = fakeStripe();
    setInvoicingProviderForTests(stripe.provider);
    const { quote, order, invoice } = await accepted();
    await invoices.markBalanceDue(actor, invoice.id).catch(() => undefined);
    await orders.updateOrder(actor, order.id, { productionStatus: "IN_PRODUCTION", deliveryDate: null, deliveryAddress: null, deliveryNotes: null, estimatedCompletion: null, productionNotes: null, customerNotes: null, notifyCustomer: true });

    const emails = await prisma.emailLog.findMany();
    expect(emails.length).toBeGreaterThanOrEqual(4);
    for (const e of emails) {
      for (const part of [e.subject, e.html, e.text]) expect(part, `${e.template}`).not.toMatch(SHORT_NAME);
      expect(e.html + e.text, e.template).toContain("Wild Mountain Woodworks");
    }
    const sent = await prisma.emailLog.findFirstOrThrow({ where: { template: "quote_sent" } });
    expect(sent.subject + sent.text).toContain(quote.number!);
    const prod = await prisma.emailLog.findFirstOrThrow({ where: { template: "order_in_production" } });
    expect(prod.subject + prod.text).toContain("WMWO-2001");

    const quoteView = (await loadCustomerQuote(quote.customerToken!))!.view;
    expect(quoteView.business.name).toBe("Wild Mountain Woodworks");
    expect((await customerOrderView(order.customerToken!))!.business.name).toBe("Wild Mountain Woodworks");
    const invView = (await customerInvoiceView(invoice.publicToken!))!;
    expect(invView).toMatchObject({ number: "WMWI-2001", orderNumber: "WMWO-2001", quoteNumber: "WMWQ-2001", business: { name: "Wild Mountain Woodworks" } });

    await checkout.startInvoicePageCheckout(invoice.publicToken!);
    const session = stripe.latest();
    expect(session.input.description).toContain("Wild Mountain Woodworks");
    expect(session.input.description).not.toMatch(SHORT_NAME);
    expect(session.input.metadata).toMatchObject({ invoice_number: "WMWI-2001", order_number: "WMWO-2001", quote_number: "WMWQ-2001" });
  });

  it("the settings form refuses the short name", async () => {
    const { createSignedInAdmin } = await import("../support/next-request");
    const { saveSettings } = await import("@/app/admin/(panel)/settings/actions");
    await createSignedInAdmin({ role: "OWNER", email: "boss@example.com" });
    const fd = new FormData();
    fd.set("businessName", "Wild Mountain");
    fd.set("tagline", "");
    const r = await saveSettings("business", fd);
    expect(r).toMatchObject({ ok: false });
    expect((await prisma.siteSetting.findUniqueOrThrow({ where: { id: "default" } })).businessName).toBe("Wild Mountain Woodworks");
  });
});

describe("no written short brand name in the app", () => {
  function walk(dir: string, out: string[] = []) {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name !== "generated" && name !== "node_modules") walk(p, out);
      } else if (/\.(tsx?|md|sql)$/.test(name)) out.push(p);
    }
    return out;
  }

  it("email templates use Wild Mountain Woodworks", () => {
    for (const t of EMAIL_TEMPLATES) {
      for (const field of [t.subject, t.heading, t.body, t.buttonLabel ?? "", t.description ?? ""]) expect(field, t.key).not.toMatch(SHORT_NAME);
    }
  });

  it("no source, seed or default content says just “Wild Mountain”", () => {
    const files = [...walk(path.resolve("src")), ...walk(path.resolve("prisma/seed-data")), path.resolve("prisma/seed.ts")];
    const offenders = files.filter((f) => SHORT_NAME.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(process.cwd(), f))).toEqual([]);
  });

  it("printed / PDF documents carry the business name (not only the logo graphic)", () => {
    const layout = readFileSync(path.resolve("src/app/(documents)/layout.tsx"), "utf8");
    expect(layout).toMatch(/print:block">\s*<p className="font-semibold text-charcoal">\{settings\.businessName\}<\/p>/);
  });
});
