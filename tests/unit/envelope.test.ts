import { describe, expect, test } from "bun:test";
import { ApiError, CliError } from "../../src/client.ts";
import { exitCodeFor, failure, SCHEMA_VERSION, success } from "../../src/envelope.ts";

describe("success envelope", () => {
  test("minimal shape", () => {
    expect(success("balance", { balance: 100 })).toEqual({
      ok: true,
      schemaVersion: SCHEMA_VERSION,
      command: "balance",
      data: { balance: 100 },
    });
  });

  test("includes next_actions when present", () => {
    const e = success(
      "auth login",
      { profile: "default" },
      {
        next_actions: [{ command: "na balance", description: "Check" }],
      }
    );
    expect(e.next_actions).toEqual([{ command: "na balance", description: "Check" }]);
  });

  test("omits empty next_actions/warnings", () => {
    const e = success("x", { y: 1 }, { next_actions: [], warnings: [] });
    expect(e).not.toHaveProperty("next_actions");
    expect(e).not.toHaveProperty("warnings");
  });
});

describe("failure envelope", () => {
  test("CliError → no httpStatus, retryable=false", () => {
    const env = failure(
      "auth login",
      new CliError("missing_token", "no token", 2, "set NEUROARTIST_API_KEY")
    );
    expect(env).toEqual({
      ok: false,
      schemaVersion: SCHEMA_VERSION,
      command: "auth login",
      error: {
        code: "missing_token",
        message: "no token",
        retryable: false,
        hint: "set NEUROARTIST_API_KEY",
      },
    });
  });

  test("ApiError 401 → unauthenticated, retryable=false", () => {
    const env = failure("balance", new ApiError(401, null, { error: "unauthorized" }));
    if (env.ok) {
      throw new Error("expected error envelope");
    }
    expect(env.error.code).toBe("unauthenticated");
    expect(env.error.retryable).toBe(false);
    expect(env.error.httpStatus).toBe(401);
  });

  test("ApiError 429 → rate_limited, retryable=true", () => {
    const env = failure("submit", new ApiError(429, null, { retryAfterMs: 5000 }));
    if (env.ok) {
      throw new Error("expected error envelope");
    }
    expect(env.error.code).toBe("rate_limited");
    expect(env.error.retryable).toBe(true);
    expect(env.error.retryAfterMs).toBe(5000);
  });

  test("ApiError 503 → upstream_error, retryable=true", () => {
    const env = failure("submit", new ApiError(503, null, null));
    if (env.ok) {
      throw new Error("expected error envelope");
    }
    expect(env.error.code).toBe("upstream_error");
    expect(env.error.retryable).toBe(true);
  });

  test("plain Error → internal_error", () => {
    const env = failure("x", new Error("boom"));
    if (env.ok) {
      throw new Error("expected error envelope");
    }
    expect(env.error.code).toBe("internal_error");
    expect(env.error.message).toBe("boom");
    expect(env.error.retryable).toBe(false);
  });

  test("api 401 → next_actions includes auth login", () => {
    const env = failure("balance", new ApiError(401, "no_api_key", null));
    expect(env.next_actions).toEqual(
      expect.arrayContaining([expect.objectContaining({ command: "na auth login" })])
    );
  });
});

describe("exitCodeFor", () => {
  test("CliError uses its exitCode", () => {
    expect(exitCodeFor(new CliError("x", "msg", 7))).toBe(7);
  });

  test("ApiError 401 → 3", () => {
    expect(exitCodeFor(new ApiError(401, null, null))).toBe(3);
  });

  test("ApiError 403 → 3", () => {
    expect(exitCodeFor(new ApiError(403, null, null))).toBe(3);
  });

  test("ApiError 409 → 5", () => {
    expect(exitCodeFor(new ApiError(409, null, null))).toBe(5);
  });

  test("ApiError 429 → 4", () => {
    expect(exitCodeFor(new ApiError(429, null, null))).toBe(4);
  });

  test("ApiError 500 → 4", () => {
    expect(exitCodeFor(new ApiError(500, null, null))).toBe(4);
  });

  test("ApiError 400 → 2", () => {
    expect(exitCodeFor(new ApiError(400, null, null))).toBe(2);
  });

  test("AbortError → 4", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(exitCodeFor(err)).toBe(4);
  });

  test("TypeError fetch → 4", () => {
    expect(exitCodeFor(new TypeError("fetch failed"))).toBe(4);
  });

  test("unknown → 1", () => {
    expect(exitCodeFor(new Error("???"))).toBe(1);
    expect(exitCodeFor("string error")).toBe(1);
  });
});
