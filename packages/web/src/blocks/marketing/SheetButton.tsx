"use client";

import type { ButtonHTMLAttributes } from "react";
import { openContactSheet } from "@/lib/contact-sheet";
import { useSiteConfig } from "@/config/ConfigProvider";

/** A call to action whose target is the contact sheet, not a page. The only client piece of the
 *  marketing blocks, so the blocks themselves stay server-rendered. Where the site offers no
 *  contact sheet it renders nothing, so no button opens nothing. */
export function SheetButton({
  onOpen,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "type"> & {
  /** Closes the menu or drawer the button sits in, so the sheet does not open behind it. */
  onOpen?: () => void;
}) {
  if (!useSiteConfig().contactEnabled) return null;
  return (
    <button
      type="button"
      {...props}
      onClick={() => {
        openContactSheet();
        onOpen?.();
      }}
    />
  );
}
