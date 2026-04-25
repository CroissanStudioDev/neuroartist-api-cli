import { mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { URL } from "node:url";

const URL_RE = /^https?:\/\//i;

/**
 * Walk an arbitrary JSON payload and collect every string that looks like
 * an HTTP(S) URL — these are model outputs (images, video, audio).
 */
export function collectUrls(value: unknown): string[] {
  const out: string[] = [];
  walk(value, out);
  return Array.from(new Set(out));
}

function walk(value: unknown, sink: string[]): void {
  if (typeof value === "string") {
    if (URL_RE.test(value)) {
      sink.push(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      walk(item, sink);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) {
      walk(v, sink);
    }
  }
}

export interface DownloadResult {
  bytes: number;
  path: string;
  url: string;
}

export async function downloadUrls(urls: string[], outDir: string): Promise<DownloadResult[]> {
  mkdirSync(outDir, { recursive: true });
  const results: DownloadResult[] = [];
  let i = 0;
  for (const url of urls) {
    i += 1;
    const name = filenameFor(url, i);
    const dest = join(outDir, name);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Download failed (${res.status}) for ${url}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, buf);
    results.push({ url, path: dest, bytes: buf.byteLength });
  }
  return results;
}

function filenameFor(rawUrl: string, idx: number): string {
  try {
    const url = new URL(rawUrl);
    const last = basename(url.pathname);
    if (last && extname(last)) {
      return `${String(idx).padStart(2, "0")}-${last}`;
    }
  } catch {
    // fall through
  }
  return `${String(idx).padStart(2, "0")}-output.bin`;
}
