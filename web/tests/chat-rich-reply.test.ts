import { expect, test } from "bun:test";
import { prepareReplyMarkdown, splitChatReply } from "../src/lib/chat-rich-reply";
import { widgetValue } from "../src/lib/chat-widget";
import observed from "./fixtures/chat-observed-replies.json";

const answer = (await Bun.file(new URL("fixtures/chat-rich-reply.txt", import.meta.url)).text()).replace(/\r\n/g, "\n");

test("renders the writing block, radio groups and surrounding Markdown from an existing reply", () => {
  const blocks = splitChatReply(answer);
  expect(blocks.map(({ kind }) => kind)).toEqual(["markdown", "writing", "markdown", "widget", "markdown"]);
  expect(blocks[1]).toMatchObject({ kind: "writing", text: expect.stringContaining("**【角色】**") });
  expect(blocks[4]).toMatchObject({ kind: "markdown", text: expect.stringContaining("<WritingBlock>代码示例</WritingBlock>") });

  const form = blocks[3];
  if (form.kind !== "widget") throw new Error("缺少表单");
  expect(form.widget.form).toBe(true);
  const root = form.widget.root;
  if (root.kind !== "layout") throw new Error("缺少表单布局");
  const groups = root.children.filter((child) => child.kind === "radio");
  expect(groups.map((group) => [group.label, form.widget.initial.get(group.name), group.options.length])).toEqual([
    ["你主要想用提示词做什么？", "通用型 AI 提示词", 7],
    ["你目前的水平？", "从零开始学习", 3],
  ]);
  const button = root.children.find((child) => child.kind === "button");
  if (!button || !("submit" in button.action)) throw new Error("缺少提交动作");
  expect(widgetValue(button.action.submit, form.widget.initial)).toBe("我想学习：通用型 AI 提示词；我的水平：从零开始学习。请系统教我写高质量提示词，并提供实战案例和可复制模板。");
});

test("shows streamed writing without exposing split tags and waits for the full form", () => {
  const heading = "## 模板\n\n";
  expect(splitChatReply(heading + "<Writ", true)).toEqual([{ kind: "markdown", offset: 0, text: heading }]);
  expect(splitChatReply(heading + "<WritingBlock id=", true).at(-1)?.kind).toBe("pending");
  expect(splitChatReply(heading + "<WritingBlock>模板正文</Writ", true).at(-1)).toMatchObject({ kind: "writing", text: "模板正文" });
  const partial = answer.slice(0, answer.lastIndexOf("</box>"));
  expect(splitChatReply(partial, true).at(-1)?.kind).toBe("pending");
  expect(splitChatReply(partial).at(-1)?.kind).toBe("unsupported");
});

test("preserves plain Markdown and component examples in code", () => {
  const markdown = '## 示例\n\n~~~jsx\n<WritingBlock>模板</WritingBlock>\n{@body const x = 1}\n~~~\n\n    <WritingBlock>缩进示例</WritingBlock>';
  expect(splitChatReply(markdown)).toEqual([{ kind: "markdown", offset: 0, text: markdown }]);
  const writing = '正文 `</WritingBlock>`\n\n```xml\n</WritingBlock>\n```\n\n剩余正文';
  expect(splitChatReply(`<WritingBlock>\n${writing}\n</WritingBlock>`)).toEqual([{ kind: "writing", offset: 0, text: writing }]);
});

test("keeps unsupported forms as source and accepts only the supported follow-up expression", () => {
  const raw = answer.replace('+kind+', '+window.location.href+').replace('<divider color="subtle"/>', '<box>额外布局</box>');
  const blocks = splitChatReply(raw);
  expect(blocks[3]).toMatchObject({ kind: "unsupported", text: expect.stringContaining("<box>额外布局</box>") });
  expect(blocks[4]).toMatchObject({ kind: "markdown", text: expect.stringContaining("也可以直接输入") });
  const invalidAction = answer.replace('+kind+', '+window.location.href+');
  expect(splitChatReply(invalidAction)[3]).toMatchObject({ kind: "unsupported", text: expect.stringContaining("window.location.href") });
});

test("accepts the observed nested form and chart with range controls and reset", () => {
  const form = splitChatReply(observed.writing_and_native_form).find((block) => block.kind === "widget" && block.widget.form);
  expect(form?.widget.root).toMatchObject({ kind: "layout", variant: "box" });
  const chart = splitChatReply(observed.visual_and_search).find((block) => block.kind === "widget");
  if (chart?.widget.root.kind !== "layout") throw new Error("缺少图表布局");
  const children = chart.widget.root.children;
  expect(children.filter((child) => child.kind === "slider").map(({ name }) => name)).toEqual(["a", "b", "c"]);
  const bars = children.find((child) => child.kind === "chart")?.bars;
  expect(bars?.map(({ value }) => widgetValue(value, chart.widget.initial))).toEqual([1, 2, 3]);
  expect(children.find((child) => child.kind === "button")?.action).toEqual({ reset: ["a", "b", "c"] });
});

test("normalizes observed formula delimiters and gives unavailable references a text fallback", () => {
  const math = prepareReplyMarkdown(observed.markdown_math_code);
  expect(math).toContain("$E = mc^2$");
  expect(math).toContain("$$\n\\int_0^1");
  expect(prepareReplyMarkdown('`\\(x\\)`\n\n```xml\n<Cite refs={["test"]}/>\n```')).toBe('`\\(x\\)`\n\n```xml\n<Cite refs={["test"]}/>\n```');
  const references = prepareReplyMarkdown(observed.visual_and_search);
  expect(references).toContain("来源链接未返回");
  expect(references).toContain("https://www.iana.org/help/example-domains");
  expect(references).not.toContain("sampleSearch");
});
