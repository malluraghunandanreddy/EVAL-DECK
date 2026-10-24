import { NextRequest, NextResponse } from "next/server";
import { clearSession } from "@/lib/session";

export const dynamic = "force-dynamic";

async function logout(req: NextRequest) {
  await clearSession();
  return NextResponse.redirect(new URL("/", process.env.APP_BASE_URL ?? req.nextUrl.origin), 303);
}

export const GET = logout;
export const POST = logout;
