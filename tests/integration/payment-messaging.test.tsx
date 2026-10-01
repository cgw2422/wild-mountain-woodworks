import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("../support/next-request")).nextHeaders);
vi.mock("next/navigation", async () => ({ ...(await import("../support/next-request")).nextNavigation, useRouter: () => ({ refresh() {}, push() {} }) }));
vi.mock("next/cache", async () => (await import("../support/next-request")).nextCache);

const { prisma } = await import("@/lib/db");
const { createSignedInAdmin, resetRequest } = await import("../support/next-request");
const messagingLib = await import("@/lib/payments/messaging");
const { paymentMessaging, financingClaimIssue, defaultFinancingText, quoteFinancingNotice, CHECKOUT_NOTE, METHODS_INTRO, METHODS_NOTE } = messagingLib;
const { PaymentOptions, FinancingNotice } = await import("@/components/payments/PaymentOptions");
const { QuoteResponse } = await import("@/components/documents/QuoteResponse");
const { saveSettings } = await import("@/app/admin/(panel)/settings/actions");
const { checkoutSessionParams, setInvoicingProviderForTests } = await import("@/lib/sales/stripe");
const quotes = await import("@/lib/sales/quotes");
const { startDepositCheckout } = await import("@/lib/sales/checkout");
const { loadCustomerQuote, customerOrderView } = await import("@/lib/sales/views");
const { createConfigurationQuote } = await import("@/lib/services/submissions");
const { hasTestDb, resetDb, seedRidge } = await import("../support/db");
const { fakeStripe } = await import("../support/fake-stripe");

type Settings = Parameters<typeof paymentMessaging>[0];
const defaults: Settings = {
  paymentFinancingMessaging: true,
  paymentAffirmMessaging: true,
  paymentKlarnaMessaging: true,
  paymentMethodsMessaging: true,
  paymentMessagingHeading: "Flexible payment options available",
  paymentMessagingText: null,
  paymentMethodsText: "Card · Bank · Apple Pay · Link · Cash App Pay · Amazon Pay · Affirm · Klarna",
};
const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;|&#39;/g, "'");
const QUOTE_NOTICE = "Flexible payment options available at checkout, including Affirm and Klarna when eligible.";

/** Anything that reads like a promised plan: an amount per period, payment counts, rates, approval. */
const PROMISE = /\$\s?\d|\d\s*%|\bAPR\b|\d+\s+payments|per month|\/mo\b|guarantee|interest[- ]free|as low as/i;

describe("payment messaging content", () => {
  it("is hidden entirely unless online payments are on", () => {
    expect(paymentMessaging(defaults, false)).toEqual({ financing: null, methods: null });
    expect(html(<PaymentOptions messaging={paymentMessaging(defaults, false)} />)).toBe("");
    expect(html(<FinancingNotice messaging={paymentMessaging(defaults, false)} />)).toBe("");
  });

  it("shows Affirm and Klarna 'when eligible' and the secondary methods line when enabled", () => {
    const m = paymentMessaging(defaults, true);
    expect(m.financing).toMatchObject({
      heading: "Flexible payment options available",
      text: "Pay over time with Affirm or Klarna when eligible.",
      checkoutNote: "Final payment options are shown securely at checkout.",
      quoteNotice: QUOTE_NOTICE,
      providers: ["affirm", "klarna"],
    });
    expect(m.methods).toEqual({ intro: "Secure payment options may include:", list: "Card · Bank · Apple Pay · Link · Cash App Pay · Amazon Pay · Affirm · Klarna", note: "Payment options vary by eligibility, device and transaction." });
    const out = html(<PaymentOptions messaging={m} />);
    for (const s of ["Flexible payment options available", "Pay over time with Affirm or Klarna when eligible.", CHECKOUT_NOTE, METHODS_INTRO, METHODS_NOTE]) expect(out).toContain(s);
  });

  it("each switch controls only its own wording", () => {
    const noFinancing = paymentMessaging({ ...defaults, paymentFinancingMessaging: false }, true);
    expect(noFinancing.financing).toBeNull();
    expect(noFinancing.methods!.list).toBe("Card · Bank · Apple Pay · Link · Cash App Pay · Amazon Pay"); // no financing brands without financing messaging
    expect(html(<PaymentOptions messaging={noFinancing} />)).not.toMatch(/Affirm|Klarna|Pay over time/);

    const klarnaOnly = paymentMessaging({ ...defaults, paymentAffirmMessaging: false }, true);
    expect(klarnaOnly.financing).toMatchObject({ text: "Pay over time with Klarna when eligible.", quoteNotice: "Flexible payment options available at checkout, including Klarna when eligible.", providers: ["klarna"] });
    expect(klarnaOnly.methods!.list).not.toMatch(/Affirm/);

    const neither = paymentMessaging({ ...defaults, paymentAffirmMessaging: false, paymentKlarnaMessaging: false }, true);
    expect(neither.financing).toMatchObject({ text: "Pay over time when eligible.", providers: [] });

    expect(paymentMessaging({ ...defaults, paymentMethodsMessaging: false }, true).methods).toBeNull();
    const nothing = paymentMessaging({ ...defaults, paymentMethodsMessaging: false, paymentFinancingMessaging: false }, true);
    expect(html(<PaymentOptions messaging={nothing} />)).toBe("");
    expect(paymentMessaging({ ...defaults, paymentMessagingText: "Ask about financing at checkout — when eligible." }, true).financing!.text).toBe("Ask about financing at checkout — when eligible.");
  });

  it("never promises financing terms — every built-in string passes the claim guard", () => {
    const strings = [
      defaults.paymentMessagingHeading,
      defaults.paymentMethodsText,
      CHECKOUT_NOTE,
      METHODS_INTRO,
      METHODS_NOTE,
      ...[[], ["affirm"], ["klarna"], ["affirm", "klarna"]].flatMap((p) => [defaultFinancingText(p as never), quoteFinancingNotice(p as never)]),
    ];
    for (const s of strings) {
      expect(financingClaimIssue(s), s).toBeNull();
      expect(s, s).not.toMatch(PROMISE);
    }
    // Anything shown about financing is qualified.
    for (const p of [["affirm"], ["klarna"], ["affirm", "klarna"]] as const) expect(defaultFinancingText([...p])).toMatch(/when eligible/);
    // Rendered output has no amounts or rates (the deposit amount only ever goes to Stripe's element).
    const rendered = html(<PaymentOptions messaging={paymentMessaging(defaults, true)} />) + html(<FinancingNotice messaging={paymentMessaging(defaults, true)} />);
    expect(rendered).not.toMatch(PROMISE);
  });

  it("the claim guard rejects specific plans, rates and approval promises", () => {
    for (const bad of ["$75/month with Affirm", "Just $75 a month", "4 payments of $250", "Split it into four interest-free payments", "0% financing", "0% APR for 12 months", "As low as $40/mo", "Guaranteed approval", "No credit check", "Everyone qualifies"]) {
      expect(financingClaimIssue(bad), bad).toMatch(/can't promise/);
    }
    for (const ok of ["Pay over time with Affirm or Klarna when eligible.", "Financing may be available at checkout for eligible customers."]) expect(financingClaimIssue(ok)).toBeNull();
  });

  it("Stripe's element gets only the amount due at checkout — terms and eligibility come from Stripe", () => {
    const src = readFileSync(path.resolve("src/components/payments/StripeMessaging.tsx"), "utf8");
    expect(src).toContain('create("paymentMethodMessaging", { amount: amountCents, currency: "USD", countryCode: "US", paymentMethodTypes: providers })');
    expect(src).not.toMatch(PROMISE);
    // The product page never passes an amount (only the deposit at checkout is financed, and it's set per quote).
    const product = readFileSync(path.resolve("src/components/product/ProductView.tsx"), "utf8");
    expect(product).toContain("<PaymentOptions messaging={paymentMessaging(settings, flags.onlinePayments)} />");
    expect(readFileSync(path.resolve("src/components/payments/PaymentOptions.tsx"), "utf8")).not.toMatch(/\$\d|\d%/);
  });
});

describe("Stripe Checkout decides the payment methods", () => {
  it("the deposit Checkout Session never lists payment methods, so Stripe shows every eligible one", () => {
    const params = checkoutSessionParams({
      idempotencyKey: "k",
      amountCents: 78450,
      productName: "Deposit",
      description: "Deposit",
      customerEmail: "a@example.com",
      clientReferenceId: "inv",
      successUrl: "https://x/s",
      cancelUrl: "https://x/c",
      metadata: {},
    });
    expect(Object.keys(params).filter((k) => /payment_method/.test(k))).toEqual([]);
    expect(params.mode).toBe("payment");
  });
});

describe("quote acceptance notice", () => {
  const props = { revision: 1, totalCents: 156900, depositCents: 78450, balanceCents: 78450, depositLabel: "Deposit (50%)", customerName: "Jamie", contactHref: "/contact", accept: async () => ({ status: "idle" as const }), decline: async () => ({ status: "idle" as const }) };

  it("shows the financing notice before 'Accept Quote & Pay $X Deposit'", () => {
    const out = html(<QuoteResponse {...props} onlinePayments paymentNotice={<FinancingNotice messaging={paymentMessaging(defaults, true)} />} />);
    expect(out).toContain(QUOTE_NOTICE);
    expect(out).toContain("Accept Quote &amp; Pay $784.50 Deposit");
    expect(out.indexOf(QUOTE_NOTICE)).toBeLessThan(out.indexOf("Accept Quote &amp; Pay"));
  });

  it("has no financing notice when there's nothing to pay online", () => {
    const notice = <FinancingNotice messaging={paymentMessaging(defaults, true)} />;
    expect(html(<QuoteResponse {...props} onlinePayments={false} paymentNotice={notice} />)).not.toContain("Affirm");
    expect(html(<QuoteResponse {...props} depositCents={0} balanceCents={156900} onlinePayments paymentNotice={notice} />)).not.toContain("Affirm");
  });
});

describe.skipIf(!hasTestDb)("payment messaging settings", () => {
  let actor: { id: string; name: string };
  beforeEach(async () => {
    await resetDb();
    resetRequest();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_x");
    vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_test_abc123");
    await prisma.siteSetting.create({ data: { id: "default", stripeInvoicingEnabled: true } });
    const a = await prisma.adminUser.create({ data: { email: "owner@example.com", name: "Owner", role: "OWNER" } });
    actor = { id: a.id, name: a.name };
    setInvoicingProviderForTests(fakeStripe().provider);
  });
  afterEach(() => {
    setInvoicingProviderForTests(null);
    vi.unstubAllEnvs();
  });

  async function sentQuote() {
    const { product, ids } = await seedRidge();
    const quote = await createConfigurationQuote({ name: "Jamie Rivers", email: "jamie@example.com", phone: null, zipCode: "43215", timeline: null, notes: null, address: "12 Oak St", productId: product.id, selection: { options: { [ids.size]: ids.s60, [ids.wood]: ids.pine }, addOns: {}, customDetails: {} } });
    const rev = (await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quote.id }, include: { currentRevision: true } })).currentRevision!;
    await quotes.saveRevision(actor, quote.id, {
      customerName: rev.customerName, customerEmail: rev.customerEmail, customerPhone: null, customerAddress: "12 Oak St", customerNotes: null, terms: null, expiresAt: null, leadTime: null, estimatedCompletion: null, deliveryDetails: null,
      depositType: "PERCENTAGE", depositPercentBps: 5000, depositAmountCents: null, taxCents: 0,
      lines: [{ sourceId: null, kind: "PRODUCT", description: "Table", notes: null, quantity: 1, unitPriceCents: 156900, taxable: false, productId: null }],
    });
    await quotes.sendQuote(actor, quote.id);
    return quote;
  }

  it("quote and order (deposit) pages carry the notice, plus Stripe's messaging key; hidden when switched off or offline", async () => {
    const quote = await sentQuote();
    const view = (await loadCustomerQuote(quote.customerToken!))!.view;
    expect(view.paymentMessaging.financing!.quoteNotice).toBe(QUOTE_NOTICE);
    expect(view.stripePublishableKey).toBe("pk_test_abc123");

    const { order } = await quotes.acceptQuote(quote.customerToken!, { revisionNumber: 1, name: "Jamie", agreeTerms: true, agreeDeposit: true }, { ip: null, userAgent: null });
    const ov = (await customerOrderView(order.customerToken!))!;
    expect(ov.deposit).toMatchObject({ dueCents: 78450, payHref: expect.any(String) });
    expect(ov.paymentMessaging.financing!.quoteNotice).toBe(QUOTE_NOTICE);

    await prisma.siteSetting.update({ where: { id: "default" }, data: { paymentFinancingMessaging: false } });
    expect((await customerOrderView(order.customerToken!))!.paymentMessaging.financing).toBeNull();
    await prisma.siteSetting.update({ where: { id: "default" }, data: { paymentFinancingMessaging: true, stripeInvoicingEnabled: false } });
    const offline = (await customerOrderView(order.customerToken!))!;
    expect(offline.paymentMessaging).toEqual({ financing: null, methods: null });
    expect(offline.stripePublishableKey).toBeNull();
  });

  it("messaging switches never change what Stripe Checkout is asked for", async () => {
    const stripe = fakeStripe();
    setInvoicingProviderForTests(stripe.provider);
    await prisma.siteSetting.update({ where: { id: "default" }, data: { paymentFinancingMessaging: false, paymentAffirmMessaging: false, paymentKlarnaMessaging: false, paymentMethodsMessaging: false } });
    const quote = await sentQuote();
    const { order } = await quotes.acceptQuote(quote.customerToken!, { revisionNumber: 1, name: "Jamie", agreeTerms: true, agreeDeposit: true }, { ip: null, userAgent: null });
    expect(await startDepositCheckout(order.customerToken!)).toMatchObject({ kind: "redirect" });
    const params = checkoutSessionParams(stripe.latest().input);
    expect(Object.keys(params).filter((k) => /payment_method/.test(k))).toEqual([]);
  });

  it("admin can edit the wording and switches, but specific terms are refused", async () => {
    await createSignedInAdmin({ role: "OWNER", email: "boss@example.com" });
    const fd = (fields: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(fields)) f.set(k, v);
      return f;
    };
    const base = { paymentFinancingMessaging: "on", paymentKlarnaMessaging: "on", paymentMethodsMessaging: "on", paymentMessagingHeading: "Pay your way", paymentMessagingText: "", paymentMethodsText: "Card, Bank, Klarna" };
    expect(await saveSettings("payments", fd(base))).toMatchObject({ ok: true });
    const saved = await prisma.siteSetting.findUniqueOrThrow({ where: { id: "default" } });
    expect(saved).toMatchObject({ paymentFinancingMessaging: true, paymentAffirmMessaging: false, paymentKlarnaMessaging: true, paymentMessagingHeading: "Pay your way", paymentMessagingText: null, paymentMethodsText: "Card, Bank, Klarna" });
    expect(paymentMessaging(saved, true)).toMatchObject({ financing: { text: "Pay over time with Klarna when eligible." }, methods: { list: "Card · Bank · Klarna" } });
    // The switches are wording only: the Stripe switch is untouched.
    expect(saved.stripeInvoicingEnabled).toBe(true);

    const res = await saveSettings("payments", fd({ ...base, paymentMessagingText: "Only $75/month with Affirm — 0% APR!" }));
    expect(res).toMatchObject({ ok: false, fieldErrors: { paymentMessagingText: expect.stringMatching(/can't promise/) } });
    expect((await prisma.siteSetting.findUniqueOrThrow({ where: { id: "default" } })).paymentMessagingText).toBeNull();
    expect(await saveSettings("payments", fd({ ...base, paymentMessagingHeading: "Guaranteed approval" }))).toMatchObject({ ok: false });
    expect(await prisma.activityLog.count({ where: { type: "settings.updated" } })).toBe(1);
  });

  it("editors can't change payment messaging", async () => {
    await createSignedInAdmin({ role: "EDITOR", email: "editor@example.com" });
    const f = new FormData();
    f.set("paymentMessagingHeading", "x");
    f.set("paymentMethodsText", "Card");
    expect(await saveSettings("payments", f)).toMatchObject({ ok: false });
  });
});
