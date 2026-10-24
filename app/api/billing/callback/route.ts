import { NextRequest, NextResponse } from "next/server";
import { settleOrder, verifyCallbackSignature, STRICT_SIGNATURE } from "@/lib/pinelabs";

export const dynamic = "force-dynamic";

// Pine Labs sends the shopper back here after the hosted checkout (GET or form POST).
// We never trust these params: settleOrder re-checks with Get Order before granting Pro.
async function handle(req: NextRequest) {
  const base = process.env.APP_BASE_URL ?? req.nextUrl.origin;
  const params: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => (params[k] = v));
  if (req.method === "POST") {
    try {
      const ct = req.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const j = (await req.json()) as Record<string, unknown>;
        for (const [k, v] of Object.entries(j)) if (v != null) params[k] = String(v);
      } else {
        const form = await req.formData();
        form.forEach((v, k) => typeof v === "string" && (params[k] = v));
      }
    } catch {
      /* fall back to query params */
    }
  }

  // `ref` is our own query param on callback_url; it is not part of Pine Labs' signed payload.
  const { ref, ...signed } = params;
  const sig = verifyCallbackSignature(signed);
  if (sig === "invalid") {
    console.warn("pinelabs callback signature mismatch (re-checking with Get Order)");
    if (STRICT_SIGNATURE) return NextResponse.redirect(new URL("/pricing?error=Payment%20signature%20check%20failed", base), 303);
  }

  const result = await settleOrder(
    { merchantOrderRef: ref ?? params.merchant_order_reference ?? null, pinelabsOrderId: params.order_id ?? null },
    `callback:${sig}`,
  );
  if (result.ok) return NextResponse.redirect(new URL("/dashboard?upgraded=1", base), 303);
  return NextResponse.redirect(new URL(`/pricing?error=${encodeURIComponent(`Payment not completed: ${result.reason}`)}`, base), 303);
}

export const GET = handle;
export const POST = handle;
