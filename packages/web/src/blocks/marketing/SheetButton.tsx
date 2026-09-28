"use client";

import type { ButtonHTMLAttributes } from "react";
import { openContactSheet } from "@/lib/contact-sheet";
import { useSiteConfig } from "@/config/ConfigProvider";

/** A call to action whose target is the contact sheet, not a page. The only client piece of the
 *  marketing blocks, so the blocks themselves stay server-rendered. Where the site offers no
 *  contact sheet it renders nothing, so no button opens nothing. */
export function SheetButton(props: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "type">) {
  if (!useSiteConfig().contactEnabled) return null;
  return <button type="button" {...props} onClick={openContactSheet} />;
}
