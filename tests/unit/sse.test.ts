import { describe, expect, test } from "bun:test";
import { parseSse, type SseFrame } from "../../src/sse.ts";

function streamFrom(chunks: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(enc.encode(c));
      }
      controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

describe("parseSse", () => {
  test("single event with data", async () => {
    const res = streamFrom(['event: progress\ndata: {"stage":"starting"}\n\n']);
    const frames: SseFrame[] = [];
    for await (const f of parseSse(res)) {
      frames.push(f);
    }
    expect(frames).toEqual([{ event: "progress", data: '{"stage":"starting"}' }]);
  });

  test("two events split across chunks", async () => {
    const res = streamFrom(["event: a\ndata: 1\n\nevent: b\ndata: 2", "\n\n"]);
    const frames: SseFrame[] = [];
    for await (const f of parseSse(res)) {
      frames.push(f);
    }
    expect(frames).toEqual([
      { event: "a", data: "1" },
      { event: "b", data: "2" },
    ]);
  });

  test("data spans multiple lines", async () => {
    const res = streamFrom(["data: line1\ndata: line2\n\n"]);
    const frames: SseFrame[] = [];
    for await (const f of parseSse(res)) {
      frames.push(f);
    }
    expect(frames).toEqual([{ event: undefined, data: "line1\nline2" }]);
  });

  test("comment lines (:) are skipped", async () => {
    const res = streamFrom([": keepalive\nevent: tick\ndata: ok\n\n"]);
    const frames: SseFrame[] = [];
    for await (const f of parseSse(res)) {
      frames.push(f);
    }
    expect(frames).toEqual([{ event: "tick", data: "ok" }]);
  });

  test("frames without trailing blank line are emitted at EOF", async () => {
    const res = streamFrom(["event: x\ndata: y\n\n", "data: z"]);
    const frames: SseFrame[] = [];
    for await (const f of parseSse(res)) {
      frames.push(f);
    }
    expect(frames).toEqual([
      { event: "x", data: "y" },
      { event: undefined, data: "z" },
    ]);
  });

  test("CRLF line endings handled", async () => {
    const res = streamFrom(["event: x\r\ndata: 1\r\n\r\n"]);
    const frames: SseFrame[] = [];
    for await (const f of parseSse(res)) {
      frames.push(f);
    }
    expect(frames).toEqual([{ event: "x", data: "1" }]);
  });
});
