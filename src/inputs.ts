import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const NUMERIC_RE = /^-?\d+(?:\.\d+)?$/;

/**
 * Parse `key=value` (or `key:value`) input arguments into a JSON-shaped object.
 *
 * Conventions inspired by the Replicate CLI:
 *   --input prompt="cat"            string
 *   --input num_steps=20            number (auto-detected)
 *   --input enabled=true            boolean (auto-detected)
 *   --input image=@./photo.png      file → data: URL (read locally)
 *   --input prompt:cat              colon also works (single token)
 *   --input config=@./body.json     JSON file → embedded as object
 *   --input arr='["a","b"]'         JSON literal — decoded if it parses
 *   --input nested.field=42         dotted path → nested object
 */
export function parseInputs(items: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const raw of items) {
    const eqIdx = raw.indexOf("=");
    const colonIdx = raw.indexOf(":");
    let splitIdx = -1;
    if (eqIdx >= 0 && (colonIdx < 0 || eqIdx < colonIdx)) {
      splitIdx = eqIdx;
    } else if (colonIdx >= 0) {
      splitIdx = colonIdx;
    }
    if (splitIdx <= 0) {
      throw new Error(`Invalid input arg: '${raw}'. Expected key=value or key:value.`);
    }
    const key = raw.slice(0, splitIdx).trim();
    const value = raw.slice(splitIdx + 1);
    setNested(out, key, coerceValue(value));
  }
  return out;
}

function coerceValue(raw: string): unknown {
  if (raw.startsWith("@")) {
    return readFileAsValue(raw.slice(1));
  }
  // JSON literal (object/array/quoted string/number/bool)
  if (
    raw.startsWith("{") ||
    raw.startsWith("[") ||
    raw === "true" ||
    raw === "false" ||
    raw === "null"
  ) {
    try {
      return JSON.parse(raw);
    } catch {
      // fall through to string
    }
  }
  // Plain numeric
  if (NUMERIC_RE.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return raw;
}

function readFileAsValue(path: string): unknown {
  const abs = isAbsolute(path) ? path : resolve(process.cwd(), path);
  const buf = readFileSync(abs);
  if (path.endsWith(".json")) {
    try {
      return JSON.parse(buf.toString("utf-8"));
    } catch (err) {
      throw new Error(`Failed to parse JSON file ${path}: ${(err as Error).message}`);
    }
  }
  // Binary → base64 data URL. mime guessed from extension; fallback octet-stream.
  const mime = guessMime(path);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function guessMime(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  if (lower.endsWith(".gif")) {
    return "image/gif";
  }
  if (lower.endsWith(".mp4")) {
    return "video/mp4";
  }
  if (lower.endsWith(".webm")) {
    return "video/webm";
  }
  if (lower.endsWith(".mp3")) {
    return "audio/mpeg";
  }
  if (lower.endsWith(".wav")) {
    return "audio/wav";
  }
  if (lower.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (lower.endsWith(".txt") || lower.endsWith(".md")) {
    return "text/plain";
  }
  return "application/octet-stream";
}

function setNested(root: Record<string, unknown>, dotted: string, value: unknown): void {
  const parts = dotted.split(".").filter(Boolean);
  if (parts.length === 0) {
    return;
  }
  let cursor: Record<string, unknown> = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!key) {
      continue;
    }
    const existing = cursor[key];
    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
      cursor = existing as Record<string, unknown>;
    } else {
      const next: Record<string, unknown> = {};
      cursor[key] = next;
      cursor = next;
    }
  }
  const leaf = parts.at(-1);
  if (leaf) {
    cursor[leaf] = value;
  }
}
