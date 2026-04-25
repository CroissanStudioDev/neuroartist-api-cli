import type { Command } from "commander";
import kleur from "kleur";
import { ApiClient } from "../client.ts";
import { resolveAuth } from "../config.ts";
import type { GlobalOpts } from "../output.ts";
import { printResult } from "../output.ts";

interface BalanceResponse {
  balance: number;
  userId: string;
}

export function registerBalanceCommand(root: Command): void {
  root
    .command("balance")
    .description("Show your current credit balance")
    .addHelpText(
      "after",
      `
Examples:
  $ na balance
  $ na balance --json | jq '.data.balance'
`
    )
    .action(async (_: unknown, command) => {
      const g = command.optsWithGlobals() as GlobalOpts;
      const client = new ApiClient({ ...resolveAuth(g), debug: g.debug });
      const data = await client.request<BalanceResponse>("GET", "/me/balance");

      printResult("balance", data, {
        globalOpts: g,
        pretty: (d) => {
          process.stdout.write(`${kleur.bold(String(d.balance))} ${kleur.dim("RUB credits")}\n`);
        },
        next_actions: [
          { command: "na usage summary", description: "Inspect spend across rolling windows" },
          { command: "na activity", description: "Last generations" },
        ],
      });
    });
}
