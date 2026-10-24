import { NextRequest, NextResponse } from "next/server";
import { settleOrder, verifyWebhookSignature, STRICT_SIGNATURE } from "@/lib/pinelabs";

export const dynamic = "force-dynamic";

// Pine Labs webhook (configure ORDER_PROCESSED in the Pine Labs dashboard -> {APP_BASE_URL}/api/billing/webhook).
// Same settlement as the callback; idempotent, so duplicates and callback races are harmless.
export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = verifyWebhookSignature(req.headers, body);
  if (sig === "invalid" && STRICT_SIGNATURE) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  if (sig === "invalid") console.warn("pinelabs webhook signature mismatch (re-checking with Get Order)");

  let evt: { event_type?: string; type?: string; data?: Record<string, unknown> } & Record<string, unknown>;
  try {
    evt = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const type = String(evt.event_type ?? evt.type ?? "");
  const data = (evt.data ?? evt) as Record<string, unknown>;
  // UNCONFIRMED: payload field names; we accept order_id + merchant_order_reference at top level or under data.
  const pinelabsOrderId = typeof data.order_id === "string" ? data.order_id : null;
  const merchantOrderRef = typeof data.merchant_order_reference === "string" ? data.merchant_order_reference : null;

  if (type && type !== "ORDER_PROCESSED") return NextResponse.json({ ok: true, ignored: type });
  if (!pinelabsOrderId && !merchantOrderRef) return NextResponse.json({ ok: true, ignored: "no order reference" });

  const result = await settleOrder({ pinelabsOrderId, merchantOrderRef }, `webhook:${sig}`);
  // 200 even when not paid, so Pine Labs does not retry forever; unknown orders are just acknowledged.
  return NextResponse.json(result.ok ? { ok: true, upgraded: result.upgraded } : { ok: false, reason: result.reason });
}
