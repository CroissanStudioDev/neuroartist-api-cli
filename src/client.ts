import type { ResolvedAuth } from "./config.ts";
import { VERSION } from "./version.ts";

const LEADING_SLASHES_RE = /^\/+/;

export class ApiError extends Error {
  status: number;
  code: string | null;
  body: unknown;

  constructor(status: number, code: string | null, body: unknown, message?: string) {
    super(message ?? `HTTP ${status}${code ? ` ${code}` : ""}`);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/**
 * Non-HTTP CLI error (bad usage, missing config, validation). Carries an
 * `exitCode` so the top-level handler can map to the right exit status.
 */
export class CliError extends Error {
  code: string;
  exitCode: number;
  hint?: string;

  constructor(code: string, message: string, exitCode = 2, hint?: string) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
    this.hint = hint;
  }
}

export type ClientOpts = ResolvedAuth & { debug?: boolean };

export interface RequestInitArgs {
  /** Set to false to skip the API key requirement (e.g. /health, public /models). */
  auth?: boolean;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}

const USER_AGENT = `neuroartist-cli/${VERSION}`;

export class ApiClient {
  private readonly opts: ClientOpts;

  constructor(opts: ClientOpts) {
    this.opts = opts;
  }

  private buildUrl(path: string, query?: RequestInitArgs["query"]): URL {
    const base = this.opts.baseUrl.endsWith("/") ? this.opts.baseUrl : `${this.opts.baseUrl}/`;
    const trimmed = path.replace(LEADING_SLASHES_RE, "");
    const url = new URL(trimmed, base);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== "") {
          url.searchParams.set(k, String(v));
        }
      }
    }
    return url;
  }

  private requireKey(): string {
    if (!this.opts.apiKey) {
      throw new ApiError(
        401,
        "no_api_key",
        null,
        "API key not configured. Run `na auth login` or set NEUROARTIST_API_KEY."
      );
    }
    return this.opts.apiKey;
  }

  async request<T = unknown>(method: string, path: string, init: RequestInitArgs = {}): Promise<T> {
    const url = this.buildUrl(path, init.query);
    const headers: Record<string, string> = {
      "user-agent": USER_AGENT,
      accept: "application/json",
    };
    if (init.auth !== false) {
      headers["x-api-key"] = this.requireKey();
    }
    let body: string | undefined;
    if (init.body !== undefined) {
      body = JSON.stringify(init.body);
      headers["content-type"] = "application/json";
    }

    if (this.opts.debug) {
      process.stderr.write(`[debug] → ${method} ${url.toString()}\n`);
      if (body) {
        process.stderr.write(`[debug]   body: ${body}\n`);
      }
    }

    const res = await fetch(url, { method, headers, body, signal: init.signal });
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (this.opts.debug) {
      process.stderr.write(`[debug] ← ${res.status} ${res.statusText}\n`);
    }

    if (!res.ok) {
      const code =
        parsed && typeof parsed === "object" && parsed !== null && "error" in parsed
          ? String((parsed as Record<string, unknown>).error)
          : null;
      const message =
        parsed && typeof parsed === "object" && parsed !== null && "message" in parsed
          ? String((parsed as Record<string, unknown>).message)
          : undefined;
      throw new ApiError(res.status, code, parsed, message);
    }

    return parsed as T;
  }
}
