"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { PublicSiteConfig } from "./public";

/**
 * Carries the browser-safe runtime config from the server (which read it from env)
 * to client components — so client code never bakes a NEXT_PUBLIC value and the
 * same image serves any site. Populated once in the root layout.
 */
const Ctx = createContext<PublicSiteConfig | null>(null);

export function ConfigProvider({ value, children }: { value: PublicSiteConfig; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSiteConfig(): PublicSiteConfig {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSiteConfig must be used within <ConfigProvider>");
  return c;
}
