import SiteHeader from "./SiteHeader";
import "./legal.css";

export default function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  const contact = process.env.CONTACT_EMAIL;
  return (
    <>
      <SiteHeader />
      <main className="container legal-doc">
        <p className="eyebrow">Last updated {updated}</p>
        <h1>{title}</h1>
        <p className="draft">Beta draft. This text describes how the hackathon beta works today and will be reviewed by a lawyer before general launch.</p>
        {children}
        {contact && <p>Questions: <a href={`mailto:${contact}`}>{contact}</a></p>}
      </main>
    </>
  );
}
