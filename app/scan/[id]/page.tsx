import type { Metadata } from "next";
import ScanReport from "./ScanReport";
import SiteHeader from "../../components/SiteHeader";
import "../report.css";

export const metadata: Metadata = { title: "Privacy report · TriLens" };

export default async function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <SiteHeader current="scan" />
      <ScanReport scanId={id} />
    </>
  );
}
