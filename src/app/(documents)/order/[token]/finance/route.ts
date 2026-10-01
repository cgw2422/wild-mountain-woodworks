import { clientIpFromHeaders } from "@/lib/auth/client-ip";
import { rateLimit } from "@/lib/rate-limit";
import { startOrderFinancing } from "@/lib/sales/checkout";
import { isTokenShape } from "@/lib/sales/tokens";

export const dynamic = "force-dynamic";

/**
 * GET /order/<token>/finance — "Finance full purchase" (right after accepting
 * a quote, or later from the order page while nothing has been paid). Opens a
 * Stripe Checkout Session for the FULL order total, where Affirm/Klarna may
 * appear when eligible. The amount is decided on the server; query strings
 * are ignored; nothing here marks anything paid.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const back = (path: string) => new Response(null, { status: 303, headers: { Location: path, "Cache-Control": "no-store" } });
  if (!isTokenShape(token)) return new Response("Not found", { status: 404 });
  const ip = clientIpFromHeaders(request.headers);
  if (!(await rateLimit(`deposit-pay:${ip}`, 20, 600)).allowed) return back(`/order/${token}?payment=limited`);

  const result = await startOrderFinancing(token);
  switch (result.kind) {
    case "redirect":
      return /^https:\/\/([a-z0-9-]+\.)*stripe\.com\//i.test(result.url) ? back(result.url) : back(`/order/${token}?payment=error`);
    case "processing":
      return back(`/order/${token}/payment-success`);
    case "financing_unavailable":
      return back(`/order/${token}?payment=financing-unavailable`);
    case "error":
      return back(`/order/${token}?payment=error`);
    default:
      return back(`/order/${token}`);
  }
}
