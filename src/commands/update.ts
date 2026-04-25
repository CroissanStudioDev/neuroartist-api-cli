import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import kleur from "kleur";
import { CliError } from "../client.ts";
import type { GlobalOpts } from "../output.ts";
import { isInteractive, printInfo, printResult, printSuccess, printWarning } from "../output.ts";
import { VERSION } from "../version.ts";

const REPO = "CroissanStudioDev/neuroartist-api-cli";

const PATH_SEP_RE = /[/\\]/;
const V_PREFIX_RE = /^v/;
const TAR_GZ_RE = /\.tar\.gz$/;

type InstallMode = "binary" | "npm" | "dev";

interface UpdateInfo {
  current: string;
  exePath: string;
  hint?: string;
  isNewer: boolean;
  latest: string | null;
  mode: InstallMode;
}

export function registerUpdateCommand(root: Command): void {
  root
    .command("update")
    .description("Update na to the latest release (or check for one)")
    .option("--check", "Only check the latest version, do not install")
    .option("--version <tag>", "Install a specific version (e.g. v0.1.1)")
    .option("--force", "Reinstall even if already on the latest version")
    .addHelpText(
      "after",
      `
Behaviour by install mode:
  binary  (curl-installer)  — downloads and replaces the binary in place
  npm     (npm install -g)  — prints the npm command to run
  dev     (git clone)       — prints the git/bun command to run

Examples:
  $ na update
  $ na update --check
  $ na update --version v0.1.0
`
    )
    .action(async (opts: { check?: boolean; version?: string; force?: boolean }, command) => {
      const g = command.optsWithGlobals() as GlobalOpts;

      const mode = detectMode();
      const exePath = process.execPath;
      const target = opts.version ?? "latest";
      const latest = await fetchLatestVersion(target);

      const isNewer = latest ? compareVersions(latest, VERSION) > 0 : false;

      const info: UpdateInfo = {
        mode,
        current: VERSION,
        latest,
        isNewer,
        exePath,
        hint: hintFor(mode),
      };

      if (opts.check) {
        printResult("update", info, {
          globalOpts: g,
          pretty: () => renderCheckPretty(info, g),
        });
        return;
      }

      if (mode !== "binary") {
        printResult("update", info, {
          globalOpts: g,
          pretty: () => {
            printWarning("Self-update only works for the standalone binary install.", g);
            if (info.hint) {
              process.stdout.write(`\n${kleur.bold("Run:")}\n  ${info.hint}\n`);
            }
          },
        });
        return;
      }

      if (!latest) {
        throw new CliError(
          "version_unknown",
          `Could not resolve target version: ${target}`,
          1,
          `Check https://github.com/${REPO}/releases for available tags.`
        );
      }

      if (!(isNewer || opts.force)) {
        printResult("update", info, {
          globalOpts: g,
          pretty: () => {
            printSuccess(`Already up to date (v${VERSION}). Pass --force to reinstall.`, g);
          },
        });
        return;
      }

      if (!(isInteractive(g) || g.yes || opts.force)) {
        // Non-interactive without explicit consent: refuse to overwrite.
        throw new CliError(
          "needs_consent",
          `Refusing to replace ${exePath} in non-interactive mode.`,
          2,
          "Re-run with --yes (or --force) to confirm the update."
        );
      }

      printInfo(`Updating from v${VERSION} → ${latest}…`, g);
      const newPath = await downloadAndReplace(latest, exePath, g);

      const verified = verifyBinary(newPath);
      printResult(
        "update",
        { ...info, latest, isNewer: true, installed: verified },
        {
          globalOpts: g,
          pretty: () => {
            printSuccess(`Updated to ${verified} at ${kleur.bold(exePath)}`, g);
          },
          next_actions: [{ command: "na --version", description: "Confirm the new version" }],
        }
      );
    });
}

function detectMode(): InstallMode {
  const entryPath = fileURLToPathSafe(import.meta.url);
  const exec = process.execPath.toLowerCase();
  const baseExec = exec.split(PATH_SEP_RE).pop() ?? "";

  // dev: running source .ts files (bun src/index.ts)
  if (entryPath.endsWith(".ts")) {
    return "dev";
  }

  // Compiled bun binary: execPath name is `na` / `na.exe` (or any non-node/bun name)
  if (
    baseExec !== "node" &&
    baseExec !== "node.exe" &&
    baseExec !== "bun" &&
    baseExec !== "bun.exe" &&
    !baseExec.startsWith("node-")
  ) {
    return "binary";
  }

  // Node-driven: anything else is npm/local-build
  if (entryPath.includes(`${joinSep("node_modules")}@neuroartist`)) {
    return "npm";
  }
  if (entryPath.includes("node_modules")) {
    return "npm";
  }
  return "dev";
}

function joinSep(s: string): string {
  return process.platform === "win32" ? `\\${s}\\` : `/${s}/`;
}

function fileURLToPathSafe(url: string): string {
  try {
    return fileURLToPath(url);
  } catch {
    return url;
  }
}

function hintFor(mode: InstallMode): string | undefined {
  if (mode === "npm") {
    return "npm install -g @neuroartist/cli@latest";
  }
  if (mode === "dev") {
    return "git pull && bun install";
  }
  return;
}

async function fetchLatestVersion(target: string): Promise<string | null> {
  try {
    if (target === "latest") {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { accept: "application/vnd.github+json" },
      });
      if (!res.ok) {
        return null;
      }
      const body = (await res.json()) as { tag_name?: string };
      return body.tag_name ?? null;
    }
    // Verify the requested tag exists
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${target}`, {
      headers: { accept: "application/vnd.github+json" },
    });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as { tag_name?: string };
    return body.tag_name ?? target;
  } catch {
    return null;
  }
}

/**
 * Compare two version strings (with or without `v` prefix).
 * Returns: 1 if a > b, -1 if a < b, 0 if equal.
 */
function compareVersions(a: string, b: string): number {
  const stripV = (s: string) => s.replace(V_PREFIX_RE, "");
  const parse = (s: string) =>
    stripV(s)
      .split(".")
      .map((p) => Number.parseInt(p, 10) || 0);

  const aa = parse(a);
  const bb = parse(b);
  const n = Math.max(aa.length, bb.length);
  for (let i = 0; i < n; i++) {
    const ai = aa[i] ?? 0;
    const bi = bb[i] ?? 0;
    if (ai > bi) {
      return 1;
    }
    if (ai < bi) {
      return -1;
    }
  }
  return 0;
}

function detectAssetName(): string {
  const platform = process.platform;
  const arch = process.arch;
  let os: string;
  let archName: string;
  let ext: string;

  if (platform === "linux") {
    os = "linux";
    ext = "tar.gz";
  } else if (platform === "darwin") {
    os = "darwin";
    ext = "tar.gz";
  } else if (platform === "win32") {
    os = "windows";
    ext = "zip";
  } else {
    throw new CliError(
      "unsupported_platform",
      `Self-update is not supported on platform: ${platform}`,
      2
    );
  }

  if (arch === "x64") {
    archName = "x64";
  } else if (arch === "arm64") {
    archName = "arm64";
  } else {
    throw new CliError(
      "unsupported_arch",
      `Self-update is not supported on architecture: ${arch}`,
      2
    );
  }

  return `na-${os}-${archName}.${ext}`;
}

async function downloadAndReplace(tag: string, exePath: string, g: GlobalOpts): Promise<string> {
  if (process.platform === "win32") {
    throw new CliError(
      "windows_not_supported",
      "Automatic self-update on Windows is not supported (cannot replace a running .exe).",
      2,
      `Download manually: https://github.com/${REPO}/releases/${tag}`
    );
  }

  const asset = detectAssetName();
  const url = `https://github.com/${REPO}/releases/download/${tag}/${asset}`;
  const tmp = join(tmpdir(), `na-update-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  const archive = join(tmp, asset);

  printInfo(`Downloading ${url}`, g);
  const res = await fetch(url);
  if (!res.ok) {
    throw new CliError("download_failed", `HTTP ${res.status} fetching ${url}`, 4);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  const { writeFileSync } = await import("node:fs");
  writeFileSync(archive, buf);

  // Use system tar (universally available on Linux/macOS) — avoids bundling
  // a tar implementation. Bun's standalone binary already includes shell-out.
  const tarRes = spawnSync("tar", ["-xzf", archive, "-C", tmp], { stdio: "inherit" });
  if (tarRes.status !== 0) {
    throw new CliError("extract_failed", `tar -xzf failed (exit ${tarRes.status})`, 1);
  }

  // Asset extracts as `na-<os>-<arch>` plain binary
  const innerName = asset.replace(TAR_GZ_RE, "");
  const newBinary = join(tmp, innerName);
  if (!existsSync(newBinary)) {
    throw new CliError("extract_invalid", `Expected binary not found in archive: ${innerName}`, 1);
  }

  chmodSync(newBinary, 0o755);

  // Strip macOS quarantine xattr so Gatekeeper doesn't block.
  if (process.platform === "darwin") {
    spawnSync("xattr", ["-d", "com.apple.quarantine", newBinary], { stdio: "ignore" });
  }

  // Atomic replace via rename in the same dir as exePath. If exePath is on
  // a different filesystem from /tmp, we need a staging file alongside it.
  const stagingPath = `${exePath}.new`;
  const backupPath = `${exePath}.bak`;

  // Copy to staging beside the target (cross-filesystem safe — direct rename
  // could fail across mount boundaries between /tmp and ~/.neuroartist/bin).
  copyFileSync(newBinary, stagingPath);
  chmodSync(stagingPath, 0o755);

  // Backup current, then move new into place.
  try {
    if (existsSync(backupPath)) {
      unlinkSync(backupPath);
    }
    renameSync(exePath, backupPath);
    renameSync(stagingPath, exePath);
    // On success, drop the backup.
    try {
      unlinkSync(backupPath);
    } catch {
      // best-effort
    }
  } catch (err) {
    // Best-effort restore.
    try {
      if (existsSync(backupPath) && !existsSync(exePath)) {
        renameSync(backupPath, exePath);
      }
    } catch {
      // user is left with .bak — surface the path
    }
    throw new CliError(
      "replace_failed",
      `Failed to replace ${exePath}: ${(err as Error).message}`,
      1,
      `Manual recovery: mv ${backupPath} ${exePath}`
    );
  }

  return exePath;
}

function verifyBinary(path: string): string {
  const res = spawnSync(path, ["--version"], { encoding: "utf-8" });
  if (res.status !== 0) {
    throw new CliError(
      "verify_failed",
      `Updated binary failed --version check (exit ${res.status})`,
      1
    );
  }
  return res.stdout.trim();
}

function renderCheckPretty(info: UpdateInfo, g: GlobalOpts): void {
  const { current, latest, isNewer, mode } = info;
  if (latest === null) {
    printWarning("Could not reach GitHub to check the latest release.", g);
    return;
  }
  process.stdout.write(`${kleur.dim("Mode:")}    ${mode}\n`);
  process.stdout.write(`${kleur.dim("Current:")} v${current}\n`);
  process.stdout.write(`${kleur.dim("Latest:")}  ${latest}\n`);
  if (isNewer) {
    process.stdout.write(`\n${kleur.green("⬆")} Update available.\n`);
    if (mode === "binary") {
      process.stdout.write(`Run: ${kleur.bold("na update")}\n`);
    } else if (info.hint) {
      process.stdout.write(`Run: ${kleur.bold(info.hint)}\n`);
    }
  } else {
    process.stdout.write(`\n${kleur.green("✔")} You are on the latest version.\n`);
  }
}
