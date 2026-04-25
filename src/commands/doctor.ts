import type { Command } from "commander";
import kleur from "kleur";
import { ApiClient, ApiError } from "../client.ts";
import { CONFIG_PATH, readConfig, resolveAuth } from "../config.ts";
import type { GlobalOpts } from "../output.ts";
import { printInfo, printResult, printSuccess, printWarning } from "../output.ts";

interface DiagnosticCheck {
  detail?: string;
  hint?: string;
  name: string;
  ok: boolean;
}

interface DiagnosticReport {
  baseUrl: string;
  checks: DiagnosticCheck[];
  configPath: string;
  hasApiKey: boolean;
  profile: string;
  profilesConfigured: string[];
}

export function registerDoctorCommand(root: Command): void {
  root
    .command("doctor")
    .description("Diagnose CLI configuration and connectivity")
    .addHelpText(
      "after",
      `
Examples:
  $ na doctor
  $ na doctor --base-url http://localhost:8000
  $ na doctor --json | jq '.data.checks[] | select(.ok | not)'
`
    )
    .action(async (_: unknown, command) => {
      const g = command.optsWithGlobals() as GlobalOpts;
      const cfg = readConfig();
      const resolved = resolveAuth(g);
      const checks: DiagnosticCheck[] = [];

      try {
        const client = new ApiClient({ ...resolved, debug: g.debug });
        await client.request<unknown>("GET", "/health", { auth: false });
        checks.push({ name: "gateway_health", ok: true });
      } catch (err) {
        checks.push({
          name: "gateway_health",
          ok: false,
          detail: (err as Error).message,
          hint: "Confirm the gateway URL or that it's reachable from this network.",
        });
      }

      if (resolved.apiKey) {
        try {
          const client = new ApiClient({ ...resolved, debug: g.debug });
          await client.request<unknown>("GET", "/me");
          checks.push({ name: "api_key_valid", ok: true });
        } catch (err) {
          if (err instanceof ApiError) {
            checks.push({
              name: "api_key_valid",
              ok: false,
              detail: `${err.status} ${err.code ?? ""}`.trim(),
              hint: "Run `na auth login` to refresh the key.",
            });
          } else {
            checks.push({
              name: "api_key_valid",
              ok: false,
              detail: (err as Error).message,
            });
          }
        }
      } else {
        checks.push({
          name: "api_key_present",
          ok: false,
          detail: "No API key configured for this profile",
          hint: "Run `na auth login` or set NEUROARTIST_API_KEY.",
        });
      }

      const report: DiagnosticReport = {
        configPath: CONFIG_PATH,
        profile: resolved.profile,
        baseUrl: resolved.baseUrl,
        hasApiKey: Boolean(resolved.apiKey),
        profilesConfigured: Object.keys(cfg.profiles),
        checks,
      };

      const allOk = checks.every((c) => c.ok);

      printResult("doctor", report, {
        globalOpts: g,
        pretty: (d) => {
          printInfo(`Config:    ${d.configPath}`, g);
          printInfo(`Profile:   ${d.profile}`, g);
          printInfo(`Base URL:  ${d.baseUrl}`, g);
          printInfo(
            `Profiles:  ${d.profilesConfigured.length > 0 ? d.profilesConfigured.join(", ") : "(none)"}`,
            g
          );
          printInfo(
            `API key:   ${d.hasApiKey ? kleur.dim(`${(resolved.apiKey ?? "").slice(0, 11)}…`) : kleur.dim("(not set)")}`,
            g
          );
          process.stderr.write("\n");
          for (const c of d.checks) {
            if (c.ok) {
              printSuccess(c.name, g);
            } else {
              printWarning(`${c.name} — ${c.detail ?? "failed"}${c.hint ? ` · ${c.hint}` : ""}`, g);
            }
          }
        },
      });

      if (!allOk) {
        process.exit(1);
      }
    });
}
