import type { User } from "./db/schema";
import { isMonthly } from "./entitlements";

/** How many repos one multi-repo audit may hold. Enforced on the server in POST /api/groups. */
export function maxReposPerAudit(user: Pick<User, "isPro" | "proUntil">): number {
  return isMonthly(user) ? 10 : 3;
}
