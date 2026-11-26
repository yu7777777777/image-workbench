import { expect, test } from "bun:test";
import { splitChatReply } from "../src/lib/chat-rich-reply";
import { chatWidgetResourceRefs, readChatWidget, widgetValue } from "../src/lib/chat-widget";
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

test("exposes in-message resource refs while preserving fallback for hidden content", () => {
  const widget = readChatWidget('<card><AsyncImage ref="img0"/><Cite refs={["c0", "c1"]}/><Link url={prod0.product_page.uri}/><popover><AsyncImage ref="hidden"/></popover></card>')?.widget;
  if (!widget) throw new Error("缺少资源卡");
  expect(chatWidgetResourceRefs(widget)).toEqual([
    { type: "image", ref: "img0" }, { type: "source", ref: "c0" },
    { type: "source", ref: "c1" }, { type: "product", ref: "prod0" },
  ]);
});
