import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getUser } from "@/lib/session";
import { createOrder, PRO_PRICE_PAISE } from "@/lib/pinelabs";

export const dynamic = "force-dynamic";

// POST /api/billing/checkout (form post from /pricing) -> Pine Labs hosted checkout
export async function POST(req: NextRequest) {
  const base = process.env.APP_BASE_URL ?? req.nextUrl.origin;
  const back = (msg: string) => NextResponse.redirect(new URL(`/pricing?error=${encodeURIComponent(msg)}`, base), 303);

  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/api/auth/github?next=/pricing", base), 303);
  if (user.isPro) return NextResponse.redirect(new URL("/dashboard", base), 303);

  const merchantOrderRef = `pd_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const [order] = await db
    .insert(schema.orders)
    .values({ userId: user.id, merchantOrderRef, amountPaise: PRO_PRICE_PAISE, status: "created" })
    .returning();

  try {
    const callbackUrl = `${base}/api/billing/callback?ref=${encodeURIComponent(merchantOrderRef)}`;
    const created = await createOrder({
      merchantOrderRef,
      amountPaise: PRO_PRICE_PAISE,
      callbackUrl,
      customer: { id: user.id, email: user.email, name: user.githubLogin },
    });
    await db.update(schema.orders).set({ pinelabsOrderId: created.orderId, status: "pending" }).where(eq(schema.orders.id, order.id));
    return NextResponse.redirect(created.redirectUrl, 303);
  } catch (err) {
    const msg = (err as Error).message;
    console.error("pinelabs checkout failed:", msg);
    await db.update(schema.orders).set({ status: "error" }).where(eq(schema.orders.id, order.id));
    return back(`Could not start checkout. ${msg}`);
  }
}
