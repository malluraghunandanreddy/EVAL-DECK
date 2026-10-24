import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TriLens",
  description: "Find the gaps between your privacy policy, your code and your database. DPDP, GDPR, CCPA.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=IBM+Plex+Mono:wght@400;500;600&family=Newsreader:ital,opsz,wght@0,6..72,400..600;1,6..72,400..600&display=swap"
        />
      </head>
      <body>
        {children}
        <footer className="legal">
          TriLens is an automated check, not legal advice. <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a>
        </footer>
      </body>
    </html>
  );
}
