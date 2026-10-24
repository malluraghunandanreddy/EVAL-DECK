import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HostedDoc, loadHosted } from "@/lib/policy/hosted";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ siteId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await loadHosted((await params).siteId);
  return { title: data ? `Privacy Policy: ${data.site.name}` : "Privacy Policy", robots: { index: true } };
}

export default async function Page({ params }: Props) {
  const data = await loadHosted((await params).siteId);
  if (!data) notFound();
  return (
    <HostedDoc
      kind="policy"
      siteId={data.site.id}
      siteName={data.site.name}
      md={data.version?.policyMd ?? null}
      approvedAt={data.version?.approvedAt ?? null}
      outOfDate={data.site.outOfDate}
    />
  );
}
