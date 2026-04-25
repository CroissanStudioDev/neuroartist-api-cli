import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_BASE_URL = "https://api.neuroartist.ru";

const CONFIG_DIR = process.env.XDG_CONFIG_HOME
  ? join(process.env.XDG_CONFIG_HOME, "neuroartist")
  : join(homedir(), ".config", "neuroartist");

export const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export interface Profile {
  apiKey?: string;
  baseUrl?: string;
}

export interface ConfigShape {
  defaultProfile: string;
  profiles: Record<string, Profile>;
}

const EMPTY: ConfigShape = { defaultProfile: "default", profiles: {} };

export function readConfig(): ConfigShape {
  if (!existsSync(CONFIG_PATH)) {
    return { ...EMPTY, profiles: {} };
  }
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ConfigShape>;
    if (!parsed.profiles || typeof parsed.profiles !== "object") {
      return { ...EMPTY, profiles: {} };
    }
    return {
      defaultProfile: parsed.defaultProfile ?? "default",
      profiles: parsed.profiles as Record<string, Profile>,
    };
  } catch {
    return { ...EMPTY, profiles: {} };
  }
}

export function writeConfig(cfg: ConfigShape): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try {
    chmodSync(CONFIG_PATH, 0o600);
  } catch {
    // best-effort — Windows may not support chmod
  }
}

export interface ResolvedAuth {
  apiKey: string;
  baseUrl: string;
  profile: string;
}

export interface AuthOpts {
  baseUrl?: string;
  profile?: string;
}

export function resolveAuth(opts: AuthOpts): ResolvedAuth {
  const cfg = readConfig();
  const profileName = opts.profile ?? process.env.NEUROARTIST_PROFILE ?? cfg.defaultProfile;
  const profile = cfg.profiles[profileName] ?? {};
  const apiKey = process.env.NEUROARTIST_API_KEY ?? profile.apiKey ?? "";
  const baseUrl =
    opts.baseUrl ?? process.env.NEUROARTIST_API_URL ?? profile.baseUrl ?? DEFAULT_BASE_URL;
  return { apiKey, baseUrl, profile: profileName };
}

export function setProfileKey(profileName: string, apiKey: string, baseUrl?: string): void {
  const cfg = readConfig();
  const existing = cfg.profiles[profileName] ?? {};
  cfg.profiles[profileName] = {
    ...existing,
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
  };
  if (!cfg.defaultProfile || Object.keys(cfg.profiles).length === 1) {
    cfg.defaultProfile = profileName;
  }
  writeConfig(cfg);
}

export function clearProfileKey(profileName: string): void {
  const cfg = readConfig();
  if (cfg.profiles[profileName]) {
    cfg.profiles[profileName].apiKey = undefined;
    writeConfig(cfg);
  }
}
