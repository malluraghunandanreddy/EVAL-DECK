import LegalPage from "../components/LegalPage";

export const metadata = { title: "Privacy · TriLens" };

export default function Privacy() {
  return (
    <LegalPage title="Privacy policy" updated="24 October 2026">
      <h2>What we collect</h2>
      <ul>
        <li><strong>Account:</strong> your GitHub login and email address, or the email you sign up with.</li>
        <li><strong>Projects:</strong> the app name, the repository name, the markets you select and the privacy policy URL you give us.</li>
        <li><strong>Reports:</strong> the findings from each scan, including short code excerpts used as evidence.</li>
        <li><strong>Database check (optional):</strong> if you paste a database connection string, we use it for one read-only check and then discard it. We keep only table and column names and counts; no rows and no credentials are stored or sent to an AI.</li>
        <li><strong>Usage:</strong> events such as sign-up, scan started and finished, and interest in a paid plan, so we can run the service and count hackathon usage.</li>
      </ul>
      <h2>What we read</h2>
      <p>With your permission we read the repository you select. Private repositories are read only if you grant that access in a separate GitHub step. We do not keep a copy of your repository. Your GitHub access token is stored encrypted.</p>
      <h2>Why we use it</h2>
      <p>To run scans, show your reports, draft your policy, and, if you register interest in a paid plan, to email you about it. We do not sell personal data.</p>
      <h2>Who processes it for us</h2>
      <ul>
        <li>GitHub, for sign-in and repository access.</li>
        <li>Our database and hosting providers.</li>
        <li>Our policy-review workflow, which receives the draft policy text for review.</li>
        <li>A payment provider, once paid plans open.</li>
      </ul>
      <h2>Your choices</h2>
      <p>You can ask us to delete your account, projects and reports at any time. You can also revoke TriLens from your GitHub settings under Applications.</p>
    </LegalPage>
  );
}
