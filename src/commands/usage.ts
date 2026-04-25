import type { Command } from "commander";
import kleur from "kleur";
import { ApiClient } from "../client.ts";
import { resolveAuth } from "../config.ts";
import type { GlobalOpts } from "../output.ts";
import { printResult, table } from "../output.ts";

interface UsageResponse {
  balance: number;
  windows: Record<string, { credits: number; submitsOk: number; submitsError: number } | unknown>;
}

interface ActivityItem {
  createdAt?: string;
  credits?: number;
  falRequestId?: string;
  modelId?: string;
  status?: string;
}

interface ActivityResponse {
  items: ActivityItem[];
  total?: number;
}

interface ByModelResponse {
  items: Array<{ modelId: string; credits: number; submits?: number }>;
}

export function registerUsageCommands(root: Command): void {
  const usage = root.command("usage").description("Inspect credit usage");

  usage
    .command("summary")
    .description("Aggregated usage across rolling windows (5h, 24h, 7d, 30d)")
    .option("-w, --windows <csv>", "Windows to query (CSV)", "5h,24h,7d,30d")
    .addHelpText(
      "after",
      `
Examples:
  $ na usage summary
  $ na usage summary -w 24h,7d
  $ na usage summary --json | jq '.data.windows."24h"'
`
    )
    .action(async (opts: { windows: string }, command) => {
      const g = command.optsWithGlobals() as GlobalOpts;
      const client = new ApiClient({ ...resolveAuth(g), debug: g.debug });
      const data = await client.request<UsageResponse>("GET", "/me/usage", {
        query: { windows: opts.windows },
      });

      printResult("usage summary", data, {
        globalOpts: g,
        pretty: (d) => {
          process.stdout.write(`${kleur.dim("Balance:")} ${kleur.bold(String(d.balance))} ₽\n\n`);
          const rows = Object.entries(d.windows).map(([window, raw]) => {
            const v = raw as { credits?: number; submitsOk?: number; submitsError?: number };
            return {
              window,
              credits: v.credits ?? 0,
              ok: v.submitsOk ?? 0,
              err: v.submitsError ?? 0,
            };
          });
          table(rows, ["window", "credits", "ok", "err"]);
        },
      });
    });

  usage
    .command("by-model")
    .description("Spend grouped by model over a rolling window")
    .option("-w, --window <w>", "Window: 5h | 24h | 7d | 30d", "24h")
    .action(async (opts, command) => {
      const g = command.optsWithGlobals() as GlobalOpts;
      const client = new ApiClient({ ...resolveAuth(g), debug: g.debug });
      const data = await client.request<ByModelResponse>("GET", "/me/usage/by-model", {
        query: { window: opts.window },
      });
      printResult("usage by-model", data, {
        globalOpts: g,
        pretty: (d) => {
          table(d.items, ["modelId", "credits", "submits"]);
        },
      });
    });

  usage
    .command("by-key")
    .description("Spend grouped by API key over a rolling window")
    .option("-w, --window <w>", "Window: 5h | 24h | 7d | 30d", "24h")
    .action(async (opts, command) => {
      const g = command.optsWithGlobals() as GlobalOpts;
      const client = new ApiClient({ ...resolveAuth(g), debug: g.debug });
      const data = await client.request<{ items: unknown[] }>("GET", "/me/usage/by-key", {
        query: { window: opts.window },
      });
      printResult("usage by-key", data, { globalOpts: g });
    });

  root
    .command("activity")
    .description("Recent generation activity")
    .option("--limit <n>", "Max items", "20")
    .option("--status <s>", "Filter: success | error")
    .addHelpText(
      "after",
      `
Examples:
  $ na activity --limit 10
  $ na activity --status error --json | jq '.data.items[].falRequestId'
`
    )
    .action(async (opts, command) => {
      const g = command.optsWithGlobals() as GlobalOpts;
      const client = new ApiClient({ ...resolveAuth(g), debug: g.debug });
      const data = await client.request<ActivityResponse>("GET", "/me/activity", {
        query: { limit: opts.limit, status: opts.status },
      });

      printResult("activity", data, {
        globalOpts: g,
        pretty: (d) => {
          table(
            d.items.map((it) => ({
              time: it.createdAt ?? "",
              model: it.modelId ?? "",
              status: it.status ?? "",
              credits: it.credits ?? 0,
              requestId: it.falRequestId ?? "",
            })),
            ["time", "model", "status", "credits", "requestId"]
          );
        },
      });
    });
}
