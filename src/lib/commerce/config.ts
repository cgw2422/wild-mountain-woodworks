/**
 * Commerce readiness switch.
 *
 * The data model, server-side pricing, cart pricing, order creation, Stripe
 * Checkout provider and webhook are implemented. The customer-facing cart and
 * checkout pages are intentionally not shipped yet, so they can never be
 * exposed half-finished. When they are built, set this to true: the site will
 * then switch product CTAs to "Add to Cart" whenever Settings → E-commerce is
 * ON and Stripe keys are configured.
 */
export const CHECKOUT_UI_READY = false;
