import { type Server, serve } from "bun";

export type Handler = (req: Request, url: URL) => Response | Promise<Response>;

export interface MockOptions {
  /** Expected x-api-key on all authed routes. */
  apiKey?: string;
  /** Initial balance returned by GET /me/balance. */
  balance?: number;
  /** Force every request to fail with this status. */
  failWith?: number;
  /** Items returned by GET /models. */
  models?: Array<{
    modelId: string;
    displayName?: string;
    category?: string;
    priceRub?: number;
    creditCost?: number;
    modelLab?: string;
  }>;
  /** Pre-defined route handlers (path → handler). Override defaults. */
  routes?: Record<string, Handler>;
}

export interface MockApi {
  baseUrl: string;
  /** All requests received, in order. */
  readonly requests: Array<{
    method: string;
    pathname: string;
    headers: Record<string, string>;
    body: string;
  }>;
  stop: () => void;
}

const DEFAULT_KEY = "na_live_testkey1234567890";

const SAMPLE_USER = {
  id: "u_test",
  email: "test@example.com",
  name: "Test User",
  role: "user",
};

// Route patterns hoisted so handlers stay below the cognitive-complexity bar
// and we don't allocate regexes per request.
const MODEL_DETAIL_RE = /^\/models\/(.+)$/;
const RUN_RE = /^\/run\/(.+)$/;
const QUEUE_SUBMIT_RE = /^\/queue\/([^/]+)$/;
const QUEUE_STATUS_RE = /^\/queue\/(.+)\/requests\/([^/]+)\/status$/;
const QUEUE_RESULT_RE = /^\/queue\/(.+)\/requests\/([^/]+)$/;
const QUEUE_CANCEL_RE = /^\/queue\/(.+)\/requests\/([^/]+)\/cancel$/;
const PUBLIC_MODEL_DETAIL_RE = /^\/models\/[^/]+$/;

function isPublic(pathname: string): boolean {
  return pathname === "/health" || pathname === "/models" || PUBLIC_MODEL_DETAIL_RE.test(pathname);
}

function buildAuthGate(expectedKey: string) {
  return (req: Request, url: URL): Response | null => {
    if (isPublic(url.pathname)) {
      return null;
    }
    const key = req.headers.get("x-api-key");
    if (!key) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    if (key !== expectedKey) {
      return Response.json({ error: "invalid_api_key" }, { status: 401 });
    }
    return null;
  };
}

function meRoute(): Response {
  return Response.json({
    user: SAMPLE_USER,
    auth: { source: "apiKey", apiKeyId: "k_test" },
  });
}

function balanceRoute(balance: number): Response {
  return Response.json({ userId: SAMPLE_USER.id, balance });
}

function usageSummaryRoute(balance: number): Response {
  return Response.json({
    balance,
    windows: [
      { window: "5h", credits: 0, count: 0, byModel: [] },
      { window: "24h", credits: 50, count: 3, byModel: [] },
    ],
  });
}

function activityRoute(): Response {
  return Response.json({
    items: [
      {
        falRequestId: "req_abc",
        modelId: "test-model",
        status: "success",
        credits: 10,
        createdAt: "2026-04-25T19:00:00Z",
      },
    ],
    total: 1,
  });
}

function modelsListRoute(items: NonNullable<MockOptions["models"]>): Response {
  return Response.json({ items, total: items.length, limit: 50, offset: 0 });
}

function modelDetailRoute(id: string): Response {
  return Response.json({
    modelId: id,
    displayName: `${id} display`,
    category: "text-to-image",
    priceRub: 10,
    schema: { input: { prompt: { type: "string" } } },
  });
}

function runSyncRoute(): Response {
  return Response.json({
    images: [{ url: "https://example.com/output.png" }],
    description: "stub",
  });
}

function queueSubmitRoute(): Response {
  return Response.json({ request_id: "req_xyz", status: "IN_QUEUE" });
}

function queueStatusRoute(reqId: string): Response {
  return Response.json({ status: "COMPLETED", request_id: reqId });
}

function queueResultRoute(): Response {
  return Response.json({ images: [{ url: "https://example.com/result.png" }] });
}

function queueCancelRoute(): Response {
  return Response.json({ cancelled: true });
}

type ExactRoute = (opts: MockOptions) => Response;

function defaultModels(opts: MockOptions): NonNullable<MockOptions["models"]> {
  return (
    opts.models ?? [
      {
        modelId: "test-model",
        displayName: "Test Model",
        category: "text-to-image",
        priceRub: 10,
        creditCost: 10,
        modelLab: "Test",
      },
    ]
  );
}

const EXACT_GET_ROUTES: Record<string, ExactRoute> = {
  "/health": () => Response.json({ status: "ok" }),
  "/me": () => meRoute(),
  "/me/balance": (opts) => balanceRoute(opts.balance ?? 1000),
  "/me/usage": (opts) => usageSummaryRoute(opts.balance ?? 1000),
  "/me/usage/by-model": () =>
    Response.json({ items: [{ modelId: "test-model", credits: 50, count: 3 }] }),
  "/me/activity": () => activityRoute(),
  "/models": (opts) => modelsListRoute(defaultModels(opts)),
};

interface PatternRoute {
  handle: (match: RegExpExecArray) => Response;
  method: string;
  re: RegExp;
}

const PATTERN_ROUTES: PatternRoute[] = [
  { re: QUEUE_CANCEL_RE, method: "PUT", handle: () => queueCancelRoute() },
  {
    re: QUEUE_STATUS_RE,
    method: "GET",
    handle: (m) => queueStatusRoute(m[2] ?? "unknown"),
  },
  { re: QUEUE_RESULT_RE, method: "GET", handle: () => queueResultRoute() },
  { re: QUEUE_SUBMIT_RE, method: "POST", handle: () => queueSubmitRoute() },
  { re: RUN_RE, method: "POST", handle: () => runSyncRoute() },
  {
    re: MODEL_DETAIL_RE,
    method: "GET",
    handle: (m) => modelDetailRoute(m[1] ?? "unknown"),
  },
];

function dispatchPattern(req: Request, pathname: string, opts: MockOptions): Response | null {
  if (req.method === "GET") {
    const exact = EXACT_GET_ROUTES[pathname];
    if (exact) {
      return exact(opts);
    }
  }
  for (const { re, method, handle } of PATTERN_ROUTES) {
    if (req.method !== method) {
      continue;
    }
    const match = re.exec(pathname);
    if (match) {
      return handle(match);
    }
  }
  return null;
}

export function startMockApi(opts: MockOptions = {}): MockApi {
  const expectedKey = opts.apiKey ?? DEFAULT_KEY;
  const requests: MockApi["requests"] = [];
  const authGate = buildAuthGate(expectedKey);

  const server: Server = serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const body = req.body ? await req.clone().text() : "";
      const headers: Record<string, string> = {};
      req.headers.forEach((v, k) => {
        headers[k] = v;
      });
      requests.push({ method: req.method, pathname: url.pathname, headers, body });

      if (opts.failWith) {
        return Response.json({ error: "forced_failure" }, { status: opts.failWith });
      }

      const override = opts.routes?.[url.pathname];
      if (override) {
        return override(req, url);
      }

      const authFail = authGate(req, url);
      if (authFail) {
        return authFail;
      }

      const standard = dispatchPattern(req, url.pathname, opts);
      if (standard) {
        return standard;
      }

      return Response.json({ error: "not_found", path: url.pathname }, { status: 404 });
    },
  });

  return {
    baseUrl: `http://localhost:${server.port}`,
    stop: () => {
      server.stop(true);
    },
    requests,
  };
}

export const TEST_API_KEY = DEFAULT_KEY;
