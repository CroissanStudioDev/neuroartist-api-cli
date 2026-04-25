import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseInputs } from "../../src/inputs.ts";

const PNG_DATA_URL_RE = /^data:image\/png;base64,/;
const INVALID_INPUT_RE = /Invalid input arg/;

describe("parseInputs", () => {
  test("plain string", () => {
    expect(parseInputs(["prompt=hello"])).toEqual({ prompt: "hello" });
  });

  test("colon syntax", () => {
    expect(parseInputs(["prompt:hello"])).toEqual({ prompt: "hello" });
  });

  test("equals takes precedence when both present", () => {
    expect(parseInputs(["url=https://x.com:8080/path"])).toEqual({
      url: "https://x.com:8080/path",
    });
  });

  test("number coercion", () => {
    expect(parseInputs(["steps=20", "scale=1.5", "neg=-3"])).toEqual({
      steps: 20,
      scale: 1.5,
      neg: -3,
    });
  });

  test("boolean and null", () => {
    expect(parseInputs(["enabled=true", "off=false", "x=null"])).toEqual({
      enabled: true,
      off: false,
      x: null,
    });
  });

  test("JSON literals", () => {
    expect(parseInputs(['arr=["a","b"]', 'obj={"k":1}'])).toEqual({
      arr: ["a", "b"],
      obj: { k: 1 },
    });
  });

  test("dotted path → nested object", () => {
    expect(parseInputs(["nested.a=1", "nested.b=2"])).toEqual({
      nested: { a: 1, b: 2 },
    });
  });

  test("dotted path overwrites scalar with object", () => {
    expect(parseInputs(["x.a=1"])).toEqual({ x: { a: 1 } });
  });

  test("multiple inputs combine", () => {
    expect(parseInputs(["prompt=cat", "steps=20", "enabled=true"])).toEqual({
      prompt: "cat",
      steps: 20,
      enabled: true,
    });
  });

  test("@file with .json reads as JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "na-input-test-"));
    const file = join(dir, "body.json");
    writeFileSync(file, JSON.stringify({ a: 1, b: "two" }));

    expect(parseInputs([`config=@${file}`])).toEqual({
      config: { a: 1, b: "two" },
    });
  });

  test("@file with binary extension reads as data URL", () => {
    const dir = mkdtempSync(join(tmpdir(), "na-input-test-"));
    const file = join(dir, "tiny.png");
    writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const out = parseInputs([`image=@${file}`]) as { image: string };
    expect(out.image).toMatch(PNG_DATA_URL_RE);
  });

  test("invalid format throws", () => {
    expect(() => parseInputs(["nokey"])).toThrow(INVALID_INPUT_RE);
    expect(() => parseInputs(["=novalue"])).toThrow(INVALID_INPUT_RE);
  });
});
