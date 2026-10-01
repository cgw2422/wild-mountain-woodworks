import type { PaymentMessaging } from "@/lib/payments/messaging";
import { cn } from "@/lib/cn";
import { StripeMessaging } from "./StripeMessaging";

/** Optional Stripe-provided plan messaging for the exact amount due at checkout. */
export type StripeMessagingProps = { publishableKey: string; amountCents: number } | null;

/**
 * Quiet payment-options block for product pages: the financing callout
 * (Affirm / Klarna when eligible) and a secondary "may include" line. No
 * amounts or terms — the amount a customer actually pays online (the deposit)
 * is only known once their quote is ready.
 */
export function PaymentOptions({ messaging, className }: { messaging: PaymentMessaging; className?: string }) {
  const { financing, methods } = messaging;
  if (!financing && !methods) return null;
  return (
    <aside aria-label="Payment options" className={cn("border border-stone bg-paper px-5 py-4", className)}>
      {financing ? (
        <>
          <p className="flex items-center gap-3 text-[0.74rem] font-semibold uppercase tracking-[0.14em] text-charcoal">
            <span aria-hidden="true" className="h-px w-5 shrink-0 bg-bronze" />
            {financing.heading}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-charcoal">{financing.text}</p>
          <p className="mt-1 text-xs text-muted">{financing.checkoutNote}</p>
        </>
      ) : null}
      {methods ? <MethodsLine methods={methods} className={financing ? "mt-3 border-t border-stone pt-3" : undefined} /> : null}
    </aside>
  );
}

function MethodsLine({ methods, className }: { methods: NonNullable<PaymentMessaging["methods"]>; className?: string }) {
  return (
    <p className={cn("text-xs leading-relaxed text-muted", className)}>
      {methods.intro} <span className="text-charcoal-muted">{methods.list}</span>
      <span className="block">{methods.note}</span>
    </p>
  );
}

/**
 * The short notice on the quote / deposit step ("…including Affirm and Klarna
 * when eligible"), plus Stripe's own eligibility messaging for the deposit
 * amount when a publishable key is configured.
 */
export function FinancingNotice({ messaging, stripe, className }: { messaging: PaymentMessaging; stripe?: StripeMessagingProps; className?: string }) {
  const { financing, methods } = messaging;
  if (!financing && !methods) return null;
  return (
    <div role="note" aria-label="Payment options" className={cn("border-l-2 border-bronze bg-paper px-4 py-3", className)}>
      {financing ? (
        <>
          <p className="text-sm text-charcoal">{financing.quoteNotice}</p>
          {stripe && financing.providers.length ? <StripeMessaging publishableKey={stripe.publishableKey} amountCents={stripe.amountCents} providers={financing.providers} /> : null}
        </>
      ) : null}
      {methods ? <MethodsLine methods={methods} className={financing ? "mt-2" : undefined} /> : null}
    </div>
  );
}
