import { clientIpFromHeaders } from "@/lib/auth/client-ip";
import { rateLimit } from "@/lib/rate-limit";
import { startInvoicePageFinancing } from "@/lib/sales/checkout";
import { isTokenShape } from "@/lib/sales/tokens";

export const dynamic = "force-dynamic";

/**
 * GET /invoice/<token>/finance — "Finance full purchase". Opens a Stripe
 * Checkout Session for the FULL invoice total (computed on the server, only
 * while nothing has been paid), where Affirm/Klarna may appear when eligible.
 * Query strings are ignored; nothing here marks anything paid.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const back = (path: string) => new Response(null, { status: 303, headers: { Location: path, "Cache-Control": "no-store" } });
  if (!isTokenShape(token)) return new Response("Not found", { status: 404 });
  const ip = clientIpFromHeaders(request.headers);
  if (!(await rateLimit(`invoice-pay:${ip}`, 20, 600)).allowed) return back(`/invoice/${token}?payment=limited`);

  const result = await startInvoicePageFinancing(token);
  switch (result.kind) {
    case "redirect":
      return /^https:\/\/([a-z0-9-]+\.)*stripe\.com\//i.test(result.url) ? back(result.url) : back(`/invoice/${token}?payment=error`);
    case "processing":
      return back(`/invoice/${token}/payment-success`);
    case "financing_unavailable":
      return back(`/invoice/${token}?payment=financing-unavailable`);
    case "error":
      return back(`/invoice/${token}?payment=error`);
    default:
      return back(`/invoice/${token}`);
  }
}
