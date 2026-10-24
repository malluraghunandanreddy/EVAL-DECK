import { NextResponse } from "next/server";
import { decrypt } from "@/lib/crypto";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type GhRepo = {
  id: number;
  full_name: string;
  private: boolean;
  default_branch: string;
  pushed_at: string | null;
  description: string | null;
  language: string | null;
  html_url: string;
};

// GET /api/github/repos -> the signed-in user's repos (public, plus private if `repo` scope was granted), newest push first
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (!user.githubTokenEnc) {
    return NextResponse.json({ repos: [], connected: false, privateRepoAccess: false });
  }

  let token: string;
  try {
    token = decrypt(user.githubTokenEnc);
  } catch {
    return NextResponse.json({ error: "Stored GitHub token is unreadable. Sign in with GitHub again." }, { status: 500 });
  }

  const repos: GhRepo[] = [];
  // Up to 300 repos (3 pages) is plenty for the picker.
  for (let page = 1; page <= 3; page++) {
    const url = new URL("https://api.github.com/user/repos");
    url.searchParams.set("sort", "pushed");
    url.searchParams.set("direction", "desc");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    url.searchParams.set("affiliation", "owner,collaborator,organization_member");
    url.searchParams.set("visibility", user.privateRepoAccess ? "all" : "public");
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "PolicyDrift",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    });
    if (res.status === 401) {
      return NextResponse.json({ error: "GitHub sign-in expired. Sign in with GitHub again.", reauth: true }, { status: 401 });
    }
    if (!res.ok) {
      return NextResponse.json({ error: `GitHub returned ${res.status}` }, { status: 502 });
    }
    const batch = (await res.json()) as GhRepo[];
    repos.push(...batch);
    if (batch.length < 100) break;
  }

  repos.sort((a, b) => (b.pushed_at ?? "").localeCompare(a.pushed_at ?? ""));
  return NextResponse.json({
    connected: true,
    privateRepoAccess: user.privateRepoAccess,
    repos: repos.map((r) => ({
      fullName: r.full_name,
      private: r.private,
      defaultBranch: r.default_branch,
      pushedAt: r.pushed_at,
      description: r.description,
      language: r.language,
      url: r.html_url,
    })),
  });
}
