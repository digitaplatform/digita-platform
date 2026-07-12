import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/config/locales";
import { getConfig } from "@/config/env";
import { getPage, getSite } from "@/lib/engine-client";
import { buildPageMetadata } from "@/lib/seo";
import { PageView } from "@/components/PageView";

// Rendered on-demand; config + content are runtime (engine fetches are TTL-cached).
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string[] }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale, getConfig().locales)) return {};
  const [page, site] = await Promise.all([getPage(locale, slug.join("/")), getSite()]);
  return page ? buildPageMetadata(page, site) : {};
}

export default async function ContentPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string[] }>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale, getConfig().locales)) notFound();

  const [page, site] = await Promise.all([getPage(locale, slug.join("/")), getSite()]);
  if (!page) notFound();

  return <PageView page={page} site={site} />;
}
