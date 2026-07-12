import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Audience, AudienceConfig, AudienceMap } from "@digitaplatform/shared";

/**
 * App-declared plugin configuration. An app (an APP_DIR) ships a
 * `plugins.config.json` declaring WHICH central frontend plugins it enables and
 * WHERE they sit (the layout/placement). This is opaque app-composition config:
 * the engine relays it to the operator frontend but does NOT interpret it (no
 * knowledge of templates, regions, or navigation). A nav plugin reads its own
 * data via the generic resource API — never through the engine.
 *
 * Shape (all keys optional):
 *   {
 *     "plugins": [{ "id": "usermenu", "title": "Navigation" }],
 *     "layout":  { "template": "classic", "regions": { "left": "usermenu" } }
 *   }
 */

export interface PluginSelection {
  id: string;
  title?: string;
}

export interface FrontendLayout {
  template: string;
  regions: Record<string, string>;
}

/** Parsed + relayed config (the engine never interprets layout's contents). */
export interface PluginRuntime {
  plugins: PluginSelection[];
  layout: FrontendLayout | null;
  /**
   * Per-app audience declaration (ADR-A3): which tiers (anonymous/external/
   * internal) this app serves and how. Relayed verbatim on /boot for the shell
   * to interpret — the engine never acts on it. Empty `{}` when no app declares
   * one (= internal-only app = today's behaviour).
   */
  audiences: AudienceMap;
}

interface RawConfigShape {
  plugins?: unknown;
  layout?: unknown;
  audiences?: unknown;
}

const AUDIENCE_KEYS: readonly Audience[] = ["anonymous", "external", "internal"];

/**
 * Read + merge `<appDir>/plugins.config.json` across all app dirs (discovered
 * like seeds). Later app dirs win for `layout`; `plugins` accumulate. Throws
 * (fail-loud at boot) on malformed JSON or an invalid shape — a silently
 * ignored bad config would leave the operator with an unexplained empty shell.
 */
export async function loadPluginConfig(appDirs: string[]): Promise<PluginRuntime> {
  const merged: PluginRuntime = { plugins: [], layout: null, audiences: {} };

  for (const dir of appDirs) {
    const file = join(dir, "plugins.config.json");
    let raw: string;
    try {
      raw = await readFile(file, "utf-8");
    } catch {
      continue; // no plugin config in this app dir — fine
    }

    let parsed: RawConfigShape;
    try {
      parsed = JSON.parse(raw) as RawConfigShape;
    } catch (e) {
      throw new Error(`[plugins] ${file} is not valid JSON: ${(e as Error).message}`);
    }

    if (parsed.plugins !== undefined) {
      if (!Array.isArray(parsed.plugins)) {
        throw new Error(`[plugins] ${file}: "plugins" must be an array`);
      }
      for (const entry of parsed.plugins) {
        const p = entry as { id?: unknown; title?: unknown };
        if (!p || typeof p.id !== "string" || p.id.length === 0) {
          throw new Error(`[plugins] ${file}: every plugin needs a non-empty string "id"`);
        }
        merged.plugins.push({
          id: p.id,
          title: typeof p.title === "string" ? p.title : undefined,
        });
      }
    }

    if (parsed.layout !== undefined && parsed.layout !== null) {
      const l = parsed.layout as { template?: unknown; regions?: unknown };
      if (typeof l.template !== "string" || typeof l.regions !== "object" || l.regions === null) {
        throw new Error(`[plugins] ${file}: "layout" must be { template: string, regions: object }`);
      }
      merged.layout = { template: l.template, regions: l.regions as Record<string, string> };
    }

    // Audience map (ADR-A3). Additive + optional: absent leaves merged.audiences
    // as {} (internal-only app). Fail-loud on a bad shape so a broken tier
    // declaration can't silently ship an ungated shell. Later app dirs win per tier.
    if (parsed.audiences !== undefined && parsed.audiences !== null) {
      if (typeof parsed.audiences !== "object" || Array.isArray(parsed.audiences)) {
        throw new Error(`[plugins] ${file}: "audiences" must be an object keyed by tier`);
      }
      for (const [tier, cfg] of Object.entries(parsed.audiences as Record<string, unknown>)) {
        if (!AUDIENCE_KEYS.includes(tier as Audience)) {
          throw new Error(
            `[plugins] ${file}: "audiences" key "${tier}" is not one of ${AUDIENCE_KEYS.join("/")}`,
          );
        }
        const c = cfg as { enabled?: unknown };
        if (!c || typeof c !== "object" || typeof c.enabled !== "boolean") {
          throw new Error(`[plugins] ${file}: audiences.${tier} must be an object with a boolean "enabled"`);
        }
        merged.audiences[tier as Audience] = cfg as AudienceConfig;
      }
    }
  }

  return merged;
}
