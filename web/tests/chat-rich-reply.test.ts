import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { prepareReplyMarkdown, readReplyResources, splitChatReply } from "../src/lib/chat-rich-reply";
import { readChatResources } from "../src/lib/chat-resources";
import { widgetValue } from "../src/lib/chat-widget";
import { ReplyMarkdown } from "../src/app/chat/chat-markdown";
import observed from "./fixtures/chat-observed-replies.json";
import extended from "./fixtures/chat-extended-replies.json";

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

test("keeps an unsupported follow-up as source while rendering the surrounding controls", () => {
  const raw = answer.replace('+kind+', '+window.location.href+').replace('<divider color="subtle"/>', '<box>额外布局</box>');
  const blocks = splitChatReply(raw);
  expect(blocks[3]).toMatchObject({ kind: "widget", widget: { root: { children: [
    { kind: "radio" },
    { kind: "layout", children: [{ parts: ["额外布局"] }] },
    { kind: "radio" },
    { kind: "unsupported", source: expect.stringContaining("window.location.href") },
  ] } } });
  expect(blocks[4]).toMatchObject({ kind: "markdown", text: expect.stringContaining("也可以直接输入") });
});

test("accepts the observed nested form and chart with range controls and reset", () => {
  const form = splitChatReply(observed.writing_and_native_form).find((block) => block.kind === "widget" && block.widget.form);
  expect(form?.widget.root).toMatchObject({ kind: "layout", variant: "box" });
  const chart = splitChatReply(observed.visual_and_search).find((block) => block.kind === "widget");
  if (chart?.widget.root.kind !== "layout") throw new Error("缺少图表布局");
  const children = chart.widget.root.children;
  expect(children.filter((child) => child.kind === "slider").map(({ name }) => name)).toEqual(["a", "b", "c"]);
  const rows = children.find((child) => child.kind === "chart")?.rows;
  expect(rows?.map(({ values }) => widgetValue(values[0], chart.widget.initial))).toEqual([1, 2, 3]);
  expect(children.find((child) => child.kind === "button")?.action).toEqual({ reset: ["a", "b", "c"] });
});

test("uses explicit adjacent source links, leaving ambiguous and fenced references unresolved", () => {
  const resources = readReplyResources(extended.citations);
  expect(resources.sources.size).toBe(2);
  expect(resources.citations.get("samplesearch0")).toBe("https://www.iana.org/help/example-domains");
  expect(prepareReplyMarkdown(extended.citations, resources.citations)).toContain("[来源](<https://www.iana.org/help/example-domains>)");
  const invalid = '[a](https://a.example) <Cite refs={["x"]}/>\n[b](https://b.example) <Cite refs={["x"]}/>\n\n```\n[c](https://c.example) <Cite refs={["y"]}/>\n```';
  expect(readReplyResources(invalid).citations.size).toBe(0);
  expect(readReplyResources(invalid).sources.size).toBe(2);
  expect([...readReplyResources(extended.attachments).filenames]).toEqual([["csv", "example.csv"], ["txt", "example.txt"]]);
});

test("binds normalized attachments and authoritative sources without guessing from text", () => {
  const text = '[旧链接](https://example.com/other) <Cite refs={["turn0search0", "turn0search1"]}/>\n\n'
    + '[下载原件](sandbox:/mnt/data/order%20summary.txt)\n\n'
    + '```md\n[示例](sandbox:/mnt/data/example.txt)\n```';
  const incoming = readChatResources([
    { id: "src-1", type: "source", ref: "turn0search0", title: "原始来源", url: "https://example.com/actual" },
    { id: "src-2", type: "source", ref: "alias", title: "原始来源", url: "https://example.com/actual" },
    { id: "file-1", type: "attachment", title: "order summary.txt", path: "sandbox:/mnt/data/order summary.txt" },
  ]);
  const reference = readReplyResources(text, incoming);
  expect(reference.citations.get("turn0search0")).toBe("https://example.com/actual");
  expect(reference.sourceDetails.size).toBe(1);
  expect([...reference.attachmentPaths]).toEqual(["sandbox:/mnt/data/order%20summary.txt"]);
  expect(reference.attachments.get("sandbox:/mnt/data/order%20summary.txt")?.id).toBe("file-1");
  const markup = prepareReplyMarkdown(text, reference.citations, reference.inlineSources);
  expect(markup).toContain("[来源](<workbench-cite:turn0search0>)〔来源链接未返回〕");
  expect(markup).toContain("[示例](sandbox:/mnt/data/example.txt)");
  expect(readChatResources(incoming)).toEqual(incoming);
});

test("compiles observed panels without executing their expressions", () => {
  const controls = splitChatReply(extended.controls).find((block) => block.kind === "widget");
  if (controls?.widget.root.kind !== "layout") throw new Error("缺少表单");
  const action = controls.widget.root.children.find((child) => child.kind === "button")?.action;
  if (!action || !("submit" in action)) throw new Error("缺少动作");
  expect(widgetValue(action.submit, new Map<string, string | boolean>([["museum", true], ["park", false], ["season", "秋季"]]))).toContain("博物馆\n偏好的季节：秋季");
  const charts = splitChatReply(extended.charts).filter((block) => block.kind === "widget");
  expect(charts.map(({ widget: { root } }) => root.kind)).toEqual(["chart", "chart", "layout"]);
  expect(charts[0].widget.root).toMatchObject({ chartType: "line", series: ["甲", "乙"] });
  expect(charts[1].widget.root).toMatchObject({ chartType: "pie" });
  expect(splitChatReply(extended.tools).some((block) => block.kind === "unsupported")).toBe(false);
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
  expect(prepareReplyMarkdown('<LearningViz type_id="INTEGRAL"> \\int_0^4 x^2\\,dx </LearningViz>')).toBe('$\\int_0^4 x^2\\,dx$');
});

test("groups multi-ref and adjacent Cite tags into a single grouped citation pill and wraps Markdown tables", () => {
  const incoming = readChatResources([
    { id: "s1", type: "source", ref: "r1", title: "IANA Example Domains", url: "https://www.iana.org/help/example-domains" },
    { id: "s2", type: "source", ref: "r2", title: "RFC 2606", url: "https://www.rfc-editor.org/info/rfc2606/" },
    { id: "s3", type: "source", ref: "r3", title: "MDN Docs", url: "https://developer.mozilla.org/en-US/" },
  ]);
  const multiText = '结论来自官方文档。<Cite refs={["r1", "r2"]} />';
  const multiRef = readReplyResources(multiText, incoming);
  const multiMd = prepareReplyMarkdown(multiText, multiRef.citations, multiRef.inlineSources);
  expect(multiMd).toBe("结论来自官方文档。[来源](<workbench-cite:r1,r2>)");
  expect(multiMd).not.toContain("来源 1");

  const adjacentText = '多个紧邻引用。<Cite refs={["r1"]}/> <Cite refs={["r2", "r3"]}/>';
  const adjacentRef = readReplyResources(adjacentText, incoming);
  const adjacentMd = prepareReplyMarkdown(adjacentText, adjacentRef.citations, adjacentRef.inlineSources);
  expect(adjacentMd).toBe("多个紧邻引用。[来源](<workbench-cite:r1,r2,r3>)");

  const groupedHtml = renderToStaticMarkup(createElement(ReplyMarkdown, {
    text: multiText + "\n\n| 列 A | 列 B |\n|---|---|\n| 1 | 2 |",
    citations: multiRef.citations,
    inlineSources: multiRef.inlineSources,
  }));
  expect(groupedHtml).toContain('class="chat-resource-cite-group"');
  expect(groupedHtml).toContain('class="chat-resource-cite-label">iana.org</span>');
  expect(groupedHtml).toContain('class="chat-resource-cite-more">+1</span>');
  expect(groupedHtml).toContain('<div class="chat-table-wrap"><table>');

  const singleText = '单条引用。<Cite refs={["r1"]} />';
  const singleRef = readReplyResources(singleText, incoming);
  const singleHtml = renderToStaticMarkup(createElement(ReplyMarkdown, {
    text: singleText,
    citations: singleRef.citations,
    inlineSources: singleRef.inlineSources,
  }));
  expect(singleHtml).not.toContain('class="chat-resource-cite-group"');
  expect(singleHtml).toContain('<a class="chat-resource-cite"');
  expect(singleHtml).toContain('class="chat-resource-cite-label">iana.org</span>');
  expect(singleHtml).not.toContain("lucide-external-link");
});

test("converts raw Entity and direct http(s) Link XML tags in Markdown while preserving Link ref citations and fenced code", () => {
  const incoming = readChatResources([
    { id: "s1", type: "source", ref: "turn0search0", title: "官方来源", url: "https://example.org/doc" },
  ]);
  const sample = [
    '推荐参考 <Entity value="京都市官方旅游指南" category="organization"/> 和 <Entity category="place">清水寺</Entity>。',
    '直达官网：<Link url="https://kyoto.travel/en/" title="Kyoto Travel 官方网站"/>，以及 <Link href="https://example.com/map" label="交通图"/>。',
    '无标题链接：<Link url="https://kyoto.travel/en/"/>；不安全链接：<Link url="javascript:alert(1)" title="忽略脚本"/>。',
    '保留引用：<Link ref="turn0search0" title="引用文档"/> 与 <Link ref="missing0" title="缺失引用"/>。',
    '```xml\n<Entity value="代码块内原样保留"/>\n<Link url="https://kyoto.travel/en/" title="原文"/>\n```',
  ].join("\n\n");
  const ref = readReplyResources(sample, incoming);
  const md = prepareReplyMarkdown(sample, ref.citations, ref.inlineSources);

  expect(md).toContain("京都市官方旅游指南");
  expect(md).toContain("清水寺");
  expect(md).toContain("[Kyoto Travel 官方网站](<https://kyoto.travel/en/>)");
  expect(md).toContain("[交通图](<https://example.com/map>)");
  expect(md).toContain("[kyoto.travel](<https://kyoto.travel/en/>)");
  expect(md).toContain("忽略脚本");
  expect(md).not.toContain("javascript:alert");
  expect(md).toContain("[引用文档](<workbench-cite:turn0search0>)");
  expect(md).toContain("缺失引用（来源链接未返回）");
  // Raw tags outside code fences must never leak.
  const beforeFence = md.slice(0, md.indexOf("```xml"));
  expect(beforeFence).not.toContain("<Entity");
  expect(beforeFence).not.toContain("<Link");
  // Inside code fences they stay verbatim.
  expect(md).toContain('<Entity value="代码块内原样保留"/>');
  expect(md).toContain('<Link url="https://kyoto.travel/en/" title="原文"/>');
});

test("splits MapWidgetV2 blocks cleanly into interactive map widgets", () => {
  const reply = [
    "以下是京都 3 日景点地图：",
    '<MapWidgetV2 id="kyoto-three-day-map" title="京都 3 日必游地点地图" points={[{"title":"清水寺","lat":34.9949,"lng":135.785,"address":"京都市东山区清水1-294","description":"世界文化遗产木造舞台","group":"day1"},{"title":"伏见稻荷大社","latitude":"34.9671","longitude":"135.7727","subtitle":"千本鸟居","category":"day1"},{"name":"岚山竹林","address":"京都市右京区嵯峨天龙寺","group":"day2"}]} groups={[{"id":"day1","title":"第 1 天"},{"id":"day2","title":"第 2 天"}]} show_route={false} carousel={{"visibility":"hidden"}}/>',
    "祝旅途愉快！",
  ].join("\n\n");
  const blocks = splitChatReply(reply);
  expect(blocks.map((block) => block.kind)).toEqual(["markdown", "widget", "markdown"]);
  const mapBlock = blocks[1];
  if (mapBlock.kind !== "widget") throw new Error("缺少地图组件");
  expect(mapBlock.widget.root).toMatchObject({
    kind: "map",
    label: "京都 3 日必游地点地图",
    markers: [
      { label: "第 1 天 · 清水寺", lat: 34.9949, lon: 135.785, description: "世界文化遗产木造舞台", group: "第 1 天" },
      { label: "第 1 天 · 伏见稻荷大社", lat: 34.9671, lon: 135.7727, description: "千本鸟居", group: "第 1 天" },
      { label: "第 2 天 · 岚山竹林", address: "京都市右京区嵯峨天龙寺", group: "第 2 天" },
    ],
  });
});
