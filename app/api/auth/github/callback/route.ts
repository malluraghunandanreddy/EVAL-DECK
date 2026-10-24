import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema, logEvent } from "@/lib/db";
import { encrypt, safeEqual } from "@/lib/crypto";
import { getSessionUserId, setSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const OAUTH_STATE_COOKIE = "pd_oauth_state";
const GH_HEADERS = { Accept: "application/vnd.github+json", "User-Agent": "PolicyDrift", "X-GitHub-Api-Version": "2022-11-28" };

type GhUser = { id: number; login: string; email: string | null };
type GhEmail = { email: string; primary: boolean; verified: boolean };

function fail(base: string, code: string) {
  const res = NextResponse.redirect(new URL(`/signup/email?error=${encodeURIComponent(code)}`, base));
  res.cookies.delete(OAUTH_STATE_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  const base = process.env.APP_BASE_URL ?? req.nextUrl.origin;
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookie = req.cookies.get(OAUTH_STATE_COOKIE)?.value ?? "";
  const [expectedState, next = ""] = cookie.split("|");

  if (req.nextUrl.searchParams.get("error")) return fail(base, "github_denied");
  if (!code || !state || !expectedState || !safeEqual(state, expectedState)) return fail(base, "bad_state");

  // 1. Exchange the code for a token
  let token: string;
  let scopes: string[];
  try {
    const tokRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${base}/api/auth/github/callback`,
      }),
    });
    const tok = (await tokRes.json()) as { access_token?: string; scope?: string; error?: string };
    if (!tok.access_token) return fail(base, tok.error ?? "token_exchange_failed");
    token = tok.access_token;
    scopes = (tok.scope ?? "").split(/[,\s]+/).filter(Boolean);
  } catch {
    return fail(base, "token_exchange_failed");
  }

  // 2. Who is this?
  const auth = { ...GH_HEADERS, Authorization: `Bearer ${token}` };
  const userRes = await fetch("https://api.github.com/user", { headers: auth });
  if (!userRes.ok) return fail(base, "github_user_failed");
  const gh = (await userRes.json()) as GhUser;
  let email = gh.email;
  if (!email) {
    try {
      const er = await fetch("https://api.github.com/user/emails", { headers: auth });
      if (er.ok) {
        const list = (await er.json()) as GhEmail[];
        email = (list.find((e) => e.primary && e.verified) ?? list.find((e) => e.verified))?.email ?? null;
      }
    } catch {
      /* email is optional */
    }
  }

  const privateRepoAccess = scopes.includes("repo");
  const tokenEnc = encrypt(token);

  // 3. Upsert by github_id (or link GitHub to a signed-in email-only user)
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.githubId, gh.id)).limit(1);
  let userId: string;
  let isNew = false;
  if (existing) {
    userId = existing.id;
    await db
      .update(schema.users)
      .set({ githubLogin: gh.login, email: existing.email ?? email, githubTokenEnc: tokenEnc, privateRepoAccess })
      .where(eq(schema.users.id, existing.id));
  } else {
    const sessionId = await getSessionUserId();
    const [current] = sessionId
      ? await db.select().from(schema.users).where(eq(schema.users.id, sessionId)).limit(1)
      : [];
    if (current && current.githubId == null) {
      userId = current.id;
      await db
        .update(schema.users)
        .set({ githubId: gh.id, githubLogin: gh.login, email: current.email ?? email, githubTokenEnc: tokenEnc, privateRepoAccess })
        .where(eq(schema.users.id, current.id));
      await logEvent("signup", userId, { method: "github_link", github_login: gh.login });
    } else {
      const [created] = await db
        .insert(schema.users)
        .values({ githubId: gh.id, githubLogin: gh.login, email, githubTokenEnc: tokenEnc, privateRepoAccess })
        .returning({ id: schema.users.id });
      userId = created.id;
      isNew = true;
      await logEvent("signup", userId, { method: "github", github_login: gh.login, private_repo_access: privateRepoAccess });
    }
  }

  await setSession(userId);

  let dest = next;
  if (!dest) {
    const [proj] = isNew
      ? []
      : await db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.userId, userId)).limit(1);
    dest = proj ? "/dashboard" : "/onboarding";
  }
  const res = NextResponse.redirect(new URL(dest, base));
  res.cookies.delete(OAUTH_STATE_COOKIE);
  return res;
}
