"use client";

import { useEffect } from "react";
import { loadDeliveredIdentity, type DeliveredIdentitySources } from "@/lib/delivered-identity";

/** After hydration, brings a signed-in visitor's design and signature plugins onto the page
 *  (loadDeliveredIdentity). Renders nothing. */
export function DeliveredIdentity({ apps, authUrl, authCookieSuffix }: DeliveredIdentitySources) {
  const appList = apps.join(",");
  useEffect(() => {
    loadDeliveredIdentity({ apps: appList.split(",").filter(Boolean), authUrl, authCookieSuffix }).catch((err: unknown) =>
      console.error("[identity] the visitor's design and signature could not be loaded", err),
    );
  }, [appList, authUrl, authCookieSuffix]);
  return null;
}
