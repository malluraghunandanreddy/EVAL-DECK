import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

export const dynamic = "force-dynamic";

const OAUTH_STATE_COOKIE = "pd_oauth_state";

// GET /api/auth/github            -> sign in with read:user user:email (public repos need nothing more)
// GET /api/auth/github?private=1  -> re-authorise adding `repo` for private repositories
export async function GET(req: NextRequest) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const base = process.env.APP_BASE_URL ?? req.nextUrl.origin;
  if (!clientId) {
    return NextResponse.redirect(new URL("/signup/email?error=github_not_configured", base));
  }
  const wantsPrivate = req.nextUrl.searchParams.get("private") === "1";
  const nextParam = req.nextUrl.searchParams.get("next") ?? "";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : wantsPrivate ? "/onboarding" : "";
  const state = randomBytes(16).toString("hex");

  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", `${base}/api/auth/github/callback`);
  url.searchParams.set("scope", wantsPrivate ? "read:user user:email repo" : "read:user user:email");
  url.searchParams.set("state", state);
  url.searchParams.set("allow_signup", "true");

  const res = NextResponse.redirect(url.toString());
  res.cookies.set(OAUTH_STATE_COOKIE, `${state}|${next}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
