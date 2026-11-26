import { expect, test } from "bun:test";
import { splitChatReply } from "../src/lib/chat-rich-reply";
import { chatWidgetInlineImages, readChatWidget, widgetValue } from "../src/lib/chat-widget";
import examples from "./fixtures/chat-widget-expansion.json";

test("compiles declared form state, validation constraints and safe follow-ups", () => {
  const widget = readChatWidget(examples.form)?.widget;
  if (widget?.root.kind !== "form" || widget.root.submit === undefined) throw new Error("缺少表单");
  expect(widget.explicitForm).toBe(true);
  const [fields, notes, period, condition, submit] = widget.root.children;
  expect(fields).toMatchObject({ variant: "grid", options: { gap: 12, columns: 2 }, children: [
    { inputType: "text", label: "课程名称", required: true, maxLength: 24 },
    { inputType: "date", label: "学习日期", required: true, min: "2026-01-01", max: "2026-12-31" },
  ] });
  expect(notes).toMatchObject({ kind: "input", inputType: "textarea" });
  expect(period).toMatchObject({ kind: "radio", segmented: true });
  expect(submit).toMatchObject({ kind: "button", action: { submitForm: true } });
  if (condition.kind !== "condition") throw new Error("缺少条件");
  expect(widgetValue(condition.test, widget.initial)).toBe(false);
  const selected = new Map(widget.initial).set("course", "微积分").set("notes", "练习两题").set("date", "2026-11-30").set("scope", "周");
  expect(widgetValue(condition.test, selected)).toBe(true);
  expect(widgetValue(widget.root.submit, selected)).toBe("学习 微积分，备注 练习两题，日期 2026-11-30，周期 周");
});

test("supports scatter axes and a chart filter bound to segmented state", () => {
  const block = splitChatReply(examples.dashboard)[0];
  if (block.kind !== "widget" || block.widget.root.kind !== "layout") throw new Error("缺少看板");
  const chart = block.widget.root.children.find((node) => node.kind === "chart");
  if (!chart || chart.filter === undefined) throw new Error("缺少散点图或筛选");
  expect(chart).toMatchObject({
    chartType: "scatter", series: ["订单", "退货"],
    rows: [{ name: "甲", x: 1, values: [4, 1] }, { name: "乙", x: 8, values: [9, 2] }, { name: "丙", x: 6, values: [3, 1] }],
  });
  const filter = widgetValue(chart.filter, new Map(block.widget.initial).set("period", "上周"));
  expect(chart.rows.filter((row) => row.filter === filter).map((row) => row.name)).toEqual(["丙"]);
});

test("compiles media and links only from declared, bounded inputs", () => {
  const widget = readChatWidget(examples.media)?.widget;
  if (widget?.root.kind !== "layout") throw new Error("缺少媒体布局");
  const [carousel, map, video, followUp] = widget.root.children;
  expect(carousel).toMatchObject({ kind: "carousel", label: "参观要点" });
  expect(map).toMatchObject({ kind: "map", markers: [{ lat: 31.23, lon: 121.47 }, { lat: 39.9, lon: 116.4 }] });
  expect(video).toMatchObject({ kind: "video", src: expect.stringMatching(/flower\.mp4$/) });
  expect(followUp).toMatchObject({ kind: "button", action: { submit: "继续介绍参观要点" } });
  expect(readChatWidget('<Map lat="91" lon="120"/>')?.widget).toBeUndefined();
  expect(readChatWidget('<AsyncVideo src="https://127.0.0.1/video.mp4"/>')?.widget?.root).toMatchObject({ kind: "video", src: undefined });
  expect(readChatWidget('<AsyncVideo src="https://host.example/document.html"/>')?.widget?.root).toMatchObject({ kind: "video", src: undefined });
  expect(readChatWidget('<form onSubmit={() => fetch("https://host.example")}></form>')?.widget).toBeUndefined();
  expect(readChatWidget(examples.form.replace("onChange={setCourse}", "onChange={otherSetter}"))?.widget).toBeUndefined();
});

test("reserves inline images only in immediately visible components", () => {
  const widget = readChatWidget('<card><AsyncImage ref="img0"/><Cite refs={["c0", "c1"]}/><Link url={prod0.product_page.uri}/><popover><AsyncImage ref="hidden"/></popover></card>')?.widget;
  if (!widget) throw new Error("缺少资源卡");
  expect(chatWidgetInlineImages(widget)).toMatchObject([{ kind: "image", ref: "img0" }]);
});

test("renders route layouts with bare align and inline image queries plus a numbered itinerary", () => {
  const reply = `<box gap={3}>
  <row align=start gap={3}>
    <AsyncImage query="监控室 游戏地图" aspectRatio="1:1" maxWidth="112px"/>
    <box flex="1" gap={1}>
      **路线 A**
      <badge color="success">潜能优先</badge>
      - 阅读地图
    </box>
  </row>
  <list connector="solid" marker="number" gap={3}>
    <list-item>**第一轮**</list-item>
    <list-item>**第二轮**</list-item>
  </list>
  <caption>每天按资源需求安排。</caption>
</box>`;
  const block = splitChatReply(reply)[0];
  if (block.kind !== "widget") throw new Error("路线组件解析失败");
  expect(block.widget.root).toMatchObject({ children: [
    { variant: "row", options: { align: "start" }, children: [
      { kind: "image", queries: ["监控室 游戏地图"], aspectRatio: "1 / 1", maxWidth: 112 },
      { variant: "box", options: { flex: 1 } },
    ] },
    { kind: "list", ordered: true, connected: true, children: [{ kind: "list-item" }, { kind: "list-item" }] },
    { variant: "caption" },
  ] });
});

test("recognizes standalone bento image groups without parsing query expressions as code", () => {
  const markup = '<AsyncImageGroup query={["地图", "背包", "战斗"]} aspectRatio="5:4" layout="bento"/>';
  const blocks = splitChatReply(`上文\n\n${markup}\n\n下文`);
  expect(blocks.map((block) => block.kind)).toEqual(["markdown", "widget", "markdown"]);
  expect(blocks[1]).toMatchObject({ widget: { root: { kind: "image", group: true, bento: true, queries: ["地图", "背包", "战斗"], aspectRatio: "5 / 4" } } });
  expect(splitChatReply(markup.slice(0, -2), true)).toEqual([{ kind: "pending", offset: 0 }]);
  expect(readChatWidget('<AsyncImageGroup query={[window.location.href]}/>')?.widget?.root).toMatchObject({ kind: "image", queries: undefined });
});

test("compiles the component playground without falling back to whole sections of source", async () => {
  const fixture = await Bun.file(new URL("./fixtures/chat-component-playground.txt", import.meta.url)).text();
  const blocks = splitChatReply(fixture);
  expect(blocks.some((block) => block.kind === "unsupported")).toBe(false);
  expect(blocks.filter((block) => block.kind === "widget")).toHaveLength(14);
  const controls = blocks.find((block) => block.kind === "widget" && block.widget.initial.has("clicks"));
  if (controls?.kind !== "widget" || controls.widget.root.kind !== "layout") throw new Error("缺少基础控件");
  expect(controls.widget.initial.get("checks")).toEqual(["通知"]);
  expect(controls.widget.root.children.filter((node) => node.kind === "checkbox")).toMatchObject([
    { name: "checks", item: "通知" }, { name: "checks", item: "邮件" }, { name: "checks", item: "短信" },
  ]);
  const svg = readChatWidget('<svg viewBox="0 0 10 10"><circle r="2" fill="url(https://example.org/x)" onclick="alert(1)"/></svg>')?.widget?.root;
  expect(svg).toMatchObject({ kind: "svg", shapes: [{ attrs: { r: "2" } }] });
  if (svg?.kind !== "svg") throw new Error("缺少矢量图");
  expect(Object.keys(svg.shapes[0].attrs)).toEqual(["r"]);
  expect(readChatWidget('<svg viewBox="0 0 10 10"><foreignObject/></svg>')?.widget?.root.kind).toBe("unsupported");
});
