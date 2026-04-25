import { cancel, isCancel, password } from "@clack/prompts";
import type { Command } from "commander";
import kleur from "kleur";
import { ApiClient, CliError } from "../client.ts";
import { CONFIG_PATH, clearProfileKey, readConfig, resolveAuth, setProfileKey } from "../config.ts";
import type { GlobalOpts } from "../output.ts";
import { isInteractive, printInfo, printResult, printSuccess } from "../output.ts";

interface MeResponse {
  auth?: { source?: string; apiKeyId?: string | null };
  user?: { id: string; email?: string; role?: string; name?: string };
}

export function registerAuthCommands(root: Command): void {
  const auth = root.command("auth").description("Manage CLI authentication");

  auth
    .command("login")
    .description("Save an API key for use by subsequent commands")
    .option("--token <token>", "API key to save (skips interactive prompt)")
    .addHelpText(
      "after",
      `
Examples:
  $ na auth login                                # interactive paste
  $ na auth login --token $NEUROARTIST_API_KEY   # non-interactive
  $ na --profile staging auth login --base-url https://staging.neuroartist.ru
`
    )
    .action(async (opts: { token?: string }, command) => {
      const g = command.optsWithGlobals() as GlobalOpts;
      const resolved = resolveAuth(g);

      let token = opts.token ?? process.env.NEUROARTIST_API_KEY;
      if (!token) {
        if (!isInteractive(g)) {
          throw new CliError(
            "missing_token",
            "No API key supplied. Pass --token or set NEUROARTIST_API_KEY (non-interactive mode).",
            2,
            "Pass --token <key> or export NEUROARTIST_API_KEY before running in CI."
          );
        }
        const answer = await password({
          message: "Paste your Neuroartist API key (na_live_...)",
          validate: (v) => (v && v.length >= 16 ? undefined : "API key looks too short"),
        });
        if (isCancel(answer)) {
          cancel("Cancelled");
          process.exit(1);
        }
        token = answer as string;
      }

      const client = new ApiClient({
        ...resolved,
        apiKey: token,
        debug: g.debug,
      });

      const me = await client.request<MeResponse>("GET", "/me");
      setProfileKey(resolved.profile, token, g.baseUrl);
      const who = me.user?.email ?? me.user?.id ?? "unknown user";

      printResult(
        "auth login",
        { profile: resolved.profile, user: me.user, baseUrl: resolved.baseUrl },
        {
          globalOpts: g,
          pretty: () => {
            printSuccess(
              `Logged in as ${kleur.bold(who)} (profile: ${kleur.cyan(resolved.profile)})`,
              g
            );
            printInfo(`Stored at ${CONFIG_PATH}`, g);
          },
          next_actions: [
            { command: "na balance", description: "Check current credit balance" },
            { command: "na models list", description: "Browse the public catalog" },
          ],
        }
      );
    });

  auth
    .command("logout")
    .description("Remove the API key for the current profile")
    .action((_: unknown, command) => {
      const g = command.optsWithGlobals() as GlobalOpts;
      const resolved = resolveAuth(g);
      clearProfileKey(resolved.profile);
      printResult(
        "auth logout",
        { profile: resolved.profile },
        {
          globalOpts: g,
          pretty: () => {
            printSuccess(`Logged out (profile: ${kleur.cyan(resolved.profile)})`, g);
          },
        }
      );
    });

  auth
    .command("whoami")
    .description("Show the user behind the current API key")
    .action(async (_: unknown, command) => {
      const g = command.optsWithGlobals() as GlobalOpts;
      const resolved = resolveAuth(g);
      const client = new ApiClient({ ...resolved, debug: g.debug });
      const me = await client.request<MeResponse>("GET", "/me");

      printResult(
        "auth whoami",
        { profile: resolved.profile, baseUrl: resolved.baseUrl, ...me },
        {
          globalOpts: g,
          pretty: (data) => {
            const u = data.user;
            const lines = [
              `${kleur.dim("Profile:")}  ${resolved.profile}`,
              `${kleur.dim("Base URL:")} ${resolved.baseUrl}`,
            ];
            if (u) {
              lines.push(`${kleur.dim("User:")}     ${u.email ?? u.id}`);
              if (u.name) {
                lines.push(`${kleur.dim("Name:")}     ${u.name}`);
              }
              if (u.role) {
                lines.push(`${kleur.dim("Role:")}     ${u.role}`);
              }
            }
            if (data.auth?.source) {
              lines.push(`${kleur.dim("Source:")}   ${data.auth.source}`);
            }
            for (const ln of lines) {
              process.stdout.write(`${ln}\n`);
            }
          },
        }
      );
    });

  auth
    .command("status")
    .description("List configured profiles")
    .action((_: unknown, command) => {
      const g = command.optsWithGlobals() as GlobalOpts;
      const cfg = readConfig();
      const names = Object.keys(cfg.profiles);

      const data = {
        configPath: CONFIG_PATH,
        defaultProfile: cfg.defaultProfile,
        profiles: Object.fromEntries(
          names.map((n) => [
            n,
            {
              hasKey: Boolean(cfg.profiles[n]?.apiKey),
              baseUrl: cfg.profiles[n]?.baseUrl ?? null,
            },
          ])
        ),
      };

      printResult("auth status", data, {
        globalOpts: g,
        pretty: (d) => {
          printInfo(`Config: ${d.configPath}`, g);
          printInfo(`Default profile: ${d.defaultProfile}`, g);
          if (names.length === 0) {
            process.stdout.write(`${kleur.dim("(no profiles — run `na auth login`)")}\n`);
            return;
          }
          for (const name of names) {
            const profile = cfg.profiles[name];
            const marker = name === cfg.defaultProfile ? kleur.green("●") : " ";
            const key = profile?.apiKey
              ? `${kleur.dim(profile.apiKey.slice(0, 11))}…`
              : kleur.dim("(no key)");
            const base = profile?.baseUrl ? kleur.dim(profile.baseUrl) : "";
            process.stdout.write(`${marker} ${kleur.bold(name)}  ${key}  ${base}\n`);
          }
        },
      });
    });
}
