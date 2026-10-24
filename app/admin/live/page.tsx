import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin";
import SiteHeader from "../../components/SiteHeader";
import LiveBoard from "./LiveBoard";
import { liveStats } from "@/lib/admin-live";
import "../proof/proof.css";
import "./live.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live users · TriLens" };

export default async function AdminLive() {
  if (!(await isAdmin())) redirect("/admin/proof");
  const initial = await liveStats();
  return (
    <>
      <SiteHeader />
      <main className="container" style={{ maxWidth: 1100 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <h1 style={{ margin: 0 }}>Live users</h1>
          <a className="btn secondary sm" href="/admin/proof">Full proof page</a>
        </div>
        <LiveBoard initial={initial} />
      </main>
    </>
  );
}
