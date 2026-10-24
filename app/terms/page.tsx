import LegalPage from "../components/LegalPage";
import SiteHeader from "../components/SiteHeader";
import { HostedDoc, loadHosted } from "@/lib/policy/hosted";

export const dynamic = "force-dynamic";

export const metadata = { title: "Terms · TriLens" };

export default async function Terms() {
  // Dogfooding: when OWN_SITE_ID points at TriLens' own published site, serve the approved TriLens-generated document.
  const own = process.env.OWN_SITE_ID;
  const hosted = own ? await loadHosted(own).catch(() => null) : null;
  if (hosted?.version) {
    return (
      <>
        <SiteHeader />
        <HostedDoc kind="terms" siteId={hosted.site.id} siteName={hosted.site.name} md={hosted.version.termsMd} approvedAt={hosted.version.approvedAt} outOfDate={hosted.site.outOfDate} />
      </>
    );
  }
  return (
    <LegalPage title="Terms of use" updated="24 October 2026">
      <h2>What TriLens is</h2>
      <p>TriLens scans a GitHub repository you choose and compares what it finds with your privacy policy and with data protection laws such as India's DPDP Act, the GDPR and the CCPA. It produces a report and, on request, a draft privacy policy and terms.</p>
      <h2>Not legal advice</h2>
      <p>Reports and drafts are automated technical findings. They are not legal advice and do not certify that you comply with any law. Have a qualified person review anything before you publish it.</p>
      <h2>Free and paid</h2>
      <ul>
        <li><strong>Free:</strong> unlimited scans of repositories you have the right to scan, with every gap and its evidence, and the first two sections of the policy draft.</li>
        <li><strong>Single report and Pro monthly:</strong> add the fix for each gap, the full policy and terms draft, and the other features listed on the pricing page. Paid plans are not on sale yet. Registering interest is not a purchase and creates no obligation on either side.</li>
        <li>When paid plans open, prices will be shown in rupees and exclude GST, and refund terms will be stated before you pay.</li>
      </ul>
      <h2>Your responsibilities</h2>
      <ul>
        <li>Only scan repositories you own or are allowed to scan.</li>
        <li>Do not use TriLens to attack, overload or probe systems you do not control.</li>
        <li>Check drafts before you publish them. You are responsible for what your site says.</li>
      </ul>
      <h2>Availability</h2>
      <p>This is a beta built for a hackathon. It may change, break or be withdrawn, and reports may contain mistakes or miss issues.</p>
    </LegalPage>
  );
}
