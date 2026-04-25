import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { startMockApi } from "../helpers/mock-api.ts";
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

describe("models", () => {
  test("models list (no auth required)", async () => {
    mock = startMockApi({
      models: [
        { modelId: "alpha", displayName: "Alpha", priceRub: 5 },
        { modelId: "beta", displayName: "Beta", priceRub: 15 },
      ],
    });
    const r = await runCli(["models", "list"], {
      XDG_CONFIG_HOME: env.configHome,
      NEUROARTIST_API_URL: mock.baseUrl,
    });
    expect(r.exitCode).toBe(0);
    const env_ = JSON.parse(r.stdout);
    expect(env_.data.items).toHaveLength(2);
    expect(env_.data.items[0].modelId).toBe("alpha");
    // No auth header should be sent for /models
    const listReq = mock.requests.find((r2) => r2.pathname === "/models");
    expect(listReq?.headers["x-api-key"]).toBeUndefined();
  });

  test("models list passes query params", async () => {
    mock = startMockApi();
    await runCli(["models", "list", "--search", "banana", "--limit", "5"], {
      XDG_CONFIG_HOME: env.configHome,
      NEUROARTIST_API_URL: mock.baseUrl,
    });
    const listReq = mock.requests.find((r) => r.pathname === "/models");
    expect(listReq).toBeDefined();
  });

  test("models get returns single model", async () => {
    mock = startMockApi();
    const r = await runCli(["models", "get", "test-model"], {
      XDG_CONFIG_HOME: env.configHome,
      NEUROARTIST_API_URL: mock.baseUrl,
    });
    expect(r.exitCode).toBe(0);
    const env_ = JSON.parse(r.stdout);
    expect(env_.data.modelId).toBe("test-model");
  });

  test("models schema returns the schema field directly", async () => {
    mock = startMockApi();
    const r = await runCli(["models", "schema", "test-model"], {
      XDG_CONFIG_HOME: env.configHome,
      NEUROARTIST_API_URL: mock.baseUrl,
    });
    expect(r.exitCode).toBe(0);
    const env_ = JSON.parse(r.stdout);
    expect(env_.data.input.prompt.type).toBe("string");
  });

  test("unknown model → 404 → exit 2", async () => {
    mock = startMockApi({
      routes: {
        "/models/unknown": () => Response.json({ error: "not_found" }, { status: 404 }),
      },
    });
    const r = await runCli(["models", "get", "unknown"], {
      XDG_CONFIG_HOME: env.configHome,
      NEUROARTIST_API_URL: mock.baseUrl,
    });
    expect(r.exitCode).toBe(2);
    const env_ = JSON.parse(r.stdout);
    expect(env_.error.httpStatus).toBe(404);
  });
});
