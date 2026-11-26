import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { splitChatReply } from "../src/lib/chat-rich-reply";
import { chatWidgetInlineImages, readChatWidget, widgetValue, type WidgetNode } from "../src/lib/chat-widget";
import { ChatWidgetView, resolveIcon } from "../src/app/chat/chat-widget-view";
import examples from "./fixtures/chat-widget-expansion.json";

test("renders a radio group with an unmatched initial option and requires a visible choice", async () => {
  const text = await Bun.file(new URL("./fixtures/chat-widget-radio-default.txt", import.meta.url)).text();
  const [block] = splitChatReply(text);
  if (block?.kind !== "widget" || block.widget.root.kind !== "layout") throw new Error("缺少刷资源表单");
  const groups = block.widget.root.children.filter((node) => node.kind === "radio");
  const initials = block.widget.initial;
  expect(groups.map(({ name, options, required }) => ({
    name, count: options.length, selected: options.find(({ value }) => value === initials.get(name))?.value, required,
  }))).toEqual([
    { name: "gear", count: 4, selected: "橙色装备为主", required: false },
    { name: "drop", count: 5, selected: undefined, required: true },
    { name: "weapon", count: 5, selected: "高能镭射步枪", required: false },
    { name: "fund", count: 4, selected: "100M以下", required: false },
  ]);
  expect(block.widget.root.children.some((node) => node.kind === "unsupported")).toBe(false);
  const button = block.widget.root.children.at(-1);
  if (button?.kind !== "button" || !("submit" in button.action)) throw new Error("缺少提交动作");
  expect(widgetValue(button.action.submit, new Map(initials).set("drop", "150%~200%"))).toBe(
    "装备品质：橙色装备为主；爆率：150%~200%；主武器：高能镭射步枪；现金：100M以下。请为我制定刷资源路线。",
  );
});

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

test("renders screenshot examples through the normal rich-reply parser", async () => {
  const fixture = (await Bun.file(new URL("./fixtures/chat-widget-compatibility.txt", import.meta.url)).text()).replaceAll("\r\n", "\n");
  const widgets = splitChatReply(fixture).flatMap((block) => block.kind === "widget" ? [block.widget] : []);
  expect(widgets).toHaveLength(5);
  const [buttons, selection, input, overlays, media] = widgets;
  expect(selection.root).toMatchObject({ children: [
    { kind: "checkbox", index: 0 }, { kind: "checkbox", index: 1 }, { kind: "checkbox", index: 2 },
    { kind: "checkbox", item: "UI" }, { kind: "checkbox", item: "UX" }, { kind: "layout" }, { kind: "radio", numeric: true }, { kind: "layout" },
  ] });
  expect(buttons.initial.get("loading")).toBe(false);
  expect(input.initial.get("mode")).toBe("普通");
  expect(overlays.root).toMatchObject({ children: [
    { kind: "popover" }, { kind: "carousel" }, { kind: "layout" },
    { kind: "form", action: { set: { name: "submitted", value: true } } }, { kind: "condition" },
  ] });
  expect(media.root).toMatchObject({ children: [
    { kind: "table", children: Array.from({ length: 4 }, () => ({ kind: "table-row" })) },
    { kind: "math", latex: String.raw`\int_0^1 x^2\,dx=\frac{1}{3}` },
    { kind: "code", language: "javascript", source: 'const greeting = "你好";\nconsole.log(greeting);' },
    { kind: "image", ref: "demo-image" }, { kind: "image", group: true }, { kind: "image", label: "缺图示例" }, { kind: "layout", variant: "callout" },
  ] });
});

test("keeps a code block's template syntax as literal source inside a widget", () => {
  const source = '  {#if show}<box>说明</box>{/if}';
  const markup = '<box>{#if true}<CodeBlock language="text">\n' + source + '\n</CodeBlock>{/if}</box>';
  const widget = readChatWidget(markup)?.widget;
  expect(widget?.root).toMatchObject({ children: [{ kind: "condition", children: [{ kind: "code", source }] }] });
});

test("expands directives only outside input attributes and interpolated text", () => {
  const widget = readChatWidget([
    '{@body const [value,setValue]=DIL.useState("")}',
    '<box><input placeholder="示例 {#if active} 文字" value={value} onChange={setValue}/>',
    '<text>{"{#if active}"}</text>{#if true}<text>实际条件内容</text>{/if}</box>',
  ].join("\n"))?.widget;
  expect(widget?.root).toMatchObject({ children: [
    { kind: "input", placeholder: "示例 {#if active} 文字" },
    { kind: "layout", children: [{ parts: ["", { value: "{#if active}" }, ""] }] },
    { kind: "condition", test: true, children: [{ kind: "layout", children: [{ parts: ["实际条件内容"] }] }] },
  ] });
});

test("keeps valid table rows when a row loop cannot be resolved", () => {
  const root = readChatWidget('<table><table-row><table-cell>名称</table-cell></table-row>'
    + '{#each missingRows as row}<table-row><table-cell>{row}</table-cell></table-row>{/each}'
    + '<table-row><table-cell>项目 A</table-cell></table-row></table>')?.widget?.root;
  expect(root).toMatchObject({
    kind: "table",
    children: [
      { kind: "table-row", children: [{ children: [{ parts: ["名称"] }] }] },
      { kind: "table-row", children: [{ children: [{ parts: ["项目 A"] }] }] },
    ],
    unsupportedRepeats: [{ kind: "unsupported" }],
  });
});

test("compiles screenshot table, list, and menu variants with only the unknown component folded", async () => {
  const fixture = await Bun.file(new URL("./fixtures/chat-widget-tables-and-menus.txt", import.meta.url)).text();
  const blocks = splitChatReply(fixture);
  expect(blocks.filter((block) => block.kind === "unsupported")).toHaveLength(0);
  const widgets = blocks.flatMap((block) => block.kind === "widget" ? [block.widget.root] : []);
  expect(widgets).toHaveLength(15);
  expect(widgets[0]).toMatchObject({ kind: "table", children: Array.from({ length: 3 }, () => ({ kind: "table-row" })) });
  expect(widgets[2]).toMatchObject({ kind: "popover", label: "打开浮层布局" });
  function unsupportedNodes(node: WidgetNode): WidgetNode[] {
    if (node.kind === "unsupported") return [node];
    const children = "children" in node ? node.children : [];
    return [...children, ...(node.kind === "condition" ? node.fallback : [])].flatMap(unsupportedNodes);
  }
  expect(widgets.flatMap(unsupportedNodes)).toMatchObject([{ kind: "unsupported", tag: "UnknownWidget" }]);
});

test("does not invent options when a loop is missing the iterable or references an undeclared collection", () => {
  for (const repeat of [
    '<each><text>{item.name}</text></each>',
    '{#each unknownOptions as item}<text>{item.name}</text>{/each}',
  ]) {
    const widget = readChatWidget('<box><text>可读内容</text>' + repeat + '<text>后续内容</text></box>')?.widget;
    expect(widget?.root).toMatchObject({ kind: "layout", children: [
      { kind: "layout", variant: "text" },
      { kind: "unsupported" },
      { kind: "layout", variant: "text" },
    ] });
  }
});

test("bounds nested loop expansion while retaining the surrounding content", () => {
  const values = JSON.stringify(Array.from({ length: 16 }, (_, index) => `项目 ${index + 1}`));
  const loops = [`{#each ${values} as group}`, `{#each ${values} as section}`, `{#each ${values} as item}`].join("");
  const markup = "<box><text>循环前</text>" + loops + "<text>{item}</text>{/each}{/each}{/each}<text>循环后</text></box>";
  const root = readChatWidget(markup)?.widget?.root;
  if (root?.kind !== "layout") throw new Error("缺少布局");
  expect(root.children[0]).toMatchObject({ kind: "layout", children: [{ parts: ["循环前"] }] });
  expect(root.children.at(-1)).toMatchObject({ kind: "layout", children: [{ parts: ["循环后"] }] });
  expect(root.children.filter((node) => node.kind === "unsupported").length).toBeGreaterThan(0);
  expect(root.children.length).toBeLessThan(16 ** 3);
});

test("keeps disallowed record fields and array mutations inert within supported layout", () => {
  const markup = '{@body const [rows,setRows]=DIL.useState(["项目"])}'
    + '<box><text>上文</text>{#each [{name:"可读字段"}] as item}'
    + '<text>{item.name} {item.constructor}</text><button onClick={()=>setRows(old=>old.reverse())}>无效操作</button>'
    + '{/each}<text>下文</text></box>';
  const widget = readChatWidget(markup)?.widget;
  const root = widget?.root;
  if (!widget || root?.kind !== "layout" || root.children[1]?.kind !== "layout" || root.children[1].children[0]?.kind !== "markdown") throw new Error("缺少文本");
  const text = root.children[1].children[0].parts.map((part) => typeof part === "string" ? part : widgetValue(part.value, widget.initial)).join("");
  expect(text).toBe("可读字段 {item.constructor}");
  expect(root.children[2]).toMatchObject({ kind: "unsupported", tag: "button" });
  expect(root.children.at(-1)).toMatchObject({ kind: "layout", children: [{ parts: ["下文"] }] });
});

test("supports top-level {#if}/{:else if} blocks sharing {@body} state, box progress width/color, filter(Boolean).length, queries attr and GenUI.openUrl", () => {
  const showcase = [
    '{@body const [tab, setTab] = DIL.useState("layout")}',
    '{@body const [progress, setProgress] = DIL.useState(65)}',
    '{@body const [checks, setChecks] = DIL.useState([true, false, true])}',
    '<card><button onClick={() => setTab("forms")}>表单</button></card>',
    '{#if tab === "layout"}',
    '  <box background="surface-tertiary" radius="full">',
    '    <box width={`${progress}%`} background="#16A34A" radius="full"><text>进度</text></box>',
    '  </box>',
    '  <text>已选择 {checks.filter(Boolean).length} 项</text>',
    '  <AsyncImageGroup queries={["地图", "装备"]} layout="bento"/>',
    '{:else if tab === "forms"}',
    '  <button block onClick={() => GenUI.openUrl("sandbox:/mnt/data/demo.csv")}>下载 CSV</button>',
    '{:else}',
    '  <text>其他</text>',
    '{/if}',
  ].join("\n");
  const blocks = splitChatReply(showcase);
  expect(blocks).toHaveLength(1);
  expect(blocks[0].kind).toBe("widget");
  if (blocks[0].kind !== "widget" || blocks[0].widget.root.kind !== "layout") throw new Error("缺少组合组件");
  const [, condition] = blocks[0].widget.root.children;
  if (condition.kind !== "condition") throw new Error("缺少条件分支");
  expect(widgetValue(condition.test, blocks[0].widget.initial)).toBe(true);
  expect(condition.children[0]).toMatchObject({
    kind: "layout",
    children: [{ options: { background: "#16A34A" } }],
  });
  const widthExpr = (condition.children[0] as Extract<WidgetNode, { kind: "layout" }>).children[0];
  if (widthExpr.kind !== "layout" || widthExpr.options?.width === undefined) throw new Error("缺少 width");
  expect(widgetValue(widthExpr.options.width, blocks[0].widget.initial)).toBe("65%");
  const countNode = condition.children[1];
  if (countNode.kind !== "layout" || countNode.children[0]?.kind !== "markdown") throw new Error("缺少统计文本");
  const countText = countNode.children[0].parts.map((part) => typeof part === "string" ? part : widgetValue(part.value, blocks[0].widget.initial)).join("");
  expect(countText).toBe("已选择 2 项");
  expect(condition.children[2]).toMatchObject({ kind: "image", group: true, queries: ["地图", "装备"] });
  expect(condition.fallback[0]).toMatchObject({
    kind: "condition",
    children: [{ kind: "button", action: { openUrl: "sandbox:/mnt/data/demo.csv" } }],
  });

  const cleanCard = readChatWidget('<box><text>RTX 5080 · {turn0prod0.rating}/5（{turn0prod0.reviews} 条评价）</text></box>')?.widget;
  if (!cleanCard || cleanCard.root.kind !== "layout" || cleanCard.root.children[0]?.kind !== "layout" || cleanCard.root.children[0].children[0]?.kind !== "markdown") throw new Error("缺少清洗文本");
  expect(cleanCard.root.children[0].children[0].parts).toEqual(["RTX 5080"]);
});

test("normalizes lucide icon prefixes, aliases, and extended UI icon names", () => {
  expect(resolveIcon("lucide:CalendarDays")).toBeDefined();
  expect(resolveIcon("lucide-react:more-horizontal")).toBe(resolveIcon("ellipsis"));
  expect(resolveIcon("icon:plus-circle")).toBe(resolveIcon("circle-plus"));
  expect(resolveIcon("more-vertical")).toBe(resolveIcon("ellipsis-vertical"));
  expect(resolveIcon("lucide:list-todo")).toBeDefined();
  expect(resolveIcon("lucide:graduation-cap")).toBeDefined();
  expect(resolveIcon("bell")).toBeDefined();
  expect(resolveIcon("settings")).toBeDefined();
  expect(resolveIcon("home")).toBeDefined();
  expect(resolveIcon("user")).toBeDefined();
  expect(resolveIcon("folder")).toBeDefined();
});

test("parses layout fidelity options, typography props, divider props, and merged borderless stacks", () => {
  const widget = readChatWidget([
    '<box direction="row" border={{ size: 1 }} radius="3xl" padding={{ x: 2, y: 1 }} background="surface-elevated">',
    '  <title size="h2" weight="bold" align="center" value="周计划" />',
    '  <text size="sm" weight="medium" align="end" color="emphasis" value="共 7 天" />',
    '  <caption size="xs" align="start" value="底部备注" />',
    '  <badge color="discovery" variant="outline" label="Beta" />',
    '  <badge color="info">默认柔和</badge>',
    '  <row wrap="nowrap">',
    '    <box flex={1} border="subtle" padding="sm"><text value="周一" /></box>',
    '    <box flex={1} border="none" radius="none" background="transparent"><text value="周二" /></box>',
    '  </row>',
    '  <grid columns={7}>',
    '    <box radius="sm" background="alpha-05"><text value="1" /></box>',
    '  </grid>',
    '  <divider spacing="sm" flush orientation="horizontal" />',
    '  <icon name="lucide:CalendarDays" size={20} color="primary" />',
    '</box>',
  ].join("\n"))?.widget;
  if (!widget || widget.root.kind !== "layout") throw new Error("缺少布局组件");
  expect(widget.root.options).toMatchObject({
    direction: "row",
    border: true,
    radius: "3xl",
    padding: { left: 8, right: 8, top: 4, bottom: 4 },
    background: "surface-elevated",
  });
  const [title, textNode, caption, badgeOutline, badgeDefault, row, grid, divider, icon] = widget.root.children;
  expect(title).toMatchObject({
    variant: "title",
    options: { size: "h2", weight: "bold", align: "center" },
    children: [{ kind: "markdown", parts: ["周计划"] }],
  });
  expect(textNode).toMatchObject({
    variant: "text",
    options: { size: "sm", weight: "medium", align: "end", color: "emphasis" },
    children: [{ kind: "markdown", parts: ["共 7 天"] }],
  });
  expect(caption).toMatchObject({
    variant: "caption",
    options: { size: "xs", align: "start" },
    children: [{ kind: "markdown", parts: ["底部备注"] }],
  });
  expect(badgeOutline).toMatchObject({
    variant: "badge",
    options: { color: "discovery", variant: "outline" },
    children: [{ kind: "markdown", parts: ["Beta"] }],
  });
  expect(badgeDefault).toMatchObject({
    variant: "badge",
    options: { color: "info", variant: "soft" },
  });
  expect(row).toMatchObject({
    variant: "row",
    options: { wrap: "nowrap" },
    children: [
      { variant: "box", options: { flex: 1, border: true, padding: 8 } },
      { variant: "box", options: { flex: 1, border: false, radius: "none", background: "transparent" } },
    ],
  });
  expect(grid).toMatchObject({ variant: "grid", options: { columns: 7 } });
  expect(divider).toMatchObject({ kind: "divider", spacing: "sm", flush: true, orientation: "horizontal" });
  expect(icon).toMatchObject({ kind: "icon", name: "lucide:CalendarDays", size: "20", color: "primary" });

  const html = renderToStaticMarkup(createElement(ChatWidgetView, {
    widget,
    streaming: false,
    canSend: true,
    onSend: () => {},
    resolveImages: () => [],
  }));
  expect(html).toContain('data-direction="row"');
  expect(html).toContain('data-background="true"');
  expect(html).toContain('data-surface="true"');
  expect(html).toContain('data-weight="bold"');
  expect(html).toContain('text-align:center');
  expect(html).toContain('data-color="discovery"');
  expect(html).toContain('data-variant="outline"');
  expect(html).toContain('data-wrap="nowrap"');
  expect(html).toContain('data-has-flex="true"');
  expect(html).toContain('flex:1 1 0px');
  expect(html).not.toContain('12rem');
  expect(html).toContain('data-border="false"');
  expect(html).toContain('class="chat-widget-divider"');
  expect(html).toContain('data-spacing="sm"');
  expect(html).toContain('data-flush="true"');

  const mergedWidget = readChatWidget([
    '{@body const [tab, setTab] = DIL.useState("a")}',
    '<card><text value="顶部卡片" /></card>',
    '{#if tab === "a"}<card><text value="分支 A" /></card>{/if}',
  ].join("\n"))?.widget;
  expect(mergedWidget?.root).toMatchObject({ kind: "layout", variant: "col", options: { gap: 12 } });
});

test("classifies lightweight text follow-up pressables as link variant while keeping cards as block pressables", () => {
  const widget = readChatWidget([
    '<box>',
    '  <pressable prompt="继续拆解第一步"><text value="继续拆解第一步" /></pressable>',
    '  <list>',
    '    <list-item><pressable prompt="查看细节"><row><text value="查看细节" /><icon name="arrow-right" /></row></pressable></list-item>',
    '  </list>',
    '  <pressable border padding={2} prompt="打开卡片"><text value="带边框卡片" /></pressable>',
    '</box>',
  ].join("\n"))?.widget;
  if (!widget || widget.root.kind !== "layout") throw new Error("缺少 pressable 布局");
  const [linkPressable, list, cardPressable] = widget.root.children;
  expect(linkPressable).toMatchObject({ kind: "pressable", variant: "link", action: { submit: "继续拆解第一步" } });
  expect(list).toMatchObject({
    kind: "list",
    children: [{ kind: "list-item", children: [{ kind: "pressable", variant: "link", action: { submit: "查看细节" } }] }],
  });
  expect(cardPressable).toMatchObject({ kind: "pressable", action: { submit: "打开卡片" } });
  if (cardPressable.kind === "pressable") expect(cardPressable.variant).toBeUndefined();

  const html = renderToStaticMarkup(createElement(ChatWidgetView, {
    widget,
    streaming: false,
    canSend: true,
    onSend: () => {},
    resolveImages: () => [],
  }));
  expect(html).toContain('<button type="button" class="chat-widget-pressable" data-variant="link"');
  expect(html).toContain('<div class="chat-widget-pressable" data-border="true"');
});
