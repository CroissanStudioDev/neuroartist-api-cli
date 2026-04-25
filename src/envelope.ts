/**
 * Agent-friendly response envelope.
 *
 * Every JSON output from the CLI follows the same shape so agents can rely on
 * a stable contract: parse top-level fields, branch on `ok`, read `data` or
 * `error`, optionally use `next_actions` for self-recovery.
 */

import { ApiError, CliError } from "./client.ts";

export const SCHEMA_VERSION = 1;

const FETCH_ERR_RE = /fetch/;

export interface NextAction {
  command: string;
  description: string;
}

export interface SuccessEnvelope<T = unknown> {
  command: string;
  data: T;
  next_actions?: NextAction[];
  ok: true;
  schemaVersion: number;
  warnings?: string[];
}

export interface ErrorEnvelope {
  command: string;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    retryAfterMs?: number;
    hint?: string;
    httpStatus?: number;
    body?: unknown;
  };
  next_actions?: NextAction[];
  ok: false;
  schemaVersion: number;
}

export type Envelope<T = unknown> = SuccessEnvelope<T> | ErrorEnvelope;

export function success<T>(
  command: string,
  data: T,
  extras?: { warnings?: string[]; next_actions?: NextAction[] }
): SuccessEnvelope<T> {
  return {
    ok: true,
    schemaVersion: SCHEMA_VERSION,
    command,
    data,
    ...(extras?.warnings && extras.warnings.length > 0 ? { warnings: extras.warnings } : {}),
    ...(extras?.next_actions && extras.next_actions.length > 0
      ? { next_actions: extras.next_actions }
      : {}),
  };
}

export function failure(
  command: string,
  err: ApiError | CliError | Error | unknown
): ErrorEnvelope {
  if (err instanceof CliError) {
    return {
      ok: false,
      schemaVersion: SCHEMA_VERSION,
      command,
      error: {
        code: err.code,
        message: err.message,
        retryable: false,
        ...(err.hint ? { hint: err.hint } : {}),
      },
    };
  }
  if (err instanceof ApiError) {
    return {
      ok: false,
      schemaVersion: SCHEMA_VERSION,
      command,
      error: {
        code: err.code ?? mapStatusToCode(err.status),
        message: err.message,
        retryable: isRetryableStatus(err.status),
        ...(retryAfterFromBody(err.body) ? { retryAfterMs: retryAfterFromBody(err.body) } : {}),
        ...(hintForCode(err.code, err.status) ? { hint: hintForCode(err.code, err.status) } : {}),
        httpStatus: err.status,
        body: err.body ?? undefined,
      },
      next_actions: nextActionsForError(err.code, err.status),
    };
  }
  if (err instanceof Error) {
    return {
      ok: false,
      schemaVersion: SCHEMA_VERSION,
      command,
      error: {
        code: "internal_error",
        message: err.message,
        retryable: false,
      },
    };
  }
  return {
    ok: false,
    schemaVersion: SCHEMA_VERSION,
    command,
    error: {
      code: "internal_error",
      message: String(err),
      retryable: false,
    },
  };
}

/**
 * Exit codes follow the de-facto agentic-CLI convention:
 *   0   success
 *   2   usage / argument error (commander's default for parse errors)
 *   3   auth / permission error (401, 403)
 *   4   retryable / transient (5xx, 429, network)
 *   5   conflict (409)
 *   1   generic / unknown error
 */
export function exitCodeFor(err: unknown): number {
  if (err instanceof CliError) {
    return err.exitCode;
  }
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403 || err.code === "no_api_key") {
      return 3;
    }
    if (err.status === 409) {
      return 5;
    }
    if (err.status === 429 || err.status >= 500) {
      return 4;
    }
    if (err.status >= 400 && err.status < 500) {
      return 2;
    }
  }
  if (err && typeof err === "object" && "name" in err && (err as Error).name === "AbortError") {
    return 4;
  }
  if (err instanceof TypeError && FETCH_ERR_RE.test(err.message)) {
    return 4;
  }
  return 1;
}

function mapStatusToCode(status: number): string {
  if (status === 401) {
    return "unauthenticated";
  }
  if (status === 403) {
    return "forbidden";
  }
  if (status === 404) {
    return "not_found";
  }
  if (status === 409) {
    return "conflict";
  }
  if (status === 422) {
    return "invalid_input";
  }
  if (status === 429) {
    return "rate_limited";
  }
  if (status >= 500) {
    return "upstream_error";
  }
  return "request_failed";
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || (status >= 500 && status < 600);
}

function retryAfterFromBody(body: unknown): number | undefined {
  if (body && typeof body === "object" && body !== null) {
    const r = (body as Record<string, unknown>).retryAfterMs;
    if (typeof r === "number") {
      return r;
    }
  }
  return;
}

function hintForCode(code: string | null, status: number): string | undefined {
  if (code === "no_api_key" || status === 401) {
    return "Run `na auth login` or set NEUROARTIST_API_KEY.";
  }
  if (code === "insufficient_balance") {
    return "Top up your balance via the web dashboard or `POST /billing/topup`.";
  }
  if (status === 403) {
    return "Your API key may not have permission. Admin endpoints require session auth.";
  }
  if (code === "unknown_model" || status === 404) {
    return "Run `na models list` to see available models.";
  }
  if (status === 429) {
    return "Wait the duration in `retryAfterMs` and retry, or reduce request rate.";
  }
  if (status >= 500) {
    return "Upstream error. Wait a few seconds and retry.";
  }
  return;
}

function nextActionsForError(code: string | null, status: number): NextAction[] | undefined {
  if (code === "no_api_key" || status === 401) {
    return [
      { command: "na auth login", description: "Save an API key for the current profile" },
      { command: "na auth status", description: "Inspect configured profiles" },
    ];
  }
  if (code === "insufficient_balance") {
    return [
      { command: "na balance", description: "Confirm current balance" },
      { command: "na usage summary", description: "Inspect recent spend" },
    ];
  }
  if (code === "unknown_model" || status === 404) {
    return [{ command: "na models list", description: "Browse available models" }];
  }
  return;
}
