"use client";

import { useEffect, useState } from "react";

import { parseBuildInfo, PRIMARY, type BuildInfo } from "../lib/build-info.js";

type ImageInfo = BuildInfo & { source: string };

/** Each endpoint describes one image, including independently released sibling engines. */
export function VersionFooter({ endpoints, initialImages = [], engineSource = endpoints[0] }: { endpoints: readonly string[]; initialImages?: readonly unknown[]; engineSource?: string }) {
  const [images, setImages] = useState<ImageInfo[]>([]);
  const urls = endpoints.join("\n");
  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    setImages([]);
    const refresh = async () => {
      controller?.abort();
      clearTimeout(timeout);
      const current = new AbortController();
      controller = current;
      const currentTimeout = setTimeout(() => current.abort(), 4000);
      timeout = currentTimeout;
      const replies = await Promise.all(urls.split("\n").filter(Boolean).map(async (url) => {
        try {
          const response = await fetch(url, { cache: "no-store", credentials: "omit", signal: current.signal });
          if (!response.ok) return null;
          const value: unknown = await response.json();
          const info = parseBuildInfo(value);
          return info ? { ...info, source: url } : null;
        } catch {
          // Unreadable versions are omitted, as the footer's contract requires.
          return null;
        }
      }));
      clearTimeout(currentTimeout);
      if (!cancelled && controller === current) setImages(replies.filter((reply) => reply !== null));
    };
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 60_000);
    return () => {
      cancelled = true;
      controller?.abort();
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [urls]);

  // A server-only website engine remains distinct from every public app engine.
  const snapshots = initialImages.flatMap((value, index) => {
    const info = parseBuildInfo(value);
    return info ? [{ ...info, source: `server:${index}` }] : [];
  });
  const bySource = new Map<string, ImageInfo>();
  for (const image of [...snapshots, ...images]) bySource.set(image.source, image);
  const known = [...bySource.values()];
  const groups = Object.entries(PRIMARY).flatMap(([name, primary]) => {
    const members = known.filter((image) => image.name === name);
    const main = members.find((image) => image.subpackages[0]?.name === primary &&
      (name !== "digita-platform" || image.source === engineSource));
    return main ? [{ name, main, members }] : [];
  });
  if (groups.length === 0) return null;
  return (
    <details className="relative mx-auto w-full text-xs text-textMuted" data-testid="version-footer">
      <summary className="cursor-pointer list-none px-4 py-2 text-center leading-relaxed focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primaryText [&::-webkit-details-marker]:hidden">
        {groups.map(({ name, main }) => `${name} ${main.version.split("-")[0]}`).join(" – ")}
      </summary>
      <div className="absolute bottom-full left-2 right-2 z-50 mx-auto max-h-[40vh] max-w-3xl overflow-y-auto rounded border border-border bg-surface p-4 text-textMain shadow-lg" data-testid="version-panel">
        <ul className="grid gap-4 sm:grid-cols-2">
          {groups.map(({ name, members }) => (
            <li key={name}>
              <p className="mb-2 font-medium">{name}</p>
              <ul className="space-y-3">
                {members.map((image) => (
                  <li key={image.source}>
                    <p className="break-words text-textMuted">{image.subpackages[0]!.name.replace("@digitaplatform/", "")} {image.version}</p>
                    <ul className="mt-1 space-y-1 pl-3">
                      {image.subpackages.map((pkg) => <li className="break-words" key={`${pkg.name}:${pkg.version}`}>{pkg.name.replace("@digitaplatform/", "")} {pkg.version}</li>)}
                    </ul>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
