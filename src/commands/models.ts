import type { Command } from "commander";
import kleur from "kleur";
import { ApiClient } from "../client.ts";
import { resolveAuth } from "../config.ts";
import type { GlobalOpts } from "../output.ts";
import { printResult, table } from "../output.ts";

interface ModelSummary {
  category?: string | null;
  creditCost?: number | null;
  displayName?: string | null;
  modelId: string;
  modelLab?: string | null;
  priceRub?: number | null;
  priceUnit?: string | null;
}

interface ModelListResponse {
  items: ModelSummary[];
  limit: number;
  offset: number;
  total: number;
}

type ModelDetail = ModelSummary & {
  description?: string | null;
  schema?: unknown;
  schemaRu?: unknown;
  tags?: string[] | null;
  publishedAt?: string | null;
};

export function registerModelsCommands(root: Command): void {
  const models = root.command("models").description("Browse the public model catalog");

  models
    .command("list")
    .description("List public models")
    .option("-c, --category <csv>", "Filter by category (CSV)")
    .option("-l, --lab <csv>", "Filter by lab/vendor (CSV)")
    .option("-t, --tag <csv>", "Filter by tag (CSV — AND semantics)")
    .option("-s, --search <q>", "Substring search across alias / displayName / description")
    .option("--sort <s>", "Sort: popular | newest | price_asc | by_category", "popular")
    .option("--limit <n>", "Max items", "50")
    .option("--offset <n>", "Items to skip", "0")
    .addHelpText(
      "after",
      `
Examples:
  $ na models list
  $ na models list --search banana --json | jq '.data.items[].modelId'
  $ na models list --category text-to-image --sort price_asc --limit 5
`
    )
    .action(async (opts, command) => {
      const g = command.optsWithGlobals() as GlobalOpts;
      const client = new ApiClient({ ...resolveAuth(g), debug: g.debug });
      const data = await client.request<ModelListResponse>("GET", "/models", {
        auth: false,
        query: {
          category: opts.category,
          lab: opts.lab,
          tag: opts.tag,
          search: opts.search,
          sort: opts.sort,
          limit: opts.limit,
          offset: opts.offset,
        },
      });

      printResult("models list", data, {
        globalOpts: g,
        pretty: (d) => {
          table(
            d.items.map((m) => ({
              modelId: m.modelId,
              name: m.displayName ?? "",
              lab: m.modelLab ?? "",
              category: m.category ?? "",
              price: priceLabel(m),
            })),
            ["modelId", "name", "lab", "category", "price"]
          );
          process.stdout.write(
            `\n${kleur.dim(`Showing ${d.items.length} of ${d.total} (offset ${d.offset})`)}\n`
          );
        },
        next_actions: [
          { command: "na models get <modelId>", description: "Show full metadata" },
          { command: "na models schema <modelId>", description: "Inspect input/output schema" },
          { command: "na run <modelId> -i prompt=…", description: "Run a generation" },
        ],
      });
    });

  models
    .command("get <modelId>")
    .description("Show model metadata (without schema)")
    .addHelpText(
      "after",
      `
Examples:
  $ na models get nano-banana-pro
  $ na models get nano-banana-pro --json | jq '.data.priceRub'
`
    )
    .action(async (modelId: string, _opts, command) => {
      const g = command.optsWithGlobals() as GlobalOpts;
      const client = new ApiClient({ ...resolveAuth(g), debug: g.debug });
      const detail = await client.request<ModelDetail>("GET", `/models/${modelId}`, {
        auth: false,
      });
      const { schema: _s, schemaRu: _sr, ...rest } = detail;
      printResult("models get", rest, {
        globalOpts: g,
        pretty: (d) => {
          const lines = [
            `${kleur.bold(d.displayName ?? d.modelId)}`,
            `${kleur.dim("modelId:")}  ${d.modelId}`,
            `${kleur.dim("lab:")}      ${d.modelLab ?? "—"}`,
            `${kleur.dim("category:")} ${d.category ?? "—"}`,
            `${kleur.dim("price:")}    ${priceLabel(d)}`,
          ];
          if (d.tags && d.tags.length > 0) {
            lines.push(`${kleur.dim("tags:")}     ${d.tags.join(", ")}`);
          }
          if (d.description) {
            lines.push("");
            lines.push(d.description);
          }
          process.stdout.write(`${lines.join("\n")}\n`);
        },
      });
    });

  models
    .command("schema <modelId>")
    .description("Show the model's input/output schema (JSON)")
    .action(async (modelId: string, _opts, command) => {
      const g = command.optsWithGlobals() as GlobalOpts;
      const client = new ApiClient({ ...resolveAuth(g), debug: g.debug });
      const detail = await client.request<ModelDetail>("GET", `/models/${modelId}`, {
        auth: false,
      });
      printResult("models schema", detail.schema ?? null, { globalOpts: g });
    });

  models
    .command("estimate <modelId>")
    .description("Estimate cost for a given input set (auth required)")
    .option("-i, --input <kv...>", "Input args: key=value (repeatable)")
    .option("--input-file <path>", "Read input body from a JSON file")
    .addHelpText(
      "after",
      `
Examples:
  $ na models estimate nano-banana-pro -i prompt="кот"
  $ na models estimate fooz --input-file ./body.json
`
    )
    .action(async (modelId: string, opts, command) => {
      const g = command.optsWithGlobals() as GlobalOpts;
      const client = new ApiClient({ ...resolveAuth(g), debug: g.debug });

      const { parseInputs } = await import("../inputs.ts");
      const { readFileSync } = await import("node:fs");

      let body: unknown = {};
      if (opts.inputFile) {
        body = JSON.parse(readFileSync(opts.inputFile, "utf-8"));
      } else if (opts.input && opts.input.length > 0) {
        body = parseInputs(opts.input as string[]);
      }

      const data = await client.request<unknown>("POST", `/models/${modelId}/estimate`, {
        body,
      });
      printResult("models estimate", data, { globalOpts: g });
    });
}

function priceLabel(m: { priceRub?: number | null; priceUnit?: string | null }): string {
  if (m.priceRub === null || m.priceRub === undefined) {
    return "—";
  }
  const unit = m.priceUnit ? ` / ${m.priceUnit}` : "";
  return `${m.priceRub}₽${unit}`;
}
