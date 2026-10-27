import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import Onboarding from "./Onboarding";
import { maxReposPerAudit } from "@/lib/groups";
import SiteHeader from "../components/SiteHeader";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await getUser();
  if (!user) redirect("/signin?next=/onboarding");
  return (
    <>
    <SiteHeader />
    <Onboarding
      githubLogin={user.githubLogin}
      githubConnected={Boolean(user.githubTokenEnc)}
      privateRepoAccess={user.privateRepoAccess}
      maxRepos={maxReposPerAudit(user)}
      githubClientId={process.env.GITHUB_CLIENT_ID ?? null}
    />
    </>
  );
}
