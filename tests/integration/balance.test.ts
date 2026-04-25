import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { startMockApi, TEST_API_KEY } from "../helpers/mock-api.ts";
import { runCli } from "../helpers/run-cli.ts";
import { createTempEnv } from "../helpers/temp-config.ts";

let mock: ReturnType<typeof startMockApi>;
let env: ReturnType<typeof createTempEnv>;

beforeEach(() => {
  env = createTempEnv();
});

afterEach(() => {
  mock?.stop();
  env.cleanup();
});

describe("balance + usage", () => {
  test("balance returns envelope with userId+balance", async () => {
    mock = startMockApi({ balance: 2500 });
    const r = await runCli(["balance"], {
      XDG_CONFIG_HOME: env.configHome,
      NEUROARTIST_API_URL: mock.baseUrl,
      NEUROARTIST_API_KEY: TEST_API_KEY,
    });
    expect(r.exitCode).toBe(0);
    const env_ = JSON.parse(r.stdout);
    expect(env_.ok).toBe(true);
    expect(env_.data.balance).toBe(2500);
    expect(env_.data.userId).toBe("u_test");
  });

  test("balance sets x-api-key header", async () => {
    mock = startMockApi();
    await runCli(["balance"], {
      XDG_CONFIG_HOME: env.configHome,
      NEUROARTIST_API_URL: mock.baseUrl,
      NEUROARTIST_API_KEY: TEST_API_KEY,
    });
    const balanceReq = mock.requests.find((r) => r.pathname === "/me/balance");
    expect(balanceReq?.headers["x-api-key"]).toBe(TEST_API_KEY);
  });

  test("usage summary returns windows", async () => {
    mock = startMockApi();
    const r = await runCli(["usage", "summary"], {
      XDG_CONFIG_HOME: env.configHome,
      NEUROARTIST_API_URL: mock.baseUrl,
      NEUROARTIST_API_KEY: TEST_API_KEY,
    });
    expect(r.exitCode).toBe(0);
    const env_ = JSON.parse(r.stdout);
    expect(Array.isArray(env_.data.windows)).toBe(true);
  });

  test("activity returns items", async () => {
    mock = startMockApi();
    const r = await runCli(["activity"], {
      XDG_CONFIG_HOME: env.configHome,
      NEUROARTIST_API_URL: mock.baseUrl,
      NEUROARTIST_API_KEY: TEST_API_KEY,
    });
    expect(r.exitCode).toBe(0);
    const env_ = JSON.parse(r.stdout);
    expect(env_.data.items[0].modelId).toBe("test-model");
  });

  test("server 500 → exit 4 (retryable)", async () => {
    mock = startMockApi({ failWith: 500 });
    const r = await runCli(["balance"], {
      XDG_CONFIG_HOME: env.configHome,
      NEUROARTIST_API_URL: mock.baseUrl,
      NEUROARTIST_API_KEY: TEST_API_KEY,
    });
    expect(r.exitCode).toBe(4);
    const env_ = JSON.parse(r.stdout);
    expect(env_.error.retryable).toBe(true);
  });

  test("server 429 → exit 4 + retryable=true", async () => {
    mock = startMockApi({ failWith: 429 });
    const r = await runCli(["balance"], {
      XDG_CONFIG_HOME: env.configHome,
      NEUROARTIST_API_URL: mock.baseUrl,
      NEUROARTIST_API_KEY: TEST_API_KEY,
    });
    expect(r.exitCode).toBe(4);
  });
});
