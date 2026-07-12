"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { NavItem } from "@/lib/types";
import { navHref } from "@/lib/nav";

/**
 * Mobile (hamburger) navigation — the phone counterpart to the desktop NavLinks,
 * which is `hidden md:flex`. Renders a toggle button visible only below `md`; when
 * open, a full-width panel drops below the header with the nav items stacked. The
 * active page is highlighted with the same accent pill as the desktop nav. Closes
 * on route change, on Escape, and on backdrop tap; locks body scroll while open.
 */
export function MobileNav({
  locale,
  items,
  openLabel,
  closeLabel,
}: {
  locale: string;
  items: NavItem[];
  openLabel: string;
  closeLabel: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const homeHref = `/${locale}`;

  // Close when the route changes (a link inside the panel was followed).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // While open: Escape closes, and the page behind is scroll-locked.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!items.length) return null;

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label={open ? closeLabel : openLabel}
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-line text-fg-muted transition-colors hover:bg-hover hover:text-fg"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-x-0 bottom-0 top-16 z-30 bg-black/30 md:hidden"
          />
          <div
            id="mobile-nav-panel"
            className="fixed inset-x-0 top-16 z-40 max-h-[calc(100vh-4rem)] overflow-y-auto border-b border-line bg-card shadow-lg md:hidden"
          >
            <nav aria-label="Primary" className="mx-auto flex max-w-6xl flex-col gap-1 px-6 py-4">
              {items.map((item, i) => {
                const href = navHref(locale, item);
                const active =
                  href === homeHref ? pathname === homeHref : pathname === href || pathname.startsWith(href + "/");
                return (
                  <Link
                    key={`${item.label}-${i}`}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={
                      active
                        ? "rounded-xl bg-primary-soft px-4 py-3 text-base font-semibold text-primary"
                        : "rounded-xl px-4 py-3 text-base font-medium text-fg transition-colors hover:bg-hover"
                    }
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </>
      )}
    </div>
  );
}
