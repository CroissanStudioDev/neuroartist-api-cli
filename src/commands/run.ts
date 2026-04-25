import type { Command } from "commander";
import kleur from "kleur";
import { ApiClient } from "../client.ts";
import { resolveAuth } from "../config.ts";
import { collectUrls, downloadUrls } from "../download.ts";
import type { GlobalOpts } from "../output.ts";
import { printInfo, printResult, printSuccess, printWarning } from "../output.ts";
import { parseSse } from "../sse.ts";
import { buildBody } from "./queue.ts";

interface RunAsyncResponse {
  message?: string;
  requestId: string;
  status: string;
}

export function registerRunCommand(root: Command): void {
  root
    .command("run <modelId>")
    .description("Run a model and wait for the result (alias for sync /run + asset download)")
    .option("-i, --input <kv...>", "Input: key=value or key:value (repeatable). @path reads files.")
    .option("--input-file <path>", "Read the request body from a JSON file")
    .option("-o, --output <dir>", "Download outputs (URLs in the response) to this directory")
    .option(
      "--no-wait",
      "If gateway returns 202 + requestId, exit immediately instead of streaming progress"
    )
    .option("--timeout <s>", "Total wait timeout in seconds", "300")
    .addHelpText(
      "after",
      `
Examples:
  $ na run nano-banana-pro -i prompt="кот в очках" -o ./out
  $ na run fooz -i prompt="..." -i num_steps=20 --json | jq '.data.result'
  $ na run slow-video -i prompt="..." --no-wait --json
  $ na run img2img -i prompt="..." -i image=@./photo.png -o ./out
`
    )
    .action(async (modelId: string, opts, command) => {
      const g = command.optsWithGlobals() as GlobalOpts;
      const client = new ApiClient({ ...resolveAuth(g), debug: g.debug });
      const body = buildBody(opts);
      const startedAt = Date.now();

      const payload = await client.request<unknown>("POST", `/run/${modelId}`, { body });

      if (isAsyncResponse(payload)) {
        const async = payload as RunAsyncResponse;
        if (opts.wait === false) {
          printResult(
            "run",
            { mode: "async", ...async },
            {
              globalOpts: g,
              pretty: () => {
                printInfo(
                  `Submitted: ${async.requestId} (${async.status}) — exiting (--no-wait).`,
                  g
                );
              },
              next_actions: [
                {
                  command: `na queue stream ${modelId} ${async.requestId}`,
                  description: "Stream live progress",
                },
                {
                  command: `na queue result ${modelId} ${async.requestId} -o ./out`,
                  description: "Fetch result later",
                },
              ],
            }
          );
          return;
        }
        printInfo(
          `Async dispatch: ${kleur.bold(async.requestId)} (${async.status}). Streaming progress…`,
          g
        );
        const final = await waitForCompletion({
          client,
          modelId,
          requestId: async.requestId,
          timeoutMs: Number(opts.timeout) * 1000,
          startedAt,
          globalOpts: g,
        });
        await emitFinal(final, opts.output, g);
        return;
      }

      await emitFinal(payload, opts.output, g);
    });
}

function isAsyncResponse(value: unknown): value is RunAsyncResponse {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    value !== null &&
    "requestId" in value &&
    "status" in value &&
    typeof (value as Record<string, unknown>).requestId === "string"
  );
}

type FrameOutcome = "continue" | "completed" | "shutdown";

function frameStage(parsed: Record<string, unknown>): string | null {
  if (typeof parsed.stage === "string") {
    return parsed.stage;
  }
  if (typeof parsed.status === "string") {
    return parsed.status;
  }
  return null;
}

function classifyFrame(stage: string | null, status: unknown): FrameOutcome {
  if (
    stage === "completed" ||
    stage === "succeeded" ||
    stage === "COMPLETED" ||
    status === "COMPLETED"
  ) {
    return "completed";
  }
  if (stage === "server_closing") {
    return "shutdown";
  }
  return "continue";
}

async function waitForCompletion(args: {
  client: ApiClient;
  modelId: string;
  requestId: string;
  timeoutMs: number;
  startedAt: number;
  globalOpts: GlobalOpts;
}): Promise<unknown> {
  const { client, modelId, requestId, timeoutMs, startedAt, globalOpts } = args;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const stream = await client.stream(`/queue/${modelId}/requests/${requestId}/progress/stream`, {
      signal: ac.signal,
    });

    let lastStage: string | null = null;
    for await (const frame of parseSse(stream)) {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(frame.data) as Record<string, unknown>;
      } catch {
        continue;
      }

      const stage = frameStage(parsed);
      if (stage && stage !== lastStage) {
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
        printInfo(`[${elapsed}s] ${stage}`, globalOpts);
        lastStage = stage;
      }

      if (stage === "failed" || stage === "error" || stage === "FAILED") {
        throw new Error(`Generation failed: ${frame.data}`);
      }
      const outcome = classifyFrame(stage, parsed.status);
      if (outcome === "completed") {
        break;
      }
      if (outcome === "shutdown") {
        printWarning("Gateway is shutting down — falling back to polling.", globalOpts);
        break;
      }
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error(`Timeout waiting for ${requestId} after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  return client.request<unknown>("GET", `/queue/${modelId}/requests/${requestId}`);
}

async function emitFinal(
  payload: unknown,
  outDir: string | undefined,
  g: GlobalOpts
): Promise<void> {
  let downloads: { url: string; path: string; bytes: number }[] = [];
  if (outDir) {
    const urls = collectUrls(payload);
    if (urls.length > 0) {
      downloads = await downloadUrls(urls, outDir);
    }
  }

  printResult(
    "run",
    { mode: "sync", result: payload, downloads },
    {
      globalOpts: g,
      pretty: (d) => {
        printSuccess("Generation complete.", g);
        process.stdout.write(`${JSON.stringify(d.result, null, 2)}\n`);
        for (const r of d.downloads) {
          printSuccess(`Saved ${kleur.bold(r.path)} (${formatBytes(r.bytes)})`, g);
        }
        if (outDir && d.downloads.length === 0) {
          printInfo("No URL outputs found in payload — nothing to download.", g);
        }
      },
    }
  );
}

function formatBytes(n: number): string {
  if (n < 1024) {
    return `${n}B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)}KB`;
  }
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}
