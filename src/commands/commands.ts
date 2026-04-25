import type { Command } from "commander";
import type { GlobalOpts } from "../output.ts";
import { printResult, table } from "../output.ts";

interface CommandSpec {
  args: { name: string; required: boolean; variadic: boolean }[];
  description: string;
  name: string;
  options: { flags: string; description: string; default?: unknown; required: boolean }[];
}

/**
 * Self-discovery command — emit the entire command tree in a structured form.
 *
 * Agents can call `na commands --json` once to learn the contract instead of
 * scraping `--help`. JSON shape is part of the public contract (schemaVersion).
 */
export function registerCommandsCommand(root: Command): void {
  root
    .command("commands")
    .description("List every command and option (machine-readable contract)")
    .action((_: unknown, command) => {
      const g = command.optsWithGlobals() as GlobalOpts;
      const tree = walk(root);

      printResult("commands", tree, {
        globalOpts: g,
        pretty: (data) => {
          const flat = flatten(data);
          table(
            flat.map((c) => ({
              command: c.name,
              args: c.args.map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`)).join(" "),
              description:
                c.description.length > 60 ? `${c.description.slice(0, 57)}…` : c.description,
            })),
            ["command", "args", "description"]
          );
        },
      });
    });
}

function walk(cmd: Command, prefix: string[] = []): CommandSpec[] {
  const out: CommandSpec[] = [];
  const path = [...prefix, cmd.name()].filter(Boolean);

  if (path.length > 0 && cmd.name() !== "na") {
    out.push(toSpec(cmd, path));
  }

  for (const child of cmd.commands ?? []) {
    if (child.name() === "help") {
      continue;
    }
    if (child.commands && child.commands.length > 0) {
      out.push(...walk(child, path));
    } else {
      out.push(toSpec(child, [...path, child.name()]));
    }
  }
  return out;
}

function toSpec(cmd: Command, fullPath: string[]): CommandSpec {
  const args = (cmd.registeredArguments ?? []).map((a) => ({
    name: a.name(),
    required: a.required,
    variadic: a.variadic,
  }));
  const options = cmd.options.map((o) => ({
    flags: o.flags,
    description: o.description,
    default: o.defaultValue,
    required: o.required,
  }));
  return {
    name: fullPath.join(" "),
    description: cmd.description() ?? "",
    args,
    options,
  };
}

function flatten(specs: CommandSpec[]): CommandSpec[] {
  return [...specs].sort((a, b) => a.name.localeCompare(b.name));
}
