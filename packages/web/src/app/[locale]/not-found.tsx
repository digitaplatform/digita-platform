"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { buttonAttributes } from "@digitaplatform/components";
import { useSiteConfig } from "@/config/ConfigProvider";
import { localePath } from "@/lib/nav";

/** The locale's 404, inside the locale chrome: its texts come from the layout, because a
 *  not-found page gets no params of its own, and the home link stays in the locale. */
export default function LocaleNotFound() {
  const { locale } = useParams<{ locale: string }>();
  const { notFound, defaultLocale } = useSiteConfig();
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col items-center px-6 py-32 text-center">
      <p className="text-sm font-medium text-primary-600">404</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-textMain">{notFound.title}</h1>
      <p className="mt-3 text-textMuted">{notFound.body}</p>
      <Link href={localePath(locale, defaultLocale)} {...buttonAttributes({ className: "mt-8" })}>
        {notFound.home}
      </Link>
    </section>
  );
}
