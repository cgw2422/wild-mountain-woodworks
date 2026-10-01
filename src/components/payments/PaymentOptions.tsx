import type { PaymentMessaging } from "@/lib/payments/messaging";
import { cn } from "@/lib/cn";
import { formatCents } from "@/lib/money";
import { buttonClasses } from "@/components/ui/Button";
import { StripeMessaging } from "./StripeMessaging";

/** Optional Stripe-provided plan messaging for the exact amount being financed (the full order total). */
export type StripeMessagingProps = { publishableKey: string; amountCents: number } | null;

/**
 * Quiet payment-options block for product pages: full-purchase financing
 * (Affirm / Klarna when eligible) and a secondary "may include" line of
 * ordinary methods. No amounts or terms — the order total is only known once
 * the quote is ready, and Affirm/Klarna never finance a deposit.
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

/** Under a deposit / balance button: the ordinary methods only (Affirm and Klarna are not offered for a deposit). */
export function DepositMethodsNote({ messaging, className }: { messaging: PaymentMessaging; className?: string }) {
  if (!messaging.methods) return null;
  return <MethodsLine methods={messaging.methods} className={className} />;
}

/**
 * The "Finance full purchase" choice: the WHOLE order total, Affirm/Klarna
 * when eligible, subject to approval. With a link it's a ready button (order
 * and invoice pages); without, it's the explanation shown on the quote.
 * Stripe's own messaging element (when configured) covers the full total.
 */
export function FinanceFullPurchase({
  messaging,
  totalCents,
  href,
  stripe,
  className,
  children,
}: {
  messaging: PaymentMessaging;
  totalCents: number;
  href?: string | null;
  stripe?: StripeMessagingProps;
  className?: string;
  children?: React.ReactNode;
}) {
  const { financing } = messaging;
  if (!financing) return null;
  return (
    <div role="group" aria-label="Finance your full purchase" className={cn("border border-stone bg-paper p-5", className)}>
      <p className="text-[0.74rem] font-semibold uppercase tracking-[0.14em] text-muted">Or finance the full purchase</p>
      {href ? (
        <a href={href} rel="nofollow" className={buttonClasses("secondary", "lg", "mt-3")}>
          Finance Full {formatCents(totalCents)} Purchase
        </a>
      ) : null}
      {children}
      <FinanceNote messaging={messaging} stripe={stripe} className="mt-3" />
    </div>
  );
}

/** The wording for the full-purchase financing choice ("when eligible", "subject to approval"), plus Stripe's own messaging for the full total. */
export function FinanceNote({ messaging, stripe, className }: { messaging: PaymentMessaging; stripe?: StripeMessagingProps; className?: string }) {
  const { financing } = messaging;
  if (!financing) return null;
  return (
    <div className={className}>
      <p className="text-sm leading-relaxed text-charcoal">{financing.quoteNotice}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted">{financing.fullPurchaseNote}</p>
      {stripe && financing.providers.length ? <StripeMessaging publishableKey={stripe.publishableKey} amountCents={stripe.amountCents} providers={financing.providers} /> : null}
    </div>
  );
}
