import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/config/locales";
import { getConfig } from "@/config/env";
import { getPage, getSite } from "@/lib/engine-client";
import { buildPageMetadata } from "@/lib/seo";
import { PageView } from "@/components/PageView";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale, getConfig().locales)) return {};
  const [page, site] = await Promise.all([getPage(locale, ""), getSite()]);
  return page ? buildPageMetadata(page, site) : {};
}

/** Home page = the WebPage with an empty slug for this locale. */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale, getConfig().locales)) notFound();

  const [page, site] = await Promise.all([getPage(locale, ""), getSite()]);
  if (!page) notFound();

  return <PageView page={page} site={site} />;
}
