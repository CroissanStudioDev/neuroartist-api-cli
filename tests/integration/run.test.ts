import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMockGateway, TEST_API_KEY } from "../helpers/mock-gateway.ts";
import { runCli } from "../helpers/run-cli.ts";
import { createTempEnv } from "../helpers/temp-config.ts";

let mock: ReturnType<typeof startMockGateway>;
let env: ReturnType<typeof createTempEnv>;
let outDir: string;

const TINY_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

beforeEach(() => {
  env = createTempEnv();
  outDir = mkdtempSync(join(tmpdir(), "na-run-out-"));
});

afterEach(() => {
  mock?.stop();
  env.cleanup();
  rmSync(outDir, { recursive: true, force: true });
});

describe("run + queue", () => {
  test("run sync returns result envelope", async () => {
    mock = startMockGateway();
    const r = await runCli(["run", "test-model", "-i", "prompt=hello"], {
      XDG_CONFIG_HOME: env.configHome,
      NEUROARTIST_API_URL: mock.baseUrl,
      NEUROARTIST_API_KEY: TEST_API_KEY,
    });
    expect(r.exitCode).toBe(0);
    const env_ = JSON.parse(r.stdout);
    expect(env_.data.mode).toBe("sync");
    expect(env_.data.result.images[0].url).toBe("https://example.com/output.png");
  });

  test("run sends correct body to /run/{model}", async () => {
    mock = startMockGateway();
    await runCli(["run", "my-model", "-i", "prompt=cat", "-i", "steps=20"], {
      XDG_CONFIG_HOME: env.configHome,
      NEUROARTIST_API_URL: mock.baseUrl,
      NEUROARTIST_API_KEY: TEST_API_KEY,
    });
    const runReq = mock.requests.find((r) => r.pathname === "/run/my-model");
    expect(runReq).toBeDefined();
    expect(runReq?.method).toBe("POST");
    expect(JSON.parse(runReq!.body)).toEqual({ prompt: "cat", steps: 20 });
  });

  test("run with -o downloads referenced URLs", async () => {
    mock = startMockGateway({
      routes: {
        "/run/dl-model": () =>
          Response.json({
            images: [{ url: "http://localhost:0/asset.png" }],
          }),
      },
    });

    // Spin a tiny file server for the asset URL.
    const fileServer = Bun.serve({
      port: 0,
      fetch() {
        return new Response(TINY_PNG, { headers: { "content-type": "image/png" } });
      },
    });
    const assetUrl = `http://localhost:${fileServer.port}/asset.png`;

    // Re-start mock with the actual asset URL substituted.
    mock.stop();
    mock = startMockGateway({
      routes: {
        "/run/dl-model": () => Response.json({ images: [{ url: assetUrl }] }),
      },
    });

    const r = await runCli(["run", "dl-model", "-i", "prompt=x", "-o", outDir], {
      XDG_CONFIG_HOME: env.configHome,
      NEUROARTIST_API_URL: mock.baseUrl,
      NEUROARTIST_API_KEY: TEST_API_KEY,
    });

    expect(r.exitCode).toBe(0);
    const env_ = JSON.parse(r.stdout);
    expect(env_.data.downloads).toHaveLength(1);
    const file = readdirSync(outDir)[0];
    expect(file).toBeDefined();
    const buf = readFileSync(join(outDir, file!));
    expect(buf.length).toBeGreaterThan(50);

    fileServer.stop(true);
  });

  test("queue submit returns requestId + next_actions", async () => {
    mock = startMockGateway();
    const r = await runCli(["queue", "submit", "test-model", "-i", "prompt=hi"], {
      XDG_CONFIG_HOME: env.configHome,
      NEUROARTIST_API_URL: mock.baseUrl,
      NEUROARTIST_API_KEY: TEST_API_KEY,
    });
    expect(r.exitCode).toBe(0);
    const env_ = JSON.parse(r.stdout);
    expect(env_.data.request_id).toBe("req_xyz");
    expect(env_.next_actions).toBeDefined();
    expect(env_.next_actions[0].command).toMatch(/queue stream/);
  });

  test("queue status", async () => {
    mock = startMockGateway();
    const r = await runCli(["queue", "status", "test-model", "req_abc"], {
      XDG_CONFIG_HOME: env.configHome,
      NEUROARTIST_API_URL: mock.baseUrl,
      NEUROARTIST_API_KEY: TEST_API_KEY,
    });
    expect(r.exitCode).toBe(0);
    const env_ = JSON.parse(r.stdout);
    expect(env_.data.status).toBe("COMPLETED");
  });

  test("queue stream emits NDJSON of SSE frames", async () => {
    mock = startMockGateway();
    const r = await runCli(["queue", "stream", "test-model", "req_abc"], {
      XDG_CONFIG_HOME: env.configHome,
      NEUROARTIST_API_URL: mock.baseUrl,
      NEUROARTIST_API_KEY: TEST_API_KEY,
    });
    expect(r.exitCode).toBe(0);
    const lines = r.stdout.trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed[0].stage).toBe("starting");
    expect(parsed.at(-1).stage).toBe("completed");
  });

  test("queue cancel", async () => {
    mock = startMockGateway();
    const r = await runCli(["queue", "cancel", "test-model", "req_abc"], {
      XDG_CONFIG_HOME: env.configHome,
      NEUROARTIST_API_URL: mock.baseUrl,
      NEUROARTIST_API_KEY: TEST_API_KEY,
    });
    expect(r.exitCode).toBe(0);
  });
});
