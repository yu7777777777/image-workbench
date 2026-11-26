import { expect, test } from "bun:test";
import { tokenizeCode } from "../src/lib/chat-code-highlight";

test("tokenizeCode preserves exact source text and classifies common tokens", () => {
  const python = [
    "# 统计函数",
    "def calc(items):",
    '    label = "total"',
    "    return len(items) + 42",
  ].join("\n");
  const tokens = tokenizeCode(python, "python");
  expect(tokens.map((t) => t.text).join("")).toBe(python);
  expect(tokens.some((t) => t.kind === "comment" && t.text.includes("统计函数"))).toBe(true);
  expect(tokens.some((t) => t.kind === "keyword" && t.text === "def")).toBe(true);
  expect(tokens.some((t) => t.kind === "function" && t.text === "calc")).toBe(true);
  expect(tokens.some((t) => t.kind === "string" && t.text === '"total"')).toBe(true);
  expect(tokens.some((t) => t.kind === "number" && t.text === "42")).toBe(true);

  const html = '<div class="card"><span>OK</span></div>';
  const htmlTokens = tokenizeCode(html, "html");
  expect(htmlTokens.map((t) => t.text).join("")).toBe(html);
  expect(htmlTokens.some((t) => t.kind === "tag" && t.text === "<div")).toBe(true);
  expect(htmlTokens.some((t) => t.kind === "attr" && t.text === "class")).toBe(true);
});
