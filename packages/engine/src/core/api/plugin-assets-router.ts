import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createLogger } from "../logging/logger.js";

const log = createLogger("plugin-assets-router");

/**
 * Engine-gated delivery of PREMIUM plugin artifacts. Free plugins are served
 * as plain nginx statics at /plugins/<id>/<version>/<entry>; premium artifacts
 * live outside the web root (PLUGINS_PREMIUM_DIR) and are streamed here ONLY
 * when the requested :id is in the tenant's verified license entitlements —
 * a non-entitled caller gets 403 and the bytes never leave the server.
 * Content is version-addressed (immutable cache) and path-traversal-safe.
 */

/**
 * One clean path segment: starts alphanumeric, then a conservative charset.
 * Rejects `.`/`..` (no leading dot), separators, backslashes, URL tricks —
 * traversal is impossible before the filesystem is ever touched.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Minimal extension→MIME map for plugin artifacts (design CSS, ESM bundles). */
const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function registerPluginAssetRoutes(
  app: FastifyInstance,
  prefix: string,
  opts: {
    /** Lazy: entitlements are loaded during startup(), AFTER routes register. */
    getEntitlements: () => string[];
    /**
     * Lazy + tolerant: root of the premium artifact store. May be undefined
     * (tests that mock the whole env object omit the key) ⇒ every asset 404s.
     */
    getPremiumDir: () => string | undefined;
  },
): void {
  app.get(
    `${prefix}/plugin-assets/:id/:version/*`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as { id?: string; version?: string; "*"?: string };
      const id = params.id ?? "";
      const version = params.version ?? "";
      const relParts = (params["*"] ?? "").split("/").filter((s) => s.length > 0);
      const segments = [id, version, ...relParts];
      if (
        relParts.length === 0 ||
        segments.some((s) => !SAFE_SEGMENT.test(s) || s.includes("\\"))
      ) {
        return reply.code(400).send({ success: false, error: { code: "BAD_REQUEST" } });
      }

      // Entitlement gate FIRST — before any filesystem probe, so a non-entitled
      // caller can neither read premium bytes nor learn which assets exist.
      if (!opts.getEntitlements().includes(id)) {
        return reply.code(403).send({ success: false, error: { code: "FORBIDDEN" } });
      }

      const dir = opts.getPremiumDir();
      if (!dir) {
        return reply.code(404).send({ success: false, error: { code: "NOT_FOUND" } });
      }

      // Defense in depth: segments are already charset-safe, but the resolved
      // path must still sit inside the premium root.
      const base = resolve(dir);
      const filePath = resolve(base, ...segments);
      if (!filePath.startsWith(base + sep)) {
        log.warn({ id, version, path: params["*"] }, "plugin-asset path escaped premium root");
        return reply.code(400).send({ success: false, error: { code: "BAD_REQUEST" } });
      }

      let fileStat;
      try {
        fileStat = await stat(filePath);
      } catch {
        return reply.code(404).send({ success: false, error: { code: "NOT_FOUND" } });
      }
      if (!fileStat.isFile()) {
        return reply.code(404).send({ success: false, error: { code: "NOT_FOUND" } });
      }

      reply.header(
        "content-type",
        MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream",
      );
      reply.header("content-length", fileStat.size);
      // Version-addressed artifacts never change in place → immutable.
      reply.header("cache-control", "public, max-age=31536000, immutable");
      return reply.send(createReadStream(filePath));
    },
  );
}
