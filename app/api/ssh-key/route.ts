import { NextResponse } from "next/server";
import { getUser } from "@/lib/session";
import { getOrCreateSshKey } from "@/lib/sshkey";

export const dynamic = "force-dynamic";

// GET /api/ssh-key -> { publicKey }: the signed-in user's TriLens access key (created on first request).
// Only the public half is ever returned.
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const { publicKey } = await getOrCreateSshKey(user);
  return NextResponse.json({ publicKey }, { headers: { "Cache-Control": "no-store" } });
}
