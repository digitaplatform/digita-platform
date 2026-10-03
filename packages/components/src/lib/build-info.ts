export interface PackageVersion { name: string; version: string }
export interface BuildInfo extends PackageVersion { subpackages: PackageVersion[] }
export const PRIMARY = {
  "digita-auth": "@digitaplatform/auth",
  "digita-jobs": "@digitaplatform/jobs",
  "digita-platform": "@digitaplatform/engine",
  "digita-report": "@digitaplatform/report",
};

function packageVersion(value: unknown): value is PackageVersion {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.name === "string" && v.name.length > 0 && v.name.length <= 128 &&
    typeof v.version === "string" && v.version.length > 0 && v.version.length <= 128;
}
export function parseBuildInfo(value: unknown): BuildInfo | null {
  if (!packageVersion(value)) return null;
  const v = value as unknown as Record<string, unknown>;
  const valid = value.version === value.version.trim() && /^\d+\.\d+\.\d+-(alpha|beta|stable)-\d{14}-[a-f0-9]{7}$/.test(value.version) &&
    Object.hasOwn(PRIMARY, v.name as string) &&
    Object.keys(v).every((key) => ["name", "version", "subpackages"].includes(key)) &&
    Array.isArray(v.subpackages) && v.subpackages.length > 0 && v.subpackages.length <= 100 &&
    v.subpackages.every((pkg) => packageVersion(pkg) && Object.keys(pkg).every((key) => ["name", "version"].includes(key)));
  return valid ? { name: value.name, version: value.version, subpackages: (v.subpackages as PackageVersion[]).map(({ name, version }) => ({ name, version })) } : null;
}

