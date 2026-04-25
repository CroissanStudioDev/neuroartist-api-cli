import { describe, expect, test } from "bun:test";
import { collectUrls } from "../../src/download.ts";

describe("collectUrls", () => {
  test("flat object", () => {
    expect(collectUrls({ url: "https://x.com/a.png", name: "a" })).toEqual(["https://x.com/a.png"]);
  });

  test("nested objects and arrays", () => {
    const payload = {
      images: [
        { url: "https://x.com/1.png", meta: { thumb: "https://x.com/t1.jpg" } },
        { url: "https://x.com/2.png" },
      ],
      audio: { url: "https://x.com/sound.mp3" },
    };
    expect(collectUrls(payload).sort()).toEqual([
      "https://x.com/1.png",
      "https://x.com/2.png",
      "https://x.com/sound.mp3",
      "https://x.com/t1.jpg",
    ]);
  });

  test("dedupes repeated URLs", () => {
    const payload = {
      a: "https://x.com/1.png",
      b: "https://x.com/1.png",
      list: ["https://x.com/1.png"],
    };
    expect(collectUrls(payload)).toEqual(["https://x.com/1.png"]);
  });

  test("ignores non-http strings", () => {
    expect(
      collectUrls({
        prompt: "make a cat",
        path: "/local/path",
        url: "https://x.com/x.png",
        b64: "data:image/png;base64,xxx",
      })
    ).toEqual(["https://x.com/x.png"]);
  });

  test("http and https both pick up", () => {
    expect(
      collectUrls({
        a: "http://x.com/a.png",
        b: "https://y.com/b.png",
      }).sort()
    ).toEqual(["http://x.com/a.png", "https://y.com/b.png"]);
  });

  test("primitives, null, undefined return empty", () => {
    expect(collectUrls(null)).toEqual([]);
    expect(collectUrls(undefined)).toEqual([]);
    expect(collectUrls("not a url")).toEqual([]);
    expect(collectUrls(42)).toEqual([]);
    expect(collectUrls(true)).toEqual([]);
  });
});
