import type { SiteSetting } from "@/generated/prisma/client";

/**
 * Customer-facing payment messaging (Admin → Settings → Payments).
 *
 * This is wording only. It never turns a payment method on or off: Stripe
 * Checkout decides which methods (card, bank, wallets, Affirm, Klarna…) a
 * customer is offered, based on the Stripe account, the amount, device and
 * eligibility. So the copy always says "when eligible" / "may include", and
 * it never states terms (monthly amounts, number of payments, rates,
 * approval). Plan-specific wording only ever comes from Stripe's own Payment
 * Method Messaging Element, for the exact amount due at checkout.
 */

export type PaymentMessagingSettings = Pick<
  SiteSetting,
  | "paymentFinancingMessaging"
  | "paymentAffirmMessaging"
  | "paymentKlarnaMessaging"
  | "paymentMethodsMessaging"
  | "paymentMessagingHeading"
  | "paymentMessagingText"
  | "paymentMethodsText"
>;

export type FinancingProvider = "affirm" | "klarna";

export interface PaymentMessaging {
  financing: {
    heading: string;
    text: string;
    /** Fixed qualifier, always shown with the financing text. */
    checkoutNote: string;
    /** Short line for the quote/deposit step. */
    quoteNotice: string;
    /** For Stripe's messaging element (lowercase Stripe payment method types). */
    providers: FinancingProvider[];
  } | null;
  methods: {
    intro: string;
    list: string;
    /** Fixed qualifier: nothing is promised for every customer. */
    note: string;
  } | null;
}

const BRAND: Record<FinancingProvider, string> = { affirm: "Affirm", klarna: "Klarna" };

export const CHECKOUT_NOTE = "Final payment options are shown securely at checkout.";
export const METHODS_INTRO = "Secure payment options may include:";
export const METHODS_NOTE = "Payment options vary by eligibility, device and transaction.";

/** "Affirm or Klarna" / "Affirm" / "" */
function brandList(providers: FinancingProvider[], joiner: "or" | "and") {
  return providers.map((p) => BRAND[p]).join(` ${joiner} `);
}

/** The automatic wording used when no custom text is saved. */
export function defaultFinancingText(providers: FinancingProvider[]) {
  return providers.length ? `Pay over time with ${brandList(providers, "or")} when eligible.` : "Pay over time when eligible.";
}

export function quoteFinancingNotice(providers: FinancingProvider[]) {
  return providers.length
    ? `Flexible payment options available at checkout, including ${brandList(providers, "and")} when eligible.`
    : "Flexible payment options are available at checkout when eligible.";
}

/**
 * What to show customers, or nulls when it should be hidden. Nothing is shown
 * unless online payments (Stripe) are on — otherwise there is no checkout at
 * which these options could appear.
 */
export function paymentMessaging(settings: PaymentMessagingSettings, onlinePayments: boolean): PaymentMessaging {
  if (!onlinePayments) return { financing: null, methods: null };
  const providers = ([settings.paymentAffirmMessaging && "affirm", settings.paymentKlarnaMessaging && "klarna"].filter(Boolean) as FinancingProvider[]);
  const financing = settings.paymentFinancingMessaging
    ? {
        heading: settings.paymentMessagingHeading.trim() || "Flexible payment options available",
        text: settings.paymentMessagingText?.trim() || defaultFinancingText(providers),
        checkoutNote: CHECKOUT_NOTE,
        quoteNotice: quoteFinancingNotice(providers),
        providers,
      }
    : null;
  // A financing brand switched off is also left out of the general list.
  const hidden = new Set<string>([
    ...(!financing || !settings.paymentAffirmMessaging ? ["affirm"] : []),
    ...(!financing || !settings.paymentKlarnaMessaging ? ["klarna"] : []),
  ]);
  const list = settings.paymentMethodsText
    .split(/[·•,|]/)
    .map((m) => m.trim())
    .filter((m) => m && !hidden.has(m.toLowerCase()))
    .join(" · ");
  const methods = settings.paymentMethodsMessaging && list ? { intro: METHODS_INTRO, list, note: METHODS_NOTE } : null;
  return { financing, methods };
}

/**
 * Wording that would promise financing terms we can't guarantee — those only
 * come from Stripe for an eligible customer and amount. Used to validate the
 * admin's custom text and guarded by tests for every built-in string.
 */
const CLAIMS: Array<[RegExp, string]> = [
  [/\$\s?\d[\d,.]*\s*(\/|per\b|a\b|each\b)\s*(mo\b|month|wk\b|week|biweek)/i, "a monthly or weekly amount"],
  [/\b(\d+|two|three|four|five|six|twelve)\s+(interest[- ]free\s+)?(payments|installments|instalments)\b/i, "a number of payments"],
  [/\d\s*%/, "a percentage or rate"],
  [/\b(apr|interest[- ]free|no interest|zero interest|0 interest|no credit check|guaranteed|pre-?approved|instant approval|always approved|everyone (qualifies|is approved))\b/i, "rates or approval"],
  [/\bas low as\b/i, "a starting payment"],
];

export function financingClaimIssue(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const [re, what] of CLAIMS) {
    if (re.test(text)) {
      return `Payment messaging can't promise ${what}. Affirm and Klarna terms depend on each customer's eligibility — Stripe shows the eligible plans at checkout.`;
    }
  }
  return null;
}
