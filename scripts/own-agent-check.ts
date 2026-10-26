// Quick check of TriLens' own agent: npx tsx scripts/own-agent-check.ts  (needs ANTHROPIC_API_KEY)
import { runAgent } from "../lib/ai";

async function main() {
  const r = await runAgent(undefined, "extract_claims", {
    policy_text: "We collect your name and email to run your account. We never share data with third parties. We keep it for 12 months.",
  }, 30_000);
  console.log(JSON.stringify(r, null, 2));
}
main();
