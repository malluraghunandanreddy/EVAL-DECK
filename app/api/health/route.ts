import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/health -> database round-trip time; 503 after 8 s so monitors see a failure instead of a hang.
export async function GET() {
  const t = Date.now();
  const ping = db.execute(sql`select 1 as ok`);
  const timeout = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 8000));
  const res = await Promise.race([ping, timeout]);
  const ms = Date.now() - t;
  if (res === "timeout") return NextResponse.json({ ok: false, db: "timeout", ms }, { status: 503, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ ok: true, db: "up", ms }, { headers: { "Cache-Control": "no-store" } });
}
