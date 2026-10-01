"use client";

import { useEffect, useRef, useState } from "react";
import type { FinancingProvider } from "@/lib/payments/messaging";

/*
 * Stripe's Payment Method Messaging Element: Stripe decides eligibility, the
 * plans, the wording and the official Affirm/Klarna marks for the exact
 * amount due at checkout. We never compute or state terms ourselves. If
 * Stripe.js can't load (blocked, offline, no key) nothing is shown here and
 * the surrounding term-free text still stands on its own.
 */

type StripeMessagingElement = { mount(el: HTMLElement): void; destroy(): void; on(event: "ready", cb: () => void): void };
type StripeJs = (key: string) => {
  elements(opts: Record<string, unknown>): { create(type: "paymentMethodMessaging", opts: Record<string, unknown>): StripeMessagingElement };
};

let loader: Promise<StripeJs | null> | null = null;
function loadStripeJs(): Promise<StripeJs | null> {
  const w = window as unknown as { Stripe?: StripeJs };
  if (w.Stripe) return Promise.resolve(w.Stripe);
  loader ??= new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://js.stripe.com/v3/";
    script.async = true;
    script.onload = () => resolve(w.Stripe ?? null);
    script.onerror = () => {
      loader = null;
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return loader;
}

export function StripeMessaging({ publishableKey, amountCents, providers }: { publishableKey: string; amountCents: number; providers: FinancingProvider[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const key = providers.join(",");

  useEffect(() => {
    if (!providers.length || amountCents <= 0) return;
    let cancelled = false;
    let element: StripeMessagingElement | null = null;
    loadStripeJs()
      .then((Stripe) => {
        if (!Stripe || cancelled || !ref.current) return;
        const elements = Stripe(publishableKey).elements({
          appearance: {
            theme: "flat",
            variables: { colorText: "#1f1e1c", colorTextSecondary: "#5c574f", fontFamily: "Manrope, ui-sans-serif, system-ui, sans-serif", fontSizeBase: "14px" },
          },
        });
        element = elements.create("paymentMethodMessaging", { amount: amountCents, currency: "USD", countryCode: "US", paymentMethodTypes: providers });
        element.on("ready", () => !cancelled && setReady(true));
        element.mount(ref.current);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      element?.destroy();
    };
    // `key` stands in for the providers array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishableKey, amountCents, key]);

  return <div ref={ref} data-stripe-messaging="" aria-busy={!ready} className={ready ? "mt-3" : undefined} />;
}
