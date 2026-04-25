import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tempHome: string;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "na-cfg-test-"));
  process.env.XDG_CONFIG_HOME = tempHome;
  // Clear env var overrides between tests so resolveAuth uses the file.
  delete process.env.NEUROARTIST_API_KEY;
  delete process.env.NEUROARTIST_API_URL;
  delete process.env.NEUROARTIST_PROFILE;
});

afterEach(() => {
  delete process.env.XDG_CONFIG_HOME;
  rmSync(tempHome, { recursive: true, force: true });
});

// Dynamic import inside each test so module-level CONFIG_PATH (resolved at
// import time from XDG_CONFIG_HOME) picks up the fresh tempHome.
async function freshConfig() {
  // Bun's loader caches modules — bust by appending a query-string-like suffix
  // is not supported for relative imports, so we reset env BEFORE first import.
  return await import(`../../src/config.ts?cb=${Math.random()}`);
}

describe("config", () => {
  test("readConfig returns empty when no file exists", async () => {
    const cfg = await freshConfig();
    const out = cfg.readConfig();
    expect(out.profiles).toEqual({});
    expect(out.defaultProfile).toBe("default");
  });

  test("setProfileKey writes file with 0600 permissions", async () => {
    const cfg = await freshConfig();
    cfg.setProfileKey("default", "na_live_secret123", "https://example.com");
    const path = cfg.CONFIG_PATH;
    const st = statSync(path);
    // Permission bits = last 3 octal digits. Owner rw, no group, no other → "600".
    const permission = st.mode.toString(8).slice(-3);
    expect(permission).toBe("600");
    const out = cfg.readConfig();
    expect(out.profiles.default.apiKey).toBe("na_live_secret123");
    expect(out.profiles.default.baseUrl).toBe("https://example.com");
  });

  test("clearProfileKey removes apiKey but keeps profile", async () => {
    const cfg = await freshConfig();
    cfg.setProfileKey("dev", "k1", "https://dev.example");
    cfg.clearProfileKey("dev");
    const out = cfg.readConfig();
    expect(out.profiles.dev.apiKey).toBeUndefined();
    expect(out.profiles.dev.baseUrl).toBe("https://dev.example");
  });

  test("resolveAuth: env wins over file", async () => {
    const cfg = await freshConfig();
    cfg.setProfileKey("default", "from_file", "https://file.example");
    process.env.NEUROARTIST_API_KEY = "from_env";
    const r = cfg.resolveAuth({});
    expect(r.apiKey).toBe("from_env");
  });

  test("resolveAuth: explicit baseUrl flag wins over env and file", async () => {
    const cfg = await freshConfig();
    cfg.setProfileKey("default", "k", "https://file.example");
    process.env.NEUROARTIST_API_URL = "https://env.example";
    const r = cfg.resolveAuth({ baseUrl: "https://flag.example" });
    expect(r.baseUrl).toBe("https://flag.example");
  });

  test("resolveAuth: falls back to default URL when nothing set", async () => {
    const cfg = await freshConfig();
    const r = cfg.resolveAuth({});
    expect(r.baseUrl).toBe(cfg.DEFAULT_BASE_URL);
  });

  test("resolveAuth: profile flag selects different profile", async () => {
    const cfg = await freshConfig();
    cfg.setProfileKey("default", "default_key", "https://d.example");
    cfg.setProfileKey("work", "work_key", "https://s.example");
    const r = cfg.resolveAuth({ profile: "work" });
    expect(r.apiKey).toBe("work_key");
    expect(r.baseUrl).toBe("https://s.example");
  });
});
