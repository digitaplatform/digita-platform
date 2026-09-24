import { NextResponse } from "next/server";
import { buildCatalog } from "@/catalog";

/**
 * Catalog endpoint for tooling: the blocks and plugins this renderer can
 * place, each with its props schema. A visual page builder reads this to populate
 * its palette and config forms. Constant data — no engine, no env.
 */
export function GET(): NextResponse {
  return NextResponse.json(buildCatalog());
}
