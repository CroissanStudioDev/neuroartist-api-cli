import type { Command } from "commander";
import { CliError } from "../client.ts";

interface SubCmd {
  children?: SubCmd[];
  description: string;
  name: string;
}

const ROOT_NAME = "na";

const SHELL_CHOICES = ["bash", "zsh", "fish"] as const;
type Shell = (typeof SHELL_CHOICES)[number];

const SHELL_INSTALL_HINT: Record<Shell, string> = {
  bash: `Add to ~/.bashrc:    eval "$(${ROOT_NAME} completion bash)"`,
  zsh: `Add to ~/.zshrc:     eval "$(${ROOT_NAME} completion zsh)"
Or save as a function file: ${ROOT_NAME} completion zsh > "\${fpath[1]}/_${ROOT_NAME}"`,
  fish: `Save to fish config:  ${ROOT_NAME} completion fish > ~/.config/fish/completions/${ROOT_NAME}.fish`,
};

export function registerCompletionCommand(root: Command): void {
  root
    .command("completion <shell>")
    .description("Print shell completion script (bash | zsh | fish)")
    .addHelpText(
      "after",
      `
Examples:
  $ na completion bash >> ~/.bashrc
  $ eval "$(na completion zsh)"
  $ na completion fish > ~/.config/fish/completions/na.fish

Install hints:
  bash:  ${SHELL_INSTALL_HINT.bash}
  zsh:   ${SHELL_INSTALL_HINT.zsh}
  fish:  ${SHELL_INSTALL_HINT.fish}
`
    )
    .action((shell: string, _opts, command) => {
      if (!isShell(shell)) {
        throw new CliError(
          "unsupported_shell",
          `Unsupported shell: ${shell}. Supported: ${SHELL_CHOICES.join(", ")}`,
          2
        );
      }
      const rootCommand = (command.parent ?? root) as Command;
      const tree = buildTree(rootCommand);
      const script = render(shell, tree);
      process.stdout.write(`${script}\n`);
    });
}

function isShell(s: string): s is Shell {
  return (SHELL_CHOICES as readonly string[]).includes(s);
}

function buildTree(cmd: Command): SubCmd[] {
  const out: SubCmd[] = [];
  for (const child of cmd.commands ?? []) {
    if (child.name() === "help") {
      continue;
    }
    const sub: SubCmd = {
      name: child.name(),
      description: cleanDescription(child.description() ?? ""),
    };
    if (child.commands && child.commands.length > 0) {
      sub.children = buildTree(child);
    }
    out.push(sub);
  }
  return out;
}

function cleanDescription(s: string): string {
  // Single line, no quotes (zsh/fish completion strings are quoted).
  return s
    .replace(/[\r\n]+/g, " ")
    .replace(/'/g, "")
    .trim();
}

function render(shell: Shell, tree: SubCmd[]): string {
  if (shell === "bash") {
    return renderBash(tree);
  }
  if (shell === "zsh") {
    return renderZsh(tree);
  }
  return renderFish(tree);
}

// ----- bash --------------------------------------------------------------

function renderBash(tree: SubCmd[]): string {
  const topLevel = tree.map((c) => c.name).join(" ");
  const cases: string[] = [];
  for (const cmd of tree) {
    if (!cmd.children || cmd.children.length === 0) {
      continue;
    }
    const sub = cmd.children.map((c) => c.name).join(" ");
    cases.push(`        ${cmd.name})
          COMPREPLY=( $(compgen -W "${sub}" -- "$cur") )
          return 0
          ;;`);
  }
  return `# ${ROOT_NAME} bash completion. Source: eval "$(${ROOT_NAME} completion bash)"
_${ROOT_NAME}_completion() {
  local cur prev cword
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  cword=$COMP_CWORD

  if [ "$cword" = "1" ]; then
    COMPREPLY=( $(compgen -W "${topLevel}" -- "$cur") )
    return 0
  fi

  if [ "$cword" = "2" ]; then
    case "\${COMP_WORDS[1]}" in
${cases.join("\n")}
    esac
  fi
}
complete -F _${ROOT_NAME}_completion ${ROOT_NAME}
`;
}

// ----- zsh ---------------------------------------------------------------

function renderZsh(tree: SubCmd[]): string {
  const topLevel = tree.map((c) => `    '${c.name}:${c.description}'`).join("\n");

  const subFns: string[] = [];
  const subCases: string[] = [];
  for (const cmd of tree) {
    if (!cmd.children || cmd.children.length === 0) {
      continue;
    }
    const fnName = `_${ROOT_NAME}_${cmd.name.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    const childLines = cmd.children.map((c) => `    '${c.name}:${c.description}'`).join("\n");
    subFns.push(`${fnName}() {
  local -a sub
  sub=(
${childLines}
  )
  _describe 'command' sub
}`);
    subCases.push(`        ${cmd.name}) ${fnName} ;;`);
  }

  return `#compdef ${ROOT_NAME}
# ${ROOT_NAME} zsh completion. Source: eval "$(${ROOT_NAME} completion zsh)"

_${ROOT_NAME}() {
  local context state state_descr line
  typeset -A opt_args

  _arguments -C \\
    '1: :->cmd' \\
    '*::arg:->args'

  case $state in
    cmd)
      local -a top
      top=(
${topLevel}
      )
      _describe 'command' top
      ;;
    args)
      case $line[1] in
${subCases.join("\n")}
      esac
      ;;
  esac
}

${subFns.join("\n\n")}

if [ "$funcstack[1]" = "_${ROOT_NAME}" ]; then
  _${ROOT_NAME} "$@"
else
  compdef _${ROOT_NAME} ${ROOT_NAME}
fi
`;
}

// ----- fish --------------------------------------------------------------

function renderFish(tree: SubCmd[]): string {
  const lines: string[] = [
    `# ${ROOT_NAME} fish completion. Save: ${ROOT_NAME} completion fish > ~/.config/fish/completions/${ROOT_NAME}.fish`,
    "",
    `complete -c ${ROOT_NAME} -f`,
    "",
  ];

  // Top-level subcommands — only when no subcommand is present yet.
  for (const cmd of tree) {
    lines.push(
      `complete -c ${ROOT_NAME} -n "__fish_use_subcommand" -a "${cmd.name}" -d '${cmd.description}'`
    );
  }
  lines.push("");

  // Children appear only when their parent subcommand has been seen.
  for (const cmd of tree) {
    if (!cmd.children || cmd.children.length === 0) {
      continue;
    }
    for (const child of cmd.children) {
      lines.push(
        `complete -c ${ROOT_NAME} -n "__fish_seen_subcommand_from ${cmd.name}" -a "${child.name}" -d '${child.description}'`
      );
    }
  }

  return lines.join("\n");
}
