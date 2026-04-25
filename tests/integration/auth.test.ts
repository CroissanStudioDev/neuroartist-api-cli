import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { startMockGateway, TEST_API_KEY } from "../helpers/mock-gateway.ts";
import { runCli } from "../helpers/run-cli.ts";
import { createTempEnv } from "../helpers/temp-config.ts";

let mock: ReturnType<typeof startMockGateway>;
let env: ReturnType<typeof createTempEnv>;

beforeEach(() => {
  mock = startMockGateway();
  env = createTempEnv();
});

afterEach(() => {
  mock.stop();
  env.cleanup();
});

describe("auth login", () => {
  test("valid token → ok=true, persists profile", async () => {
    const r = await runCli(["auth", "login", "--token", TEST_API_KEY], {
      XDG_CONFIG_HOME: env.configHome,
      NEUROARTIST_API_URL: mock.baseUrl,
    });

    expect(r.exitCode).toBe(0);
    const env_ = JSON.parse(r.stdout);
    expect(env_.ok).toBe(true);
    expect(env_.command).toBe("auth login");
    expect(env_.data.user.email).toBe("test@example.com");

    // Subsequent command without --token should now use saved key
    const balance = await runCli(["balance"], {
      XDG_CONFIG_HOME: env.configHome,
      NEUROARTIST_API_URL: mock.baseUrl,
    });
    expect(balance.exitCode).toBe(0);
    expect(JSON.parse(balance.stdout).data.balance).toBe(1000);
  });

  test("invalid token → exit 3 (auth)", async () => {
    const r = await runCli(["auth", "login", "--token", "na_live_wrong"], {
      XDG_CONFIG_HOME: env.configHome,
      NEUROARTIST_API_URL: mock.baseUrl,
    });

    expect(r.exitCode).toBe(3);
    const env_ = JSON.parse(r.stdout);
    expect(env_.ok).toBe(false);
    expect(env_.error.httpStatus).toBe(401);
  });

  test("missing token in non-interactive → exit 2 (usage)", async () => {
    const r = await runCli(["auth", "login"], {
      XDG_CONFIG_HOME: env.configHome,
      NEUROARTIST_API_URL: mock.baseUrl,
      CI: "true",
    });

    expect(r.exitCode).toBe(2);
    const env_ = JSON.parse(r.stdout);
    expect(env_.error.code).toBe("missing_token");
  });

  test("login then logout removes key", async () => {
    await runCli(["auth", "login", "--token", TEST_API_KEY], {
      XDG_CONFIG_HOME: env.configHome,
      NEUROARTIST_API_URL: mock.baseUrl,
    });

    const logout = await runCli(["auth", "logout"], { XDG_CONFIG_HOME: env.configHome });
    expect(logout.exitCode).toBe(0);

    // After logout, balance should fail with no_api_key (exit 3)
    const balance = await runCli(["balance"], {
      XDG_CONFIG_HOME: env.configHome,
      NEUROARTIST_API_URL: mock.baseUrl,
    });
    expect(balance.exitCode).toBe(3);
    const env_ = JSON.parse(balance.stdout);
    expect(env_.error.code).toBe("no_api_key");
  });

  test("whoami after login returns user data", async () => {
    await runCli(["auth", "login", "--token", TEST_API_KEY], {
      XDG_CONFIG_HOME: env.configHome,
      NEUROARTIST_API_URL: mock.baseUrl,
    });

    const r = await runCli(["auth", "whoami"], {
      XDG_CONFIG_HOME: env.configHome,
      NEUROARTIST_API_URL: mock.baseUrl,
    });
    expect(r.exitCode).toBe(0);
    const env_ = JSON.parse(r.stdout);
    expect(env_.data.user.email).toBe("test@example.com");
    expect(env_.data.profile).toBe("default");
  });

  test("auth status lists configured profiles", async () => {
    await runCli(["auth", "login", "--token", TEST_API_KEY], {
      XDG_CONFIG_HOME: env.configHome,
      NEUROARTIST_API_URL: mock.baseUrl,
    });

    const r = await runCli(["auth", "status"], { XDG_CONFIG_HOME: env.configHome });
    expect(r.exitCode).toBe(0);
    const env_ = JSON.parse(r.stdout);
    expect(env_.data.profiles.default.hasKey).toBe(true);
    expect(env_.data.defaultProfile).toBe("default");
  });
});
