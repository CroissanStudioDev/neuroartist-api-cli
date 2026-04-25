import type { Server } from "bun";

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

export interface MockGateway {
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

export function startMockGateway(opts: MockOptions = {}): MockGateway {
  const apiKey = opts.apiKey ?? DEFAULT_KEY;
  const requests: MockGateway["requests"] = [];

  const isPublic = (pathname: string) =>
    pathname === "/health" ||
    pathname === "/models" ||
    (pathname.startsWith("/models/") && pathname.split("/").length === 3);

  const server: Server = Bun.serve({
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

      if (opts.routes?.[url.pathname]) {
        return opts.routes[url.pathname]!(req, url);
      }

      // Auth gate
      if (!isPublic(url.pathname)) {
        const key = req.headers.get("x-api-key");
        if (!key) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }
        if (key !== apiKey) {
          return Response.json({ error: "invalid_api_key" }, { status: 401 });
        }
      }

      // ----- Standard routes -----
      if (url.pathname === "/health") {
        return Response.json({ status: "ok" });
      }

      if (url.pathname === "/me") {
        return Response.json({
          user: SAMPLE_USER,
          auth: { source: "apiKey", apiKeyId: "k_test" },
        });
      }

      if (url.pathname === "/me/balance") {
        return Response.json({ userId: SAMPLE_USER.id, balance: opts.balance ?? 1000 });
      }

      if (url.pathname === "/me/usage") {
        return Response.json({
          balance: opts.balance ?? 1000,
          windows: [
            { window: "5h", credits: 0, count: 0, byModel: [] },
            { window: "24h", credits: 50, count: 3, byModel: [] },
          ],
        });
      }

      if (url.pathname === "/me/usage/by-model") {
        return Response.json({ items: [{ modelId: "test-model", credits: 50, count: 3 }] });
      }

      if (url.pathname === "/me/activity") {
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

      if (url.pathname === "/models") {
        const items = opts.models ?? [
          {
            modelId: "test-model",
            displayName: "Test Model",
            category: "text-to-image",
            priceRub: 10,
            creditCost: 10,
            modelLab: "Test",
          },
        ];
        return Response.json({ items, total: items.length, limit: 50, offset: 0 });
      }

      const modelMatch = /^\/models\/(.+)$/.exec(url.pathname);
      if (modelMatch && req.method === "GET") {
        const id = modelMatch[1];
        return Response.json({
          modelId: id,
          displayName: `${id} display`,
          category: "text-to-image",
          priceRub: 10,
          schema: { input: { prompt: { type: "string" } } },
        });
      }

      const runMatch = /^\/run\/(.+)$/.exec(url.pathname);
      if (runMatch && req.method === "POST") {
        return Response.json({
          images: [{ url: "https://example.com/output.png" }],
          description: "stub",
        });
      }

      const queueSubmit = /^\/queue\/(.+)$/.exec(url.pathname);
      if (queueSubmit && req.method === "POST" && !url.pathname.includes("/requests/")) {
        return Response.json({ request_id: "req_xyz", status: "IN_QUEUE" });
      }

      const statusMatch = /^\/queue\/(.+)\/requests\/(.+)\/status$/.exec(url.pathname);
      if (statusMatch && req.method === "GET") {
        return Response.json({ status: "COMPLETED", request_id: statusMatch[2] });
      }

      const streamMatch = /^\/queue\/(.+)\/requests\/(.+)\/progress\/stream$/.exec(url.pathname);
      if (streamMatch && req.method === "GET") {
        return new Response(
          new ReadableStream({
            start(controller) {
              const enc = new TextEncoder();
              controller.enqueue(enc.encode('event: progress\ndata: {"stage":"starting"}\n\n'));
              controller.enqueue(enc.encode('event: progress\ndata: {"stage":"completed"}\n\n'));
              controller.close();
            },
          }),
          { headers: { "content-type": "text/event-stream" } }
        );
      }

      const resultMatch = /^\/queue\/(.+)\/requests\/(.+)$/.exec(url.pathname);
      if (resultMatch && req.method === "GET") {
        return Response.json({ images: [{ url: "https://example.com/result.png" }] });
      }

      const cancelMatch = /^\/queue\/(.+)\/requests\/(.+)\/cancel$/.exec(url.pathname);
      if (cancelMatch && req.method === "PUT") {
        return Response.json({ cancelled: true });
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
