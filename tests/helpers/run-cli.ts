import { resolve } from "node:path";

const CLI_ENTRY = resolve(import.meta.dir, "..", "..", "src", "index.ts");

export interface RunResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

/**
 * Invoke the CLI as a subprocess. Returns combined stdout, stderr, exit code.
 *
 * Always:
 *   - NO_COLOR=1            stable text assertions
 *   - NEUROARTIST_JSON=1    forces JSON envelope output (we test contract, not pretty)
 */
export async function runCli(args: string[], env: Record<string, string> = {}): Promise<RunResult> {
  const proc = Bun.spawn({
    cmd: ["bun", "run", CLI_ENTRY, ...args],
    env: {
      ...process.env,
      NO_COLOR: "1",
      NEUROARTIST_JSON: "1",
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
    new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
  ]);
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}

/** Convenience: run, expect ok=true envelope, return parsed `data`. */
export async function runCliJson<T = unknown>(
  args: string[],
  env: Record<string, string> = {}
): Promise<T> {
  const { stdout, stderr, exitCode } = await runCli(args, env);
  if (exitCode !== 0) {
    throw new Error(`CLI exited ${exitCode}.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  const parsed = JSON.parse(stdout) as { ok: boolean; data: T; error?: unknown };
  if (!parsed.ok) {
    throw new Error(`Expected ok=true, got ${JSON.stringify(parsed)}`);
  }
  return parsed.data;
}
