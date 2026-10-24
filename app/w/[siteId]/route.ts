import { eq } from "drizzle-orm";
import { db, logEvent, schema } from "@/lib/db";
import { UUID_RE } from "@/lib/agent/access";
import { latestApproved } from "@/lib/agent/review";
import { computeInventory, labelFor, projectFrameworks, scanParts } from "@/lib/policy/inventory";
import { proForAll } from "@/lib/plans";

export const dynamic = "force-dynamic";

type WidgetData = {
  appName: string;
  status: "approved" | "pending" | "unknown";
  dataTypes: string[];
  vendors: { name: string; category: string; region: string }[];
  frameworks: string[];
  lastVerified: string | null;
  outOfDate: boolean;
  pro: boolean;
  policyUrl: string;
  termsUrl: string;
  homeUrl: string;
};

function js(data: WidgetData): string {
  // JSON in a JS string context: escape < so "</script>" can't break out if inlined, and U+2028/9.
  const json = JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(new RegExp(String.fromCharCode(0x2028), "g"), "\\u2028")
    .replace(new RegExp(String.fromCharCode(0x2029), "g"), "\\u2029");
  return `/* PolicyDrift widget: what this app collects. Not legal advice. */
(function () {
  var d = ${json};
  var me = document.currentScript;
  var host = document.getElementById("policydrift-widget");
  if (!host) { host = document.createElement("div"); if (me && me.parentNode) me.parentNode.insertBefore(host, me.nextSibling); else document.body.appendChild(host); }
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  var style = el("style");
  style.textContent = ".pd{font:14px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif;color:#1d2330;background:#fff;border:1px solid #dfe3eb;border-radius:12px;padding:14px 16px;max-width:420px;box-sizing:border-box}"
    + ".pd h4{margin:0 0 8px;font-size:15px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}"
    + ".pd .b{font-size:11px;font-weight:600;padding:2px 7px;border-radius:999px;background:#eef1ff;color:#3549c7}"
    + ".pd .warn{background:#fff3df;color:#9a5b00}.pd .ok{background:#e4f8ef;color:#137a4b}"
    + ".pd .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6b7385;margin:10px 0 4px}"
    + ".pd ul{margin:0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:6px}.pd li{background:#f3f5f9;border-radius:6px;padding:2px 8px;font-size:12.5px}"
    + ".pd .f{margin-top:12px;font-size:12px;color:#6b7385;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}.pd a{color:#3549c7}"
    + "@media (prefers-color-scheme:dark){.pd{background:#141821;color:#e8ebf2;border-color:#2a3140}.pd li{background:#1d2330}.pd .lbl,.pd .f{color:#9aa3b5}.pd a{color:#8ea4ff}}";
  root.appendChild(style);
  var box = el("div", "pd");
  var h = el("h4", null, "What " + d.appName + " collects");
  if (d.outOfDate) h.appendChild(el("span", "b warn", "Out of date, review pending"));
  else if (d.status === "approved") h.appendChild(el("span", "b ok", "Verified"));
  if (d.pro) h.appendChild(el("span", "b", "Pro"));
  box.appendChild(h);
  function list(title, items) {
    if (!items.length) return;
    box.appendChild(el("div", "lbl", title));
    var ul = el("ul");
    for (var i = 0; i < items.length; i++) ul.appendChild(el("li", null, items[i]));
    box.appendChild(ul);
  }
  if (d.status !== "approved") box.appendChild(el("div", null, "This app's privacy disclosure is awaiting review."));
  list("Personal data", d.dataTypes);
  list("Shared with", d.vendors.map(function (v) { return v.name + " (" + v.category + ", " + v.region + ")"; }));
  list("Privacy laws covered", d.frameworks);
  var f = el("div", "f");
  var left = el("span", null, d.lastVerified ? "Last verified " + d.lastVerified + " \\u00b7 " : "");
  if (d.status === "approved") { var p = el("a", null, "Privacy policy"); p.href = d.policyUrl; p.target = "_blank"; p.rel = "noopener"; left.appendChild(p); left.appendChild(document.createTextNode(" \\u00b7 ")); var t = el("a", null, "Terms"); t.href = d.termsUrl; t.target = "_blank"; t.rel = "noopener"; left.appendChild(t); }
  f.appendChild(left);
  var by = el("a", null, "Scanned by PolicyDrift"); by.href = d.homeUrl; by.target = "_blank"; by.rel = "noopener";
  f.appendChild(by);
  box.appendChild(f);
  root.appendChild(box);
})();
`;
}

const REGION: Record<string, string> = { us: "US", eu: "EU", in: "India", unknown: "location unknown" };

export async function GET(req: Request, ctx: { params: Promise<{ siteId: string }> }) {
  const { siteId: raw } = await ctx.params;
  const siteId = raw.replace(/\.js$/i, "");
  const headers = {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "public, max-age=60, s-maxage=60",
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
  };
  if (!UUID_RE.test(siteId)) return new Response("/* PolicyDrift: unknown widget id */", { status: 404, headers });

  const [row] = await db
    .select({ site: schema.sites, project: schema.projects, isPro: schema.users.isPro })
    .from(schema.sites)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.sites.projectId))
    .leftJoin(schema.users, eq(schema.users.id, schema.projects.userId))
    .where(eq(schema.sites.id, siteId))
    .limit(1);
  if (!row) return new Response("/* PolicyDrift: unknown widget id */", { status: 404, headers });

  const base = (process.env.APP_BASE_URL || new URL(req.url).origin).replace(/\/$/, "");
  const frameworks = projectFrameworks(row.project);
  const version = await latestApproved(siteId);
  let dataTypes: string[] = [];
  let vendors: WidgetData["vendors"] = [];
  if (version) {
    const [scan] = await db.select().from(schema.scans).where(eq(schema.scans.id, version.scanId)).limit(1);
    if (scan) {
      const inv = computeInventory(scanParts(scan), frameworks);
      dataTypes = inv.dataTypes.map(labelFor);
      vendors = inv.vendors.map((v) => ({ name: v.name, category: v.category, region: REGION[v.region] ?? v.region }));
    }
  }

  const data: WidgetData = {
    appName: row.site.name || row.project.name,
    status: version ? "approved" : "pending",
    dataTypes,
    vendors,
    frameworks,
    lastVerified: version?.approvedAt ? version.approvedAt.toISOString().slice(0, 10) : null,
    outOfDate: row.site.outOfDate,
    pro: !!row.isPro || proForAll(),
    policyUrl: `${base}/p/${siteId}`,
    termsUrl: `${base}/t/${siteId}`,
    homeUrl: base,
  };

  await logEvent("widget_view", row.project.userId, {
    siteId,
    policyVersionId: version?.id ?? null,
    referer: (req.headers.get("referer") ?? "").slice(0, 200) || null,
  });
  return new Response(js(data), { status: 200, headers });
}
