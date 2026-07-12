import type { UserContext } from "../permissions/types.js";

export interface ResolverContext {
  root: Record<string, unknown> | null;
  user: UserContext;
  params: Record<string, unknown>;
  now: Date;
  /** Collected during resolution so the runner can attach warnings to the section. */
  warnings: string[];
}

export class TokenResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenResolutionError";
  }
}

const RESERVED_PREFIXES = ["$root.", "$user.", "$param.", "$now"];

/**
 * Walk a JSON tree replacing reserved tokens at string LEAVES (values).
 * Object keys are never resolved. Mongo's own `$field` references are
 * never altered because they don't start with a reserved prefix.
 *
 * Returns a deep clone — the input is left untouched.
 */
export function resolveTokens<T>(node: T, ctx: ResolverContext): T {
  return walk(node, ctx) as T;
}

function walk(node: unknown, ctx: ResolverContext): unknown {
  if (node === null || node === undefined) return node;
  if (Array.isArray(node)) return node.map((child) => walk(child, ctx));
  if (typeof node === "object") {
    if (node instanceof Date) return new Date(node.getTime());
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = walk(v, ctx);
    }
    return out;
  }
  if (typeof node === "string") return resolveString(node, ctx);
  return node;
}

/**
 * Resolve a single string. Returns the resolved value if the string is a
 * reserved token, otherwise returns the input verbatim.
 */
export function resolveString(s: string, ctx: ResolverContext): unknown {
  // Escape: leading backslash returns the literal sans backslash.
  if (s.startsWith("\\$")) return s.slice(1);

  // Cheap prefix probe — if the string isn't one of ours, return as-is.
  if (!RESERVED_PREFIXES.some((p) => s === "$now" || s.startsWith(p))) {
    return s;
  }

  // $now [± duration]
  if (s === "$now") return new Date(ctx.now.getTime());

  const nowOp = s.match(/^\$now\s*([+-])\s*(.+)$/);
  if (nowOp) {
    const sign = nowOp[1] === "-" ? -1 : 1;
    const durationToken = nowOp[2]!.trim();
    const duration = parseDurationToken(durationToken, ctx);
    if (duration === null) {
      ctx.warnings.push(`unresolved duration in token "${s}"`);
      return null;
    }
    return applyDuration(ctx.now, sign, duration);
  }

  // $root.<path>
  const rootMatch = s.match(/^\$root\.(.+)$/);
  if (rootMatch) {
    if (!ctx.root) {
      ctx.warnings.push(`"${s}" used in unanchored view`);
      return null;
    }
    const v = getPath(ctx.root as Record<string, unknown>, rootMatch[1]!);
    if (v === undefined) ctx.warnings.push(`unresolved path "${s}"`);
    return v ?? null;
  }

  // $user.<path>
  const userMatch = s.match(/^\$user\.(.+)$/);
  if (userMatch) {
    const v = getPath(ctx.user as unknown as Record<string, unknown>, userMatch[1]!);
    if (v === undefined) ctx.warnings.push(`unresolved path "${s}"`);
    return v ?? null;
  }

  // $param.<name>
  const paramMatch = s.match(/^\$param\.(.+)$/);
  if (paramMatch) {
    const name = paramMatch[1]!;
    if (!(name in ctx.params)) {
      ctx.warnings.push(`unknown param "${s}"`);
      return null;
    }
    return ctx.params[name];
  }

  // Reserved-prefix string we couldn't classify — be conservative and pass through.
  return s;
}

function getPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

interface Duration {
  years: number;
  months: number;
  weeks: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

const DURATION_RE =
  /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

export function parseIsoDuration(s: string): Duration | null {
  if (s === "P" || s === "PT" || !s.startsWith("P")) return null;
  const m = s.match(DURATION_RE);
  if (!m) return null;
  const [, y, mo, w, d, h, mi, se] = m;
  // Reject empty matches like "P" (no components at all).
  if (![y, mo, w, d, h, mi, se].some((v) => v !== undefined)) return null;
  return {
    years: y ? parseInt(y, 10) : 0,
    months: mo ? parseInt(mo, 10) : 0,
    weeks: w ? parseInt(w, 10) : 0,
    days: d ? parseInt(d, 10) : 0,
    hours: h ? parseInt(h, 10) : 0,
    minutes: mi ? parseInt(mi, 10) : 0,
    seconds: se ? parseInt(se, 10) : 0,
  };
}

function parseDurationToken(token: string, ctx: ResolverContext): Duration | null {
  // Token can be `$param.<name>` whose value is itself an ISO duration string.
  const paramMatch = token.match(/^\$param\.(.+)$/);
  if (paramMatch) {
    const v = ctx.params[paramMatch[1]!];
    if (typeof v !== "string") return null;
    return parseIsoDuration(v);
  }
  return parseIsoDuration(token);
}

export function applyDuration(date: Date, sign: 1 | -1, d: Duration): Date {
  const out = new Date(date.getTime());
  if (d.years) out.setUTCFullYear(out.getUTCFullYear() + sign * d.years);
  if (d.months) out.setUTCMonth(out.getUTCMonth() + sign * d.months);
  const ms =
    d.weeks * 7 * 86400_000 +
    d.days * 86400_000 +
    d.hours * 3_600_000 +
    d.minutes * 60_000 +
    d.seconds * 1000;
  if (ms) out.setTime(out.getTime() + sign * ms);
  return out;
}
