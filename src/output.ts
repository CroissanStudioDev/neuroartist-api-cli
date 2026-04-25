import kleur from "kleur";
import type { NextAction } from "./envelope.ts";
import { success } from "./envelope.ts";

export type OutputFormat = "json" | "pretty";

export interface GlobalOpts {
  baseUrl?: string;
  debug?: boolean;
  json?: boolean;
  profile?: string;
  quiet?: boolean;
  yes?: boolean;
}

export function detectFormat(opts: GlobalOpts): OutputFormat {
  if (opts.json) {
    return "json";
  }
  if (process.env.NEUROARTIST_JSON === "1") {
    return "json";
  }
  if (!process.stdout.isTTY) {
    return "json";
  }
  return "pretty";
}

export function isInteractive(opts: GlobalOpts): boolean {
  if (opts.yes) {
    return false;
  }
  if (process.env.CI === "true" || process.env.CI === "1") {
    return false;
  }
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

export function isQuiet(opts: GlobalOpts): boolean {
  return Boolean(opts.quiet);
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Emit a command result. Routes to JSON envelope (machine path) or to a
 * caller-supplied pretty renderer (human path). When pretty is omitted, falls
 * back to JSON for both.
 *
 * Convention: data goes to stdout (both modes), informational lines (success
 * markers, hints) go to stderr — keeps stdout parseable in pipes.
 */
export function printResult<T>(
  command: string,
  data: T,
  opts: {
    globalOpts: GlobalOpts;
    pretty?: (data: T) => void;
    next_actions?: NextAction[];
    warnings?: string[];
  }
): void {
  const format = detectFormat(opts.globalOpts);
  if (format === "json") {
    printJson(
      success(command, data, {
        next_actions: opts.next_actions,
        warnings: opts.warnings,
      })
    );
    return;
  }
  if (opts.pretty) {
    opts.pretty(data);
    return;
  }
  printJson(data);
}

export function printSuccess(text: string, opts?: GlobalOpts): void {
  if (opts && isQuiet(opts)) {
    return;
  }
  process.stderr.write(`${kleur.green("✔")} ${text}\n`);
}

export function printError(text: string): void {
  process.stderr.write(`${kleur.red("✗")} ${text}\n`);
}

export function printInfo(text: string, opts?: GlobalOpts): void {
  if (opts && isQuiet(opts)) {
    return;
  }
  process.stderr.write(`${kleur.dim(text)}\n`);
}

export function printWarning(text: string, opts?: GlobalOpts): void {
  if (opts && isQuiet(opts)) {
    return;
  }
  process.stderr.write(`${kleur.yellow("!")} ${text}\n`);
}

export function table(
  rows: readonly Record<string, string | number | null | undefined>[],
  cols?: string[]
): void {
  if (rows.length === 0) {
    process.stdout.write(`${kleur.dim("(empty)")}\n`);
    return;
  }
  const columns = cols ?? Object.keys(rows[0] ?? {});
  const widths = columns.map((c) =>
    Math.max(c.length, ...rows.map((r) => formatCell(r[c]).length))
  );
  const renderRow = (vals: string[]) =>
    vals.map((v, i) => v.padEnd(widths[i] ?? v.length)).join("  ");
  process.stdout.write(`${kleur.bold(renderRow(columns))}\n`);
  process.stdout.write(`${columns.map((_, i) => "-".repeat(widths[i] ?? 0)).join("  ")}\n`);
  for (const r of rows) {
    process.stdout.write(`${renderRow(columns.map((c) => formatCell(r[c])))}\n`);
  }
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) {
    return "";
  }
  return String(v);
}
