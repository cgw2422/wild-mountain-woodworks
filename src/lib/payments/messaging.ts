import type { SiteSetting } from "@/generated/prisma/client";

/**
 * Customer-facing payment messaging (Admin → Settings → Payments).
 *
 * Two different ways to pay after accepting a quote:
 *  - the standard deposit (ordinary methods — card, bank, wallets…; Affirm
 *    and Klarna are excluded from that Checkout), and
 *  - full-purchase financing: the WHOLE order total in one Checkout, where
 *    Affirm/Klarna may appear when the customer and amount are eligible.
 * Affirm and Klarna are never offered for a deposit or a partial amount.
 *
 * The financing switch decides whether the full-purchase option is offered;
 * Stripe still decides which methods are actually eligible. So the copy
 * always says "when eligible" / "subject to approval", and never states terms
 * (monthly amounts, number of payments, rates, approval). Plan-specific
 * wording only ever comes from Stripe's own Payment Method Messaging Element,
 * for the full order total being financed.
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
    /** Explanation next to the "Finance full purchase" choice. */
    quoteNotice: string;
    /** Fixed: the full order is paid now; repayments go to the financing provider. */
    fullPurchaseNote: string;
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
/** Always shown with the full-purchase financing choice. */
export const FINANCING_FULL_PURCHASE_NOTE = "Wild Mountain Woodworks receives payment for the full order now while you make payments to your financing provider. Subject to approval; available options are shown at checkout.";
/** Stripe payment method types that are buy-now-pay-later: full purchase only, never a deposit or partial amount. */
export const BNPL_PAYMENT_METHOD_TYPES = ["affirm", "klarna", "afterpay_clearpay"] as const;
export const METHODS_INTRO = "Secure payment options may include:";
export const METHODS_NOTE = "Payment options vary by eligibility, device and transaction.";

/** "Affirm or Klarna" / "Affirm" / "" */
function brandList(providers: FinancingProvider[], joiner: "or" | "and") {
  return providers.map((p) => BRAND[p]).join(` ${joiner} `);
}

/** The automatic wording used when no custom text is saved. */
export function defaultFinancingText(providers: FinancingProvider[]) {
  return providers.length ? `Finance your full purchase with ${brandList(providers, "or")} when eligible.` : "Finance your full purchase when eligible.";
}

export function quoteFinancingNotice(providers: FinancingProvider[]) {
  return providers.length ? `Pay over time with ${brandList(providers, "or")} when eligible.` : "Pay over time when eligible.";
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
        heading: settings.paymentMessagingHeading.trim() || "Flexible financing available",
        text: settings.paymentMessagingText?.trim() || defaultFinancingText(providers),
        checkoutNote: CHECKOUT_NOTE,
        quoteNotice: quoteFinancingNotice(providers),
        fullPurchaseNote: FINANCING_FULL_PURCHASE_NOTE,
        providers,
      }
    : null;
  // Affirm/Klarna are never one of the ordinary methods (they finance the full purchase only).
  const hidden = new Set<string>(["affirm", "klarna", "afterpay", "afterpay / clearpay", "clearpay"]);
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
  if (/\bdeposits?\b/i.test(text)) return "Affirm and Klarna finance the full purchase only — financing wording can't mention a deposit.";
  for (const [re, what] of CLAIMS) {
    if (re.test(text)) {
      return `Payment messaging can't promise ${what}. Affirm and Klarna terms depend on each customer's eligibility — Stripe shows the eligible plans at checkout.`;
    }
  }
  return null;
}
