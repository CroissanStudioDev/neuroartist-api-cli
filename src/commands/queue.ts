import { readFileSync } from "node:fs";
import type { Command } from "commander";
import kleur from "kleur";
import { ApiClient } from "../client.ts";
import { resolveAuth } from "../config.ts";
import { collectUrls, downloadUrls } from "../download.ts";
import { parseInputs } from "../inputs.ts";
import type { GlobalOpts } from "../output.ts";
import { detectFormat, printInfo, printResult, printSuccess } from "../output.ts";
import { parseSse } from "../sse.ts";

interface SubmitResponse {
  request_id?: string;
  requestId?: string;
  status?: string;
}

interface StatusResponse {
  request_id?: string;
  state?: string;
  status?: string;
}

export function registerQueueCommands(root: Command): void {
  const queue = root
    .command("queue")
    .description("Async generation queue (submit / status / stream / result / cancel)");

  queue
    .command("submit <modelId>")
    .description("Submit a generation request to the queue (returns requestId)")
    .option("-i, --input <kv...>", "Input: key=value or key:value (repeatable). @path reads files.")
    .option("--input-file <path>", "Read the request body from a JSON file")
    .addHelpText(
      "after",
      `
Examples:
  $ na queue submit nano-banana-pro -i prompt="кот" --json
  $ na queue submit fooz --input-file ./body.json
`
    )
    .action(async (modelId: string, opts, command) => {
      const g = command.optsWithGlobals() as GlobalOpts;
      const client = new ApiClient({ ...resolveAuth(g), debug: g.debug });
      const body = buildBody(opts);
      const data = await client.request<SubmitResponse>("POST", `/queue/${modelId}`, { body });
      const reqId = data.request_id ?? data.requestId ?? "";

      printResult("queue submit", data, {
        globalOpts: g,
        pretty: () => {
          printSuccess(
            `Submitted: ${kleur.bold(reqId)}  ${kleur.dim(`(${data.status ?? "IN_QUEUE"})`)}`,
            g
          );
        },
        next_actions: reqId
          ? [
              {
                command: `na queue stream ${modelId} ${reqId}`,
                description: "Stream live progress (SSE)",
              },
              {
                command: `na queue status ${modelId} ${reqId}`,
                description: "One-shot status check",
              },
              {
                command: `na queue result ${modelId} ${reqId} -o ./out`,
                description: "Fetch result and download outputs",
              },
            ]
          : undefined,
      });
    });

  queue
    .command("status <modelId> <requestId>")
    .description("Get the current status for a queued request")
    .action(async (modelId: string, requestId: string, _opts, command) => {
      const g = command.optsWithGlobals() as GlobalOpts;
      const client = new ApiClient({ ...resolveAuth(g), debug: g.debug });
      const data = await client.request<StatusResponse>(
        "GET",
        `/queue/${modelId}/requests/${requestId}/status`
      );
      printResult("queue status", data, { globalOpts: g });
    });

  queue
    .command("result <modelId> <requestId>")
    .description("Fetch the result for a completed request")
    .option("-o, --output <dir>", "Download asset URLs from the payload to this directory")
    .action(async (modelId: string, requestId: string, opts, command) => {
      const g = command.optsWithGlobals() as GlobalOpts;
      const client = new ApiClient({ ...resolveAuth(g), debug: g.debug });
      const data = await client.request<unknown>("GET", `/queue/${modelId}/requests/${requestId}`);

      let downloads: { url: string; path: string; bytes: number }[] = [];
      if (opts.output) {
        const urls = collectUrls(data);
        if (urls.length > 0) {
          downloads = await downloadUrls(urls, opts.output);
        }
      }

      printResult(
        "queue result",
        { result: data, downloads },
        {
          globalOpts: g,
          pretty: (d) => {
            process.stdout.write(`${JSON.stringify(d.result, null, 2)}\n`);
            for (const r of d.downloads) {
              printSuccess(`Saved ${kleur.bold(r.path)} (${formatBytes(r.bytes)})`, g);
            }
            if (opts.output && d.downloads.length === 0) {
              printInfo("No URL outputs found in payload — nothing to download.", g);
            }
          },
        }
      );
    });

  queue
    .command("stream <modelId> <requestId>")
    .description("Subscribe to the SSE progress channel (NDJSON in --json mode)")
    .action(async (modelId: string, requestId: string, _opts, command) => {
      const g = command.optsWithGlobals() as GlobalOpts;
      const client = new ApiClient({ ...resolveAuth(g), debug: g.debug });
      const res = await client.stream(`/queue/${modelId}/requests/${requestId}/progress/stream`);
      const json = detectFormat(g) === "json";
      for await (const frame of parseSse(res)) {
        if (json) {
          // NDJSON: one frame per line, raw payload (already JSON from gateway).
          process.stdout.write(`${frame.data}\n`);
        } else {
          renderProgressFrame(frame.data);
        }
      }
    });

  queue
    .command("cancel <modelId> <requestId>")
    .description("Cancel an in-flight request")
    .action(async (modelId: string, requestId: string, _opts, command) => {
      const g = command.optsWithGlobals() as GlobalOpts;
      const client = new ApiClient({ ...resolveAuth(g), debug: g.debug });
      const data = await client.request<unknown>(
        "PUT",
        `/queue/${modelId}/requests/${requestId}/cancel`
      );
      printResult("queue cancel", data ?? { requestId, cancelled: true }, {
        globalOpts: g,
        pretty: () => {
          printSuccess(`Cancelled: ${requestId}`, g);
        },
      });
    });
}

export function buildBody(opts: { input?: string[]; inputFile?: string }): unknown {
  if (opts.inputFile) {
    return JSON.parse(readFileSync(opts.inputFile, "utf-8"));
  }
  if (opts.input && opts.input.length > 0) {
    return parseInputs(opts.input);
  }
  return {};
}

function renderProgressFrame(raw: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    process.stdout.write(`${raw}\n`);
    return;
  }
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const stage = obj.stage ?? obj.status;
    const time = new Date().toISOString().slice(11, 19);
    if (stage) {
      process.stdout.write(
        `${kleur.dim(time)} ${kleur.cyan(String(stage))} ${kleur.dim(JSON.stringify(stripStage(obj)))}\n`
      );
      return;
    }
  }
  process.stdout.write(`${raw}\n`);
}

function stripStage(obj: Record<string, unknown>): Record<string, unknown> {
  const { stage: _stage, status: _status, ...rest } = obj;
  return rest;
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
