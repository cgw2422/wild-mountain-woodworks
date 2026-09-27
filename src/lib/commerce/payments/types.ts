export interface CheckoutLineItem {
  name: string;
  description?: string;
  unitAmountCents: number;
  quantity: number;
}

export interface CreateCheckoutParams {
  orderId: string;
  orderNumber: string;
  customerEmail: string;
  lineItems: CheckoutLineItem[];
  successUrl: string;
  cancelUrl: string;
}

/**
 * Payment provider abstraction. Only hosted checkout flows are supported:
 * card details are entered on the provider's page and never touch (or are
 * stored by) Wild Mountain's servers. Cards are never saved for reuse.
 */
export interface PaymentProvider {
  readonly name: string;
  createCheckoutSession(params: CreateCheckoutParams): Promise<{ id: string; url: string }>;
}
