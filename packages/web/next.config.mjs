import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Node-runtime container build (ISR / on-demand revalidation / draft mode need
  // a server — NOT a static export). See docker/web.Dockerfile.
  output: "standalone",
  // Trace from the monorepo root so the standalone bundle pulls in workspace deps
  // (@digitaplatform/theme) and the pnpm symlinked node_modules. Without this, the
  // standalone server is missing workspace packages.
  outputFileTracingRoot: repoRoot,
  reactStrictMode: true,
  poweredByHeader: false,
  // ESLint config is added in a later milestone; typecheck (tsc) + build are the
  // current gates. Do not let a missing eslint setup fail the build.
  eslint: { ignoreDuringBuilds: true },
  // No images.remotePatterns: media is rendered with a plain <img> (runtime
  // PUBLIC_ENGINE_URL), so there is no build-time, site-specific host to bake in.
};

export default nextConfig;
