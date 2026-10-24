import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import Onboarding from "./Onboarding";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await getUser();
  if (!user) redirect("/api/auth/github");
  return (
    <Onboarding
      githubLogin={user.githubLogin}
      githubConnected={Boolean(user.githubTokenEnc)}
      privateRepoAccess={user.privateRepoAccess}
    />
  );
}
