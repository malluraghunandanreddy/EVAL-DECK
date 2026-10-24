import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { liveStats } from "@/lib/admin-live";

export const dynamic = "force-dynamic";

// GET /admin/live/data  (admin cookie, path=/admin) -> live counts for the hackathon board
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await liveStats(), { headers: { "Cache-Control": "no-store" } });
}
