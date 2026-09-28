"use client";

import type { ButtonHTMLAttributes } from "react";
import { openContactSheet } from "@/lib/contact-sheet";

/** A call to action whose target is the contact sheet, not a page. The only client piece of the
 *  marketing blocks, so the blocks themselves stay server-rendered. */
export function SheetButton(props: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "type">) {
  return <button type="button" {...props} onClick={openContactSheet} />;
}
