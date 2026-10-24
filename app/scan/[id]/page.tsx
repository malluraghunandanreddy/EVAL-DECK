import type { Metadata } from "next";
import ScanReport from "./ScanReport";
import "../report.css";

export const metadata: Metadata = { title: "Privacy report · PolicyDrift" };

export default async function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ScanReport scanId={id} />;
}
