import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("../support/next-request")).nextHeaders);
vi.mock("next/navigation", async () => (await import("../support/next-request")).nextNavigation);
vi.mock("next/cache", async () => (await import("../support/next-request")).nextCache);

const { prisma } = await import("@/lib/db");
const { resetRequest, jar } = await import("../support/next-request");
const { createConfigurationQuote } = await import("@/lib/services/submissions");
const quotes = await import("@/lib/sales/quotes");
const invoices = await import("@/lib/sales/invoices");
const payments = await import("@/lib/sales/payments");
const checkout = await import("@/lib/sales/checkout");
const { customerInvoiceView, customerOrderView } = await import("@/lib/sales/views");
const { checkoutSessionParams, setInvoicingProviderForTests } = await import("@/lib/sales/stripe");
const { paymentMessaging } = await import("@/lib/payments/messaging");
const { acceptQuoteAction } = await import("@/app/(documents)/quote/[token]/actions");
const orderPay = await import("@/app/(documents)/order/[token]/pay/route");
const orderFinance = await import("@/app/(documents)/order/[token]/finance/route");
const invoiceFinance = await import("@/app/(documents)/invoice/[token]/finance/route");
const webhook = await import("@/app/api/stripe/webhook/route");
const { hasTestDb, resetDb, seedRidge } = await import("../support/db");
const { fakeStripe } = await import("../support/fake-stripe");

const meta = { ip: "198.51.100.7", userAgent: "Mozilla/5.0 test" };
let actor: { id: string; name: string; role: string };
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

const get = (route: { GET: (r: Request, c: { params: Promise<{ token: string }> }) => Promise<Response> }, url: string, token: string) =>
  route.GET(new Request(`http://localhost${url}`), { params: Promise.resolve({ token }) });

/** A sent $2,400 quote with a $1,200 (50%) deposit. */
async function sentQuote() {
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
    terms: null,
    expiresAt: null,
    leadTime: null,
    estimatedCompletion: null,
    deliveryDetails: null,
    depositType: "PERCENTAGE",
    depositPercentBps: 5000,
    depositAmountCents: null,
    taxCents: 0,
    lines: [{ sourceId: null, kind: "PRODUCT", description: "The Ridge Dining Table", notes: null, quantity: 1, unitPriceCents: 240000, taxable: false, productId: null }],
  });
  await quotes.sendQuote(actor, quote.id);
  return prisma.quoteRequest.findUniqueOrThrow({ where: { id: quote.id } });
}

async function accepted(paymentPath: "deposit" | "finance" = "finance") {
  const quote = await sentQuote();
  const r = await quotes.acceptQuote(quote.customerToken!, { revisionNumber: 1, name: "Jamie Rivers", agreeTerms: true, agreeDeposit: true, paymentPath }, meta);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: r.order.id } });
  const invoice = await prisma.invoice.findFirstOrThrow({ where: { orderId: order.id } });
  return { quote, order, invoice, result: r };
}

const inv = (id: string) => prisma.invoice.findUniqueOrThrow({ where: { id } });
const ord = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });

/** Finance the order's full total and have Stripe confirm it with the given method. */
async function financeAndPay(orderToken: string, method: "affirm" | "klarna", eventId = `evt_${method}`) {
  const res = await get(orderFinance, `/order/${orderToken}/finance`, orderToken);
  expect(res.status).toBe(303);
  const session = stripe.latest();
  stripe.complete(session.id, "paid", method);
  expect((await signed(stripe.event(eventId, "checkout.session.completed", session.id))).status).toBe(200);
  return session;
}

describe.skipIf(!hasTestDb)("deposit vs full-purchase financing", () => {
  beforeEach(async () => {
    await resetDb();
    resetRequest();
    seeded = null;
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_x");
    await prisma.siteSetting.create({ data: { id: "default", stripeInvoicingEnabled: true } });
    const a = await prisma.adminUser.create({ data: { email: "owner@example.com", name: "Owner", role: "OWNER" } });
    actor = { id: a.id, name: a.name, role: "OWNER" };
    stripe = fakeStripe();
    setInvoicingProviderForTests(stripe.provider);
  });
  afterEach(() => {
    setInvoicingProviderForTests(null);
    vi.unstubAllEnvs();
  });

  it("the deposit Checkout is for the deposit only and never offers Affirm or Klarna", async () => {
    const { order } = await accepted("deposit");
    const res = await get(orderPay, `/order/${order.customerToken}/pay`, order.customerToken!);
    expect(res.status).toBe(303);
    const s = stripe.latest();
    expect(s.input.amountCents).toBe(120000);
    expect(s.input.metadata).toMatchObject({ payment_type: "DEPOSIT", expected_amount: "120000" });
    expect(s.input.excludedPaymentMethodTypes).toEqual(expect.arrayContaining(["affirm", "klarna"]));
    const params = checkoutSessionParams(s.input);
    expect(Object.entries(params).filter(([k]) => k.startsWith("excluded_payment_method_types")).map(([, v]) => v)).toEqual(expect.arrayContaining(["affirm", "klarna"]));
    expect(Object.keys(params).filter((k) => k.startsWith("payment_method_types"))).toEqual([]);
  });

  it("deposit route: the customer pays $1,200, the invoice is partially paid and the order confirmed", async () => {
    const { order, invoice } = await accepted("deposit");
    await get(orderPay, `/order/${order.customerToken}/pay`, order.customerToken!);
    const s = stripe.latest();
    stripe.complete(s.id, "paid", "card");
    await signed(stripe.event("evt_dep", "checkout.session.completed", s.id));
    expect(await prisma.payment.findFirstOrThrow()).toMatchObject({ type: "DEPOSIT", method: "STRIPE_ONLINE", amountCents: 120000, stripePaymentMethodType: "card" });
    expect(await inv(invoice.id)).toMatchObject({ status: "PARTIALLY_PAID", amountPaidCents: 120000 });
    expect(await ord(order.id)).toMatchObject({ productionStatus: "ORDER_CONFIRMED", paymentStatus: "PARTIALLY_PAID" });
    // Once anything is paid, BNPL is no longer offered (it never finances a remaining balance).
    expect((await customerOrderView(order.customerToken!))!.financing).toBeNull();
    expect(await checkout.startOrderFinancing(order.customerToken!)).toEqual({ kind: "financing_unavailable" });
  });

  it("financing: one Checkout for the FULL $2,400 where Affirm/Klarna can appear", async () => {
    const { order, invoice, quote } = await accepted("finance");
    const res = await get(orderFinance, `/order/${order.customerToken}/finance?amount=1&depositCents=1`, order.customerToken!);
    expect(res.status).toBe(303);
    const s = stripe.latest();
    expect(res.headers.get("location")).toBe(s.url);
    expect(s.input.amountCents).toBe(240000); // the browser can't change it
    expect(s.input.excludedPaymentMethodTypes).toEqual([]);
    expect(s.input.metadata).toMatchObject({ payment_type: "FULL_PURCHASE_FINANCING", expected_amount: "240000", invoice_id: invoice.id, order_id: order.id, quote_id: quote.id });
    const params = checkoutSessionParams(s.input);
    expect(Object.keys(params).filter((k) => /payment_method/.test(k))).toEqual([]);
    expect(await inv(invoice.id)).toMatchObject({ stripeCheckoutPurpose: "FULL_PURCHASE_FINANCING", amountPaidCents: 0 });
  });

  for (const method of ["affirm", "klarna"] as const) {
    it(`a successful full-purchase ${method} payment pays the invoice in full — no balance, ever`, async () => {
      const { order, invoice } = await accepted("finance");
      await financeAndPay(order.customerToken!, method);

      const all = await prisma.payment.findMany();
      expect(all).toHaveLength(1); // no fake deposit + balance split
      expect(all[0]).toMatchObject({ type: "FULL_PURCHASE", method: "STRIPE_ONLINE", amountCents: 240000, status: "SUCCEEDED", stripePaymentMethodType: method, invoiceId: invoice.id });
      expect(await inv(invoice.id)).toMatchObject({ status: "PAID", amountPaidCents: 240000, pendingCents: 0 });
      expect(await ord(order.id)).toMatchObject({ productionStatus: "ORDER_CONFIRMED", paymentStatus: "PAID" });

      // Never "Balance due" afterwards.
      await expect(invoices.markBalanceDue(actor, invoice.id)).rejects.toThrow(/paid in full/);
      expect((await inv(invoice.id)).status).toBe("PAID");
      expect(await checkout.startOrderCheckout(order.customerToken!)).toEqual({ kind: "nothing_due" });

      const name = method === "affirm" ? "Affirm" : "Klarna";
      const iv = (await customerInvoiceView(invoice.publicToken!))!;
      expect(iv).toMatchObject({ remainingCents: 0, paidCents: 240000, paidInFullWith: name, paidInFullFinanced: true, payHref: null, financing: null });
      expect(iv.payments).toEqual([expect.objectContaining({ label: "Full purchase", method: name, amountCents: 240000 })]);
      const ov = (await customerOrderView(order.customerToken!))!;
      expect(ov).toMatchObject({ balanceCents: 0, paymentStatus: "PAID", paidInFullWith: name, due: null, financing: null });
      expect(ov.milestones.map((m) => m.label)).toContain("Paid in full");
      const receipt = await prisma.emailLog.findFirstOrThrow({ where: { template: "payment_received" } });
      expect(receipt.text).toContain(name);
      expect(receipt.text).toMatch(/Remaining balance on order WMWO-2001: \$0\b/);
    });
  }

  it("the invoice page can finance the full total too (Klarna), with the same server-side amount", async () => {
    const { invoice } = await accepted("deposit");
    const res = await get(invoiceFinance, `/invoice/${invoice.publicToken}/finance?amount=5`, invoice.publicToken!);
    expect(res.status).toBe(303);
    const s = stripe.latest();
    expect(s.input.amountCents).toBe(240000);
    stripe.complete(s.id, "paid", "klarna");
    await signed(stripe.event("evt_k", "checkout.session.completed", s.id));
    expect(await inv(invoice.id)).toMatchObject({ status: "PAID", amountPaidCents: 240000 });
  });

  it("abandoned or failed financing leaves the invoice unpaid and both choices open", async () => {
    const { order, invoice } = await accepted("finance");
    await get(orderFinance, `/order/${order.customerToken}/finance`, order.customerToken!);
    const s = stripe.latest();
    stripe.expire(s.id);
    await signed(stripe.event("evt_exp", "checkout.session.expired", s.id));
    expect(await inv(invoice.id)).toMatchObject({ status: "DEPOSIT_DUE", amountPaidCents: 0 });
    expect(await prisma.payment.count()).toBe(0);
    let ov = (await customerOrderView(order.customerToken!))!;
    expect(ov.financing).toEqual({ amountCents: 240000, href: `/order/${order.customerToken}/finance` });
    expect(ov.due).toMatchObject({ type: "DEPOSIT", amountCents: 120000 });

    // An application that's declined after checkout (async failure) records nothing either.
    await get(orderFinance, `/order/${order.customerToken}/finance`, order.customerToken!);
    const s2 = stripe.latest();
    expect(s2.id).not.toBe(s.id);
    stripe.complete(s2.id, "unpaid", "affirm");
    await signed(stripe.event("evt_c2", "checkout.session.completed", s2.id));
    await signed(stripe.event("evt_f2", "checkout.session.async_payment_failed", s2.id));
    expect(await inv(invoice.id)).toMatchObject({ status: "DEPOSIT_DUE", amountPaidCents: 0 });
    expect(await ord(order.id)).toMatchObject({ productionStatus: "AWAITING_DEPOSIT", paymentStatus: "DEPOSIT_DUE" });
    ov = (await customerOrderView(order.customerToken!))!;
    expect(ov.due).toMatchObject({ type: "DEPOSIT" });

    // They can still pay the deposit instead — that session excludes Affirm/Klarna.
    await get(orderPay, `/order/${order.customerToken}/pay`, order.customerToken!);
    const dep = stripe.latest();
    expect(dep.input).toMatchObject({ amountCents: 120000, metadata: expect.objectContaining({ payment_type: "DEPOSIT" }) });
    expect(dep.input.excludedPaymentMethodTypes).toEqual(expect.arrayContaining(["affirm", "klarna"]));
  });

  it("switching between deposit and financing closes the other open Checkout (never reused across purposes)", async () => {
    const { order, invoice } = await accepted("deposit");
    await get(orderPay, `/order/${order.customerToken}/pay`, order.customerToken!);
    const dep = stripe.latest();
    await get(orderFinance, `/order/${order.customerToken}/finance`, order.customerToken!);
    const fin = stripe.latest();
    expect(fin.id).not.toBe(dep.id);
    expect(stripe.sessions.get(dep.id)!.status).toBe("expired");
    expect(fin.input.amountCents).toBe(240000);
    // Asking for the deposit again doesn't reuse the financing page.
    await get(orderPay, `/order/${order.customerToken}/pay`, order.customerToken!);
    const dep2 = stripe.latest();
    expect(dep2.id).not.toBe(fin.id);
    expect(dep2.input.amountCents).toBe(120000);
    expect((await inv(invoice.id)).stripeCheckoutPurpose).toBe("DEPOSIT");
  });

  it("the customer can't finance only the deposit: financing is refused once any money is on the invoice", async () => {
    const { order, invoice } = await accepted("deposit");
    // A pending check counts too.
    await payments.recordManualPayment(actor, { invoiceId: invoice.id, amountCents: 50000, method: "CHECK", receivedAt: new Date(), reference: "1", notes: null, sendReceipt: false });
    expect(await checkout.startOrderFinancing(order.customerToken!)).toEqual({ kind: "financing_unavailable" });
    const res = await get(orderFinance, `/order/${order.customerToken}/finance`, order.customerToken!);
    expect(res.headers.get("location")).toBe(`/order/${order.customerToken}?payment=financing-unavailable`);
    expect(await checkout.startInvoicePageFinancing(invoice.publicToken!)).toEqual({ kind: "financing_unavailable" });
    expect(stripe.calls.filter((c) => c.startsWith("checkout:"))).toEqual([]);
    expect((await customerInvoiceView(invoice.publicToken!))!.financing).toBeNull();
  });

  it("financing is only offered when switched on, and acceptance refuses it otherwise", async () => {
    await prisma.siteSetting.update({ where: { id: "default" }, data: { paymentFinancingMessaging: false } });
    const quote = await sentQuote();
    await expect(quotes.acceptQuote(quote.customerToken!, { revisionNumber: 1, name: "Jamie Rivers", agreeTerms: true, agreeDeposit: true, paymentPath: "finance" }, meta)).rejects.toThrow(/Financing isn't available/);
    expect(await prisma.order.count()).toBe(0);
    const { result, order } = await (async () => {
      const r = await quotes.acceptQuote(quote.customerToken!, { revisionNumber: 1, name: "Jamie Rivers", agreeTerms: true, agreeDeposit: true, paymentPath: "deposit" }, meta);
      return { result: r, order: await ord(r.order.id) };
    })();
    expect(result).toMatchObject({ payNow: true, financing: false });
    expect(await checkout.startOrderFinancing(order.customerToken!)).toEqual({ kind: "financing_unavailable" });
    expect((await customerOrderView(order.customerToken!))!.financing).toBeNull();
  });

  it("accepting with 'finance' goes straight to the full-purchase checkout and records the choice", async () => {
    const quote = await sentQuote();
    jar.clear();
    const res = await acceptQuoteAction(quote.customerToken!, form({ revision: "1", name: "Jamie Rivers", agreeTerms: "on", agreeDeposit: "on", paymentPath: "finance", amount: "1", totalCents: "1" }));
    const order = await prisma.order.findFirstOrThrow();
    expect(res).toEqual({ status: "success", reference: order.number, redirect: `/order/${order.customerToken}/finance` });
    const rev = await prisma.quoteRevision.findFirstOrThrow({ where: { quoteId: quote.id } });
    expect(JSON.stringify(rev)).toMatch(/finance the full order total/);
    expect(await prisma.activityLog.findFirstOrThrow({ where: { type: "quote.accepted" } })).toMatchObject({ message: expect.stringMatching(/full-purchase financing/) });
    // No "pay your deposit" acceptance email when they're heading to financing.
    expect(await prisma.emailLog.count({ where: { template: "quote_accepted" } })).toBe(0);
    // An unknown path is rejected rather than guessed.
    const q2 = await sentQuote().catch(() => null);
    if (q2) expect(await acceptQuoteAction(q2.customerToken!, form({ revision: "1", name: "Jamie Rivers", agreeTerms: "on", agreeDeposit: "on", paymentPath: "deposit-with-affirm" }))).toMatchObject({ status: "error" });
  });

  it("later order changes never touch the original financed payment — they're a separate change-order invoice", async () => {
    const { order, invoice } = await accepted("finance");
    await financeAndPay(order.customerToken!, "affirm");
    const original = await prisma.payment.findFirstOrThrow();

    const change = await invoices.createCustomInvoice(actor, {
      customerId: order.customerId!,
      orderId: order.id,
      lines: [{ kind: "CUSTOM", description: "Upgrade: extension leaf", quantity: 1, unitPriceCents: 30000 }],
      dueDate: null,
      customerNotes: null,
    });
    await invoices.sendInvoice(actor, change.id);
    expect(change.number).not.toBe(invoice.number);
    expect(await inv(change.id)).toMatchObject({ kind: "CUSTOM", status: "BALANCE_DUE", totalCents: 30000 });
    // The financed invoice and payment are exactly as they were.
    expect(await inv(invoice.id)).toMatchObject({ status: "PAID", totalCents: 240000, amountPaidCents: 240000 });
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
    // A change order can't be financed with BNPL (only the original full order could).
    expect(await checkout.startInvoicePageFinancing((await inv(change.id)).publicToken!)).toEqual({ kind: "financing_unavailable" });
    // Its own checkout excludes Affirm/Klarna.
    await checkout.startInvoicePageCheckout((await inv(change.id)).publicToken!);
    expect(stripe.latest().input).toMatchObject({ amountCents: 30000, excludedPaymentMethodTypes: expect.arrayContaining(["affirm", "klarna"]) });
  });

  it("product financing messaging refers to the full purchase, not the deposit", () => {
    const m = paymentMessaging({ paymentFinancingMessaging: true, paymentAffirmMessaging: true, paymentKlarnaMessaging: true, paymentMethodsMessaging: true, paymentMessagingHeading: "Flexible financing available", paymentMessagingText: null, paymentMethodsText: "Card" }, true);
    expect(m.financing!.text).toBe("Finance your full purchase with Affirm or Klarna when eligible.");
    expect(JSON.stringify(m)).not.toMatch(/deposit/i);
  });
});
