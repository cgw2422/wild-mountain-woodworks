import { clientIpFromHeaders } from "@/lib/auth/client-ip";
import { rateLimit } from "@/lib/rate-limit";
import { startInvoicePageCheckout } from "@/lib/sales/checkout";
import { isTokenShape } from "@/lib/sales/tokens";

export const dynamic = "force-dynamic";

/**
 * GET /invoice/<token>/pay — "Pay remaining balance" (or the deposit) from
 * the Wild Mountain Woodworks invoice page. Opens a Stripe Checkout Session for exactly
 * what's due on the invoice, computed on the server, and redirects to
 * Stripe's hosted page. Nothing here marks anything paid.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const back = (path: string) => new Response(null, { status: 303, headers: { Location: path, "Cache-Control": "no-store" } });
  if (!isTokenShape(token)) return new Response("Not found", { status: 404 });
  const ip = clientIpFromHeaders(request.headers);
  if (!(await rateLimit(`invoice-pay:${ip}`, 20, 600)).allowed) return back(`/invoice/${token}?payment=limited`);

  const result = await startInvoicePageCheckout(token);
  switch (result.kind) {
    case "redirect":
      // Only ever hand the visitor to Stripe's own HTTPS page.
      return /^https:\/\/([a-z0-9-]+\.)*stripe\.com\//i.test(result.url) ? back(result.url) : back(`/invoice/${token}?payment=error`);
    case "processing":
      return back(`/invoice/${token}/payment-success`);
    case "error":
      return back(`/invoice/${token}?payment=error`);
    default:
      return back(`/invoice/${token}`);
  }
}
