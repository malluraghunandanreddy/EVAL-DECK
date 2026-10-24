import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PolicyDrift",
  description: "Find the gaps between your privacy policy, your code and your database. DPDP, GDPR, CCPA.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <footer className="legal">PolicyDrift is an automated check, not legal advice.</footer>
      </body>
    </html>
  );
}
