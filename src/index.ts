import { Command, Option } from "commander";
import { ApiError } from "./client.ts";
import { registerAuthCommands } from "./commands/auth.ts";
import { registerBalanceCommand } from "./commands/balance.ts";
import { registerCommandsCommand } from "./commands/commands.ts";
import { registerDoctorCommand } from "./commands/doctor.ts";
import { registerModelsCommands } from "./commands/models.ts";
import { registerQueueCommands } from "./commands/queue.ts";
import { registerRunCommand } from "./commands/run.ts";
import { registerUpdateCommand } from "./commands/update.ts";
import { registerUsageCommands } from "./commands/usage.ts";
import { exitCodeFor, failure } from "./envelope.ts";
import type { GlobalOpts } from "./output.ts";
import { detectFormat, printError, printJson } from "./output.ts";
import { VERSION } from "./version.ts";

const program = new Command();

program
  .name("na")
  .description("Neuroartist API Gateway command-line interface")
  .version(VERSION, "-v, --version", "Print version")
  .addOption(
    new Option("--profile <name>", "Profile name from config file").env("NEUROARTIST_PROFILE")
  )
  .addOption(new Option("--base-url <url>", "Override gateway base URL").env("NEUROARTIST_API_URL"))
  .option("--json", "Force JSON envelope output (default in non-TTY/CI)")
  .option("--debug", "Print HTTP traffic to stderr")
  .option("-q, --quiet", "Suppress informational stderr messages")
  .option("-y, --yes", "Non-interactive mode — never prompt; assume yes/defaults")
  .showHelpAfterError("(run with --help for usage)")
  .addHelpText(
    "after",
    `
Output:
  - Human pretty output in TTY, JSON envelope when piped or with --json.
  - JSON shape: { ok, schemaVersion, command, data | error, next_actions? }.
  - Errors include: code, message, retryable, retryAfterMs?, hint?, httpStatus.

Exit codes:
  0  success
  1  generic / unknown error
  2  usage / argument error (also: 4xx other than 401/403/409/429)
  3  authentication / permission (401, 403, no_api_key)
  4  retryable / transient (429, 5xx, network)
  5  conflict (409)

Environment:
  NEUROARTIST_API_KEY    API key (overrides config)
  NEUROARTIST_API_URL    Gateway base URL (overrides config)
  NEUROARTIST_PROFILE    Profile name (overrides config defaultProfile)
  NEUROARTIST_JSON=1     Same as passing --json
  NO_COLOR=1             Disable ANSI colors
  CI=true                Treated as non-interactive

Examples:
  $ na auth login
  $ na models list --search banana --json | jq '.data.items[].modelId'
  $ na run nano-banana-pro -i prompt="кот" -o ./out
  $ na queue stream nano-banana-pro <requestId>
  $ na commands --json    # machine-readable command tree

Discoverability:
  $ na <command> --help   # any subcommand's help
  $ na commands --json    # all commands as JSON, for agents
`
  );

registerAuthCommands(program);
registerModelsCommands(program);
registerBalanceCommand(program);
registerRunCommand(program);
registerQueueCommands(program);
registerUsageCommands(program);
registerDoctorCommand(program);
registerUpdateCommand(program);
registerCommandsCommand(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  const cmdName = guessCommandName();
  const globalOpts = (program.opts() as GlobalOpts) ?? {};
  const format = detectFormat(globalOpts);

  if (format === "json") {
    printJson(failure(cmdName, err));
  } else if (err instanceof ApiError) {
    const code = err.code ? ` ${err.code}` : "";
    printError(`HTTP ${err.status}${code}: ${err.message}`);
    if (err.body && typeof err.body === "object") {
      process.stderr.write(`${JSON.stringify(err.body, null, 2)}\n`);
    }
  } else if (err instanceof Error) {
    printError(err.message);
    if (process.env.NEUROARTIST_TRACE) {
      process.stderr.write(`${err.stack ?? ""}\n`);
    }
  } else {
    printError(String(err));
  }

  process.exit(exitCodeFor(err));
});

function guessCommandName(): string {
  const argv = process.argv.slice(2);
  const parts: string[] = [];
  for (const a of argv) {
    if (a.startsWith("-")) {
      break;
    }
    parts.push(a);
    if (parts.length >= 3) {
      break;
    }
  }
  return parts.length > 0 ? parts.join(" ") : "na";
}
