"use client";

import { useEffect } from "react";
import { loadDeliveredIdentity, type DeliveredIdentitySources } from "@/lib/delivered-identity";

/** After hydration, brings a signed-in visitor's stored choices and their design plugin onto the
 *  page (loadDeliveredIdentity). Renders nothing. */
export function DeliveredIdentity({ apps, authUrl, authCookieSuffix }: DeliveredIdentitySources) {
  const appList = apps.join(",");
  useEffect(() => {
    loadDeliveredIdentity({ apps: appList.split(",").filter(Boolean), authUrl, authCookieSuffix }).catch((err: unknown) =>
      console.error("[identity] the visitor's choices and design could not be loaded", err),
    );
  }, [appList, authUrl, authCookieSuffix]);
  return null;
}
