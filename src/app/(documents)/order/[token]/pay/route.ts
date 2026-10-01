import { clientIpFromHeaders } from "@/lib/auth/client-ip";
import { rateLimit } from "@/lib/rate-limit";
import { startDepositCheckout } from "@/lib/sales/checkout";
import { isTokenShape } from "@/lib/sales/tokens";

export const dynamic = "force-dynamic";

/**
 * GET /order/<token>/pay — the stable "Pay deposit" link (used right after
 * accepting a quote, on the order page and in emails). Opens a Stripe
 * Checkout Session for the unpaid deposit (reusing an open one, replacing an
 * expired one) and redirects to Stripe's hosted payment page. The amount is
 * decided on the server; nothing here marks anything paid.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const back = (path: string) => new Response(null, { status: 303, headers: { Location: path, "Cache-Control": "no-store" } });
  if (!isTokenShape(token)) return new Response("Not found", { status: 404 });
  const ip = clientIpFromHeaders(request.headers);
  if (!(await rateLimit(`deposit-pay:${ip}`, 20, 600)).allowed) return back(`/order/${token}?payment=limited`);

  const result = await startDepositCheckout(token);
  switch (result.kind) {
    case "redirect":
      // Only ever hand the visitor to Stripe's own HTTPS page.
      return /^https:\/\/([a-z0-9-]+\.)*stripe\.com\//i.test(result.url) ? back(result.url) : back(`/order/${token}?payment=error`);
    case "processing":
      return back(`/order/${token}/payment-success`);
    case "error":
      return back(`/order/${token}?payment=error`);
    default:
      return back(`/order/${token}`);
  }
}
