// Pine Labs Online (Plural v2) client: token, create order (REDIRECT mode), get order, signature checks.
// Endpoints, field names and signature formats below are our best reading of the Plural v2 docs and are
// marked UNCONFIRMED where we have not verified them against the UAT help desk. Never log secrets or tokens.
import { randomUUID, createHmac } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { db, schema, logEvent } from "./db";
import { safeEqual } from "./crypto";

// ---- Config ---------------------------------------------------------------------------------

export const PINELABS_BASE_URLS = {
  uat: "https://pluraluat.v2.pinepg.in",
  // UNCONFIRMED: production host. Override with PINELABS_BASE_URL if the help desk gives another one.
  prod: "https://api.pluralpay.in",
} as const;

export function pinelabsBaseUrl(): string {
  if (process.env.PINELABS_BASE_URL) return process.env.PINELABS_BASE_URL.replace(/\/$/, "");
  return process.env.PINELABS_ENV === "prod" || process.env.PINELABS_ENV === "production"
    ? PINELABS_BASE_URLS.prod
    : PINELABS_BASE_URLS.uat;
}

export const PINELABS_TOKEN_PATH = "/api/auth/v1/token";
export const PINELABS_CREATE_ORDER_PATH = "/api/checkout/v1/orders";
// UNCONFIRMED: Get Order lives under /api/pay/v1 in the Plural v2 docs (not /api/checkout/v1).
export const PINELABS_GET_ORDER_PATH = (orderId: string) => `/api/pay/v1/orders/${encodeURIComponent(orderId)}`;

// Pro price: Rs 499. Plural v2 `order_amount.value` is in paise (smallest currency unit) per the docs.
// TODO confirm with the Pine Labs help desk that value is paise, not rupees, before going live.
export const PRO_PRICE_PAISE = 49900;
export const PRO_CURRENCY = "INR";

// Order statuses that mean "money captured". UNCONFIRMED exact casing/values; PROCESSED is the documented success state.
export const PINELABS_PAID_STATUSES = new Set(["PROCESSED", "CAPTURED", "SUCCESS", "AUTHORIZED"]);

// Token cache: reuse for ~55 min (Plural tokens last ~60 min). Module scope survives warm Vercel invocations.
const TOKEN_TTL_MS = 55 * 60 * 1000;
let cachedToken: { value: string; expiresAt: number } | null = null;

export class PineLabsError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "Request-ID": randomUUID(),
    "Request-Timestamp": new Date().toISOString(),
    ...extra,
  };
}

// Pull a readable message out of a Plural error body without echoing anything sensitive.
async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as Record<string, unknown>;
    const msg = body.message ?? body.error_message ?? body.response_message ?? body.code ?? body.error;
    return `Pine Labs ${res.status}: ${typeof msg === "string" ? msg : JSON.stringify(msg ?? "error")}`.slice(0, 300);
  } catch {
    return `Pine Labs ${res.status}`;
  }
}

// ---- API calls ------------------------------------------------------------------------------

export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  const clientId = process.env.PINELABS_CLIENT_ID;
  const clientSecret = process.env.PINELABS_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new PineLabsError("Payments are not configured (PINELABS_CLIENT_ID / PINELABS_CLIENT_SECRET missing).");

  const res = await fetch(`${pinelabsBaseUrl()}${PINELABS_TOKEN_PATH}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }),
    cache: "no-store",
  });
  if (!res.ok) throw new PineLabsError(await errorMessage(res), res.status);
  const data = (await res.json()) as { access_token?: string; expires_at?: string; expires_in?: number };
  if (!data.access_token) throw new PineLabsError("Pine Labs token response had no access_token");

  let expiresAt = Date.now() + TOKEN_TTL_MS;
  const serverExpiry = data.expires_at ? Date.parse(data.expires_at) : data.expires_in ? Date.now() + data.expires_in * 1000 : NaN;
  if (Number.isFinite(serverExpiry)) expiresAt = Math.min(expiresAt, serverExpiry - 60_000);
  cachedToken = { value: data.access_token, expiresAt };
  return data.access_token;
}

export type CreatedOrder = { orderId: string; redirectUrl: string };

export async function createOrder(opts: {
  merchantOrderRef: string;
  amountPaise: number;
  callbackUrl: string;
  failureCallbackUrl?: string;
  customer: { id: string; email?: string | null; name?: string | null };
}): Promise<CreatedOrder> {
  const token = await getAccessToken();
  const body = {
    merchant_order_reference: opts.merchantOrderRef,
    order_amount: { value: opts.amountPaise, currency: PRO_CURRENCY },
    integration_mode: "REDIRECT",
    pre_auth: false,
    callback_url: opts.callbackUrl,
    failure_callback_url: opts.failureCallbackUrl ?? opts.callbackUrl,
    notes: "PolicyDrift Pro",
    purchase_details: {
      customer: {
        customer_id: opts.customer.id,
        ...(opts.customer.email ? { email_id: opts.customer.email } : {}),
        ...(opts.customer.name ? { first_name: opts.customer.name.slice(0, 50) } : {}),
      },
    },
  };
  const res = await fetch(`${pinelabsBaseUrl()}${PINELABS_CREATE_ORDER_PATH}`, {
    method: "POST",
    headers: headers({ Authorization: `Bearer ${token}` }),
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (res.status === 401) cachedToken = null;
  if (!res.ok) throw new PineLabsError(await errorMessage(res), res.status);
  const data = (await res.json()) as { order_id?: string; redirect_url?: string; data?: { order_id?: string; redirect_url?: string } };
  const orderId = data.order_id ?? data.data?.order_id;
  const redirectUrl = data.redirect_url ?? data.data?.redirect_url;
  if (!orderId || !redirectUrl) throw new PineLabsError("Pine Labs did not return an order id and redirect URL");
  return { orderId, redirectUrl };
}

export type PineOrder = { orderId: string; status: string; amountPaise: number | null; merchantOrderRef: string | null };

export async function getOrder(orderId: string): Promise<PineOrder> {
  const token = await getAccessToken();
  const res = await fetch(`${pinelabsBaseUrl()}${PINELABS_GET_ORDER_PATH(orderId)}`, {
    headers: headers({ Authorization: `Bearer ${token}` }),
    cache: "no-store",
  });
  if (res.status === 401) cachedToken = null;
  if (!res.ok) throw new PineLabsError(await errorMessage(res), res.status);
  const raw = (await res.json()) as Record<string, unknown>;
  const d = (raw.data ?? raw) as {
    order_id?: string; status?: string; merchant_order_reference?: string; order_amount?: { value?: number };
  };
  return {
    orderId: d.order_id ?? orderId,
    status: String(d.status ?? "UNKNOWN").toUpperCase(),
    amountPaise: typeof d.order_amount?.value === "number" ? d.order_amount.value : null,
    merchantOrderRef: d.merchant_order_reference ?? null,
  };
}

// ---- Signatures -----------------------------------------------------------------------------

// Redirect callback signature. UNCONFIRMED scheme: we assume HMAC-SHA256 (hex) keyed with the client secret
// (or PINELABS_CALLBACK_SECRET if the help desk gives a separate one) over the callback params, minus
// `signature`, sorted by key and joined as k=v&k=v. Because we ALWAYS re-check with Get Order before granting
// Pro, a mismatch only rejects the request when PINELABS_STRICT_SIGNATURE=1.
export function verifyCallbackSignature(params: Record<string, string>): "valid" | "invalid" | "missing" {
  const sig = params.signature;
  const secret = process.env.PINELABS_CALLBACK_SECRET ?? process.env.PINELABS_CLIENT_SECRET;
  if (!sig || !secret) return "missing";
  const payload = Object.keys(params)
    .filter((k) => k !== "signature")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  return safeEqual(sig.toLowerCase(), expected) ? "valid" : "invalid";
}

// Webhook signature. UNCONFIRMED scheme: Standard Webhooks style headers
// webhook-id, webhook-timestamp, webhook-signature = "v1,<base64 HMAC-SHA256(secret, `${id}.${ts}.${body}`)>"
// with PINELABS_WEBHOOK_SECRET (a "whsec_" prefix means the rest is base64 key bytes).
export function verifyWebhookSignature(h: Headers, body: string): "valid" | "invalid" | "missing" {
  const secretRaw = process.env.PINELABS_WEBHOOK_SECRET;
  const id = h.get("webhook-id");
  const ts = h.get("webhook-timestamp");
  const sigHeader = h.get("webhook-signature");
  if (!secretRaw || !id || !ts || !sigHeader) return "missing";
  const key = secretRaw.startsWith("whsec_") ? Buffer.from(secretRaw.slice(6), "base64") : Buffer.from(secretRaw, "utf8");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  const candidates = sigHeader.split(" ").map((s) => (s.includes(",") ? s.split(",")[1] : s));
  return candidates.some((c) => c && safeEqual(c, expected)) ? "valid" : "invalid";
}

export const STRICT_SIGNATURE = process.env.PINELABS_STRICT_SIGNATURE === "1";

// ---- Settlement (shared by callback and webhook, idempotent) ---------------------------------

export type SettleResult =
  | { ok: true; upgraded: boolean; userId: string }
  | { ok: false; reason: string; userId?: string };

// Look up our order row, re-check the real status with Get Order, and flip the user to Pro exactly once.
export async function settleOrder(ref: { pinelabsOrderId?: string | null; merchantOrderRef?: string | null }, source: string): Promise<SettleResult> {
  const where = ref.merchantOrderRef
    ? eq(schema.orders.merchantOrderRef, ref.merchantOrderRef)
    : ref.pinelabsOrderId
      ? eq(schema.orders.pinelabsOrderId, ref.pinelabsOrderId)
      : null;
  if (!where) return { ok: false, reason: "No order reference" };
  const [order] = await db.select().from(schema.orders).where(where).limit(1);
  if (!order) return { ok: false, reason: "Unknown order" };
  if (order.status === "paid") return { ok: true, upgraded: false, userId: order.userId };

  const pineId = order.pinelabsOrderId ?? ref.pinelabsOrderId;
  if (!pineId) return { ok: false, reason: "Order has no Pine Labs id", userId: order.userId };
  if (ref.pinelabsOrderId && order.pinelabsOrderId && ref.pinelabsOrderId !== order.pinelabsOrderId) {
    return { ok: false, reason: "Order id mismatch", userId: order.userId };
  }

  let remote: PineOrder;
  try {
    remote = await getOrder(pineId);
  } catch (err) {
    return { ok: false, reason: (err as Error).message, userId: order.userId };
  }

  if (!PINELABS_PAID_STATUSES.has(remote.status)) {
    const failed = ["FAILED", "CANCELLED", "ATTEMPTED_FAILED"].includes(remote.status);
    await db.update(schema.orders)
      .set({ status: failed ? "failed" : remote.status.toLowerCase() })
      .where(and(eq(schema.orders.id, order.id), ne(schema.orders.status, "paid")));
    return { ok: false, reason: `Payment status is ${remote.status}`, userId: order.userId };
  }
  if (remote.amountPaise !== null && remote.amountPaise < order.amountPaise) {
    return { ok: false, reason: "Paid amount is lower than the order amount", userId: order.userId };
  }

  // Conditional update makes this idempotent across callback + webhook races.
  const flipped = await db.update(schema.orders)
    .set({ status: "paid", pinelabsOrderId: pineId })
    .where(and(eq(schema.orders.id, order.id), ne(schema.orders.status, "paid")))
    .returning({ id: schema.orders.id });
  if (flipped.length === 0) return { ok: true, upgraded: false, userId: order.userId };

  await db.update(schema.users).set({ isPro: true }).where(eq(schema.users.id, order.userId));
  await logEvent("payment", order.userId, {
    method: "pinelabs",
    source,
    order_id: order.id,
    pinelabs_order_id: pineId,
    amount_paise: order.amountPaise,
    status: remote.status,
  });
  return { ok: true, upgraded: true, userId: order.userId };
}
