import { describe, expect, test } from "bun:test";
import { runCli } from "../helpers/run-cli.ts";

describe("CLI meta-commands", () => {
  test("--version prints version", async () => {
    const r = await runCli(["--version"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("--help exits 0 and lists commands", async () => {
    const r = await runCli(["--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("auth");
    expect(r.stdout).toContain("models");
    expect(r.stdout).toContain("run");
    expect(r.stdout).toContain("Exit codes:");
  });

  test("commands --json returns the full command tree", async () => {
    const r = await runCli(["commands"]);
    expect(r.exitCode).toBe(0);
    const env_ = JSON.parse(r.stdout);
    expect(env_.ok).toBe(true);
    const names = (env_.data as Array<{ name: string }>).map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "na auth login",
        "na auth logout",
        "na models list",
        "na queue submit",
        "na run",
        "na update",
        "na completion",
      ])
    );
  });

  test("unknown command → exit 1 (commander default)", async () => {
    const r = await runCli(["this-does-not-exist"]);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/unknown command/i);
  });
});

describe("completion", () => {
  test("bash completion contains COMPREPLY function", async () => {
    const r = await runCli(["completion", "bash"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("_na_completion()");
    expect(r.stdout).toContain("compgen");
    expect(r.stdout).toContain("complete -F _na_completion na");
  });

  test("zsh completion contains compdef directive", async () => {
    const r = await runCli(["completion", "zsh"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("#compdef na");
    expect(r.stdout).toContain("_describe");
  });

  test("fish completion uses __fish_use_subcommand", async () => {
    const r = await runCli(["completion", "fish"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("__fish_use_subcommand");
    expect(r.stdout).toContain("__fish_seen_subcommand_from");
  });

  test("unsupported shell → exit 2", async () => {
    const r = await runCli(["completion", "powershell"]);
    expect(r.exitCode).toBe(2);
  });
});

describe("update --check", () => {
  test("dev mode detected when running source via bun", async () => {
    // Subprocess is `bun run src/index.ts ...` → mode dev
    const r = await runCli(["update", "--check"]);
    // May exit 0 with envelope; latest may be unreachable in CI without network
    const env_ = JSON.parse(r.stdout);
    expect(env_.ok).toBe(true);
    expect(env_.data.mode).toBe("dev");
    expect(env_.data.hint).toMatch(/git pull/);
  });
});
