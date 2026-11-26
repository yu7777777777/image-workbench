import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { splitChatReply } from "../src/lib/chat-rich-reply";
import { chatWidgetInlineImages, readChatWidget, widgetValue, type WidgetNode } from "../src/lib/chat-widget";
import { ChatWidgetView, isLightHexColor, resolveIcon } from "../src/app/chat/chat-widget-view";
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

test("supports inline text decoration tags, Entity and direct Link inside widgets without unsupported fallbacks", () => {
  const markup = [
    "<box>",
    '  <text>支持 <underline>下划线</underline>、<strikethrough>删除线</strikethrough>、<b>粗体</b>、<strong>强调</strong>、<i>斜体</i>、<em>强调斜体</em>、<u>短下划线</u>、<s>短删除线</s>、<code>code()</code> 与 <span>行内文本</span></text>',
    '  <text>官方：<Entity value="京都市官方旅游指南" category="organization"/> / <Entity category="place">清水寺</Entity></text>',
    '  <Link url="https://kyoto.travel/en/" title="Kyoto Travel 官方网站"/>',
    "</box>",
  ].join("\n");
  const widget = readChatWidget(markup)?.widget;
  if (!widget || widget.root.kind !== "layout") throw new Error("缺少内联格式组件");
  function hasUnsupported(node: WidgetNode): boolean {
    if (node.kind === "unsupported") return true;
    return "children" in node && node.children.some(hasUnsupported);
  }
  expect(hasUnsupported(widget.root)).toBe(false);

  const html = renderToStaticMarkup(createElement(ChatWidgetView, {
    widget,
    streaming: false,
    canSend: true,
    onSend: () => {},
    resolveImages: () => [],
  }));
  expect(html).toContain('<u class="chat-widget-underline">下划线</u>');
  expect(html).toContain('<s class="chat-widget-strikethrough">删除线</s>');
  expect(html).toContain("<strong>粗体</strong>");
  expect(html).toContain("<em>斜体</em>");
  expect(html).toContain("<code>code()</code>");
  expect(html).toContain("<span>行内文本</span>");
  expect(html).toContain("京都市官方旅游指南");
  expect(html).toContain("清水寺");
  expect(html).toContain('href="https://kyoto.travel/en/"');
  expect(html).toContain("Kyoto Travel 官方网站");
  expect(html).not.toContain("此组件暂无法显示");
});

test("supports switch checkbox shape, checkbox lineThrough, localized slider aria-label, and GenUI.copy action", () => {
  const markup = [
    '{@body const [toggle, setToggle] = DIL.useState(true)}',
    '{@body const [done, setDone] = DIL.useState(false)}',
    '{@body const [range, setRange] = DIL.useState(40)}',
    '<box>',
    '  <checkbox checked={toggle} onChange={setToggle} shape="switch"/>',
    '  <checkbox checked={done} onChange={setDone} lineThrough={true}>已完成任务</checkbox>',
    '  <slider value={range} onChange={setRange} min={0} max={100}/>',
    '  <button onClick={() => GenUI.copy(`当前进度：${range}%`)}>复制结果</button>',
    '</box>',
  ].join("\n");
  const widget = readChatWidget(markup)?.widget;
  if (!widget || widget.root.kind !== "layout") throw new Error("缺少控件组件");
  const [sw, cb, slider, copyBtn] = widget.root.children;
  expect(sw).toMatchObject({ kind: "checkbox", name: "toggle", shape: "switch", switch: true, compact: true });
  expect(cb).toMatchObject({ kind: "checkbox", name: "done", lineThrough: true, label: "已完成任务" });
  expect(slider).toMatchObject({ kind: "slider", name: "range", min: 0, max: 100 });
  if (copyBtn.kind !== "button" || !("copy" in copyBtn.action)) throw new Error("缺少 copy 动作");
  expect(widgetValue(copyBtn.action.copy, widget.initial)).toBe("当前进度：40%");

  const html = renderToStaticMarkup(createElement(ChatWidgetView, {
    widget,
    streaming: false,
    canSend: true,
    onSend: () => {},
    resolveImages: () => [],
  }));
  expect(html).toContain('data-shape="switch"');
  expect(html).toContain('role="switch"');
  expect(html).toContain('data-line-through="true"');
  expect(html).toContain('aria-label="调整滑块"');
  expect(html).not.toContain("调整 RANGE");
});

test("evaluates allowlisted pure method calls and Math/Number/String globals safely in widget expressions", () => {
  const markup = [
    '{@body const [title, setTitle] = DIL.useState("  kyoto trip  ")}',
    '{@body const [tags, setTags] = DIL.useState(["京都", "奈良", "大阪"])}',
    '<box>',
    '  {#each [{ name: "预算", v: 12000, b: 15000, rate: 3.14159 }] as item}',
    '    <text>¥{item.v.toLocaleString()} / ¥{item.b.toLocaleString()} ({item.rate.toFixed(2)}%)</text>',
    '  {/each}',
    '  <text>{title.trim().toUpperCase()} | {title.trim().toLowerCase()} | {title.trim().slice(0, 5)}</text>',
    '  <text>{title.includes("kyoto") ? "yes" : "no"} | {title.trim().startsWith("ky") ? "s" : "n"} | {title.trim().endsWith("trip") ? "e" : "n"}</text>',
    '  <text>{tags.slice(0, 2).join("、")} ({tags.length})</text>',
    '  <text>{Math.round(12.6)} / {Math.floor(12.9)} / {Math.ceil(12.1)} / {Math.abs(-7)} / {Math.min(9, 3, 5)} / {Math.max(9, 3, 5)} / {Number("42") + 8} / {String(99)}</text>',
    '</box>',
  ].join("\n");
  const widget = readChatWidget(markup)?.widget;
  if (!widget || widget.root.kind !== "layout") throw new Error("缺少表达式测试组件");
  const renderText = (node: WidgetNode) => {
    if (node.kind !== "layout" || node.children[0]?.kind !== "markdown") throw new Error("缺少文本节点");
    return node.children[0].parts.map((part) => typeof part === "string" ? part : String(widgetValue(part.value, widget.initial))).join("");
  };
  const [budget, strings, checks, arr, math] = widget.root.children;
  expect(renderText(budget)).toBe(`¥${(12000).toLocaleString()} / ¥${(15000).toLocaleString()} (3.14%)`);
  expect(renderText(strings)).toBe("KYOTO TRIP | kyoto trip | kyoto");
  expect(renderText(checks)).toBe("yes | s | e");
  expect(renderText(arr)).toBe("京都、奈良 (3)");
  expect(renderText(math)).toBe("13 / 12 / 13 / 7 / 3 / 9 / 50 / 99");
});

test("coerces finite numeric strings in scatter and bar charts without failing", () => {
  const scatter = '<Chart content={{"chartType":"scatter","meta":{"title":"广告投入与转化关系"},"xKey":"investment","series":[{"dataKey":"conversion","label":"转化率","valueSuffix":"%"}],"data":[{"investment":"10","conversion":2},{"investment":"25.5","conversion":"4.8"}]}}/>';
  const widget = readChatWidget(scatter)?.widget;
  expect(widget?.root).toMatchObject({
    kind: "chart",
    chartType: "scatter",
    label: "广告投入与转化关系",
    series: ["转化率"],
    rows: [
      { name: "10", x: 10, values: [2] },
      { name: "25.5", x: 25.5, values: [4.8] },
    ],
  });
  const html = renderToStaticMarkup(createElement(ChatWidgetView, {
    widget: widget!,
    streaming: false,
    canSend: true,
    onSend: () => {},
    resolveImages: () => [],
  }));
  expect(html).toContain("广告投入与转化关系");
  expect(html).toContain("chat-widget-chart");
});

test("compiles complex tabs/popover lookup blocks and multi-state toggle-helper questionnaires cleanly", () => {
  const tabsBlock = [
    '{@body const [segment, setSegment] = DIL.useState("overview")}',
    '{@body const tabContent = { overview: "整体指标稳步增长", detail: "分渠道转化率明细", "中文键": "支持中文键" }}',
    '<box>',
    '  <segmented-control block value={segment} onChange={setSegment} options={[{ value: "overview", label: "概览" }, { value: "detail", label: "明细" }]} />',
    '  <divider color="subtle"/>',
    '  <text>{tabContent[segment]}</text>',
    '  <popover>',
    '    <popover-trigger block><button>查看计算口径</button></popover-trigger>',
    '    <popover-content><text>统计口径包含全部有效订单。</text></popover-content>',
    '  </popover>',
    '</box>',
  ].join("\n");
  const tabsWidget = readChatWidget(tabsBlock)?.widget;
  if (!tabsWidget || tabsWidget.root.kind !== "layout") throw new Error("缺少 Tabs/Popover 组件");
  const [seg, div, tabText, pop] = tabsWidget.root.children;
  expect(seg).toMatchObject({ kind: "radio", segmented: true, block: true });
  expect(div).toMatchObject({ kind: "divider", color: "subtle" });
  expect(pop).toMatchObject({ kind: "popover", label: "查看计算口径", block: true });
  if (tabText.kind !== "layout" || tabText.children[0]?.kind !== "markdown") throw new Error("缺少动态查表文本");
  const evalTab = (key: string) => tabText.children[0].kind === "markdown"
    ? tabText.children[0].parts.map((part) => typeof part === "string" ? part : String(widgetValue(part.value, new Map(tabsWidget.initial).set("segment", key)))).join("")
    : "";
  expect(evalTab("overview")).toBe("整体指标稳步增长");
  expect(evalTab("detail")).toBe("分渠道转化率明细");

  const tabsHtml = renderToStaticMarkup(createElement(ChatWidgetView, {
    widget: tabsWidget,
    streaming: false,
    canSend: true,
    onSend: () => {},
    resolveImages: () => [],
  }));
  expect(tabsHtml).toContain('data-block="true"');
  expect(tabsHtml).toContain('data-color="subtle"');

  const questionnaire = [
    '{@body const [days, setDays] = DIL.useState("3天")}',
    '{@body const [pace, setPace] = DIL.useState("舒适")}',
    '{@body const [spots, setSpots] = DIL.useState(["清水寺", "伏见稻荷大社"])}',
    '{@body const [foods, setFoods] = DIL.useState(["抹茶甜品"])}',
    '{@body const [budget, setBudget] = DIL.useState("中等")}',
    '{@body const [notes, setNotes] = DIL.useState("")}',
    '{@body const toggle = (arr, setArr, v) => setArr(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v])}',
    '{@body const toggleFood = (v) => setFoods(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])}',
    '<box>',
    '  <title>京都行程偏好问卷</title>',
    '  <segmented-control block value={days} onChange={setDays} options={["2天", "3天", "4天"]} />',
    '  <segmented-control block value={pace} onChange={setPace} options={["紧凑", "舒适", "慢游"]} />',
    '  <box>',
    '    {#each ["清水寺", "伏见稻荷大社", "岚山", "金阁寺"] as v}',
    '      <checkbox checked={spots.includes(v)} onChange={() => toggle(spots, setSpots, v)} lineThrough={false}>{v}</checkbox>',
    '    {/each}',
    '  </box>',
    '  <box>',
    '    {#each ["怀石料理", "抹茶甜品", "拉面"] as v}',
    '      <checkbox checked={foods.includes(v)} onChange={() => toggleFood(v)} lineThrough={false}>{v}</checkbox>',
    '    {/each}',
    '  </box>',
    '  <segmented-control block value={budget} onChange={setBudget} options={["经济", "中等", "奢华"]} />',
    '  <textarea value={notes} onChange={setNotes} placeholder="其他需求..."/>',
    '  <button block onClick={() => GenUI.issueNewTurn(`天数：${days}；景点：${spots.join("、")}；美食：${foods.join("、")}；预算：${budget}；备注：${notes}`)}>生成专属行程</button>',
    '</box>',
  ].join("\n");
  const qBlocks = splitChatReply(questionnaire);
  expect(qBlocks).toHaveLength(1);
  expect(qBlocks[0].kind).toBe("widget");
  if (qBlocks[0].kind !== "widget" || qBlocks[0].widget.root.kind !== "layout") throw new Error("缺少京都问卷");
  function findUnsupported(node: WidgetNode): WidgetNode[] {
    if (node.kind === "unsupported") return [node];
    return "children" in node ? node.children.flatMap(findUnsupported) : [];
  }
  expect(findUnsupported(qBlocks[0].widget.root)).toEqual([]);
  const submitBtn = qBlocks[0].widget.root.children.at(-1);
  if (submitBtn?.kind !== "button" || !("submit" in submitBtn.action)) throw new Error("缺少提交按钮");
  expect(widgetValue(submitBtn.action.submit, qBlocks[0].widget.initial)).toBe(
    "天数：3天；景点：清水寺、伏见稻荷大社；美食：抹茶甜品；预算：中等；备注：",
  );
});

test("emits data-theme and data-surface-tone=light for bright hex surfaces and resolves all live icons", () => {
  expect(isLightHexColor("#fff")).toBe(true);
  expect(isLightHexColor("#FFFFFF")).toBe(true);
  expect(isLightHexColor("#F3F5F8")).toBe(true);
  expect(isLightHexColor("#1E293B")).toBe(false);
  expect(isLightHexColor("#2563EB")).toBe(false);
  expect(isLightHexColor("surface-secondary")).toBe(false);

  const widget = readChatWidget([
    '<box theme="light" background="#F3F5F8">',
    '  <card background="#FFFFFF"><text value="浅色卡片"/></card>',
    '  <card background="#1E293B"><text value="深色卡片"/></card>',
    '</box>',
  ].join("\n"))?.widget;
  if (!widget || widget.root.kind !== "layout") throw new Error("缺少主题卡片");
  expect(widget.root.options?.theme).toBe("light");

  const html = renderToStaticMarkup(createElement(ChatWidgetView, {
    widget,
    streaming: false,
    canSend: true,
    onSend: () => {},
    resolveImages: () => [],
  }));
  expect(html).toContain('data-theme="light"');
  expect(html).toContain('data-surface-tone="light"');

  const requiredIcons = [
    "type", "form-input", "chart-no-axes-combined", "panels-top-left", "workflow", "landmark",
    "trending-down", "piggy-bank", "briefcase-business", "wallet", "receipt", "bar-chart",
    "pie-chart", "map", "compass", "ticket", "train", "utensils", "camera", "building",
    "building-2", "shopping-bag", "shopping-cart", "car", "bus", "bed", "coffee", "sparkles",
    "layers", "sliders-horizontal", "toggle-right", "check-square", "circle-dot", "list",
    "table", "code-2", "git-branch",
  ];
  for (const name of requiredIcons) {
    expect(resolveIcon(name)).toBeDefined();
  }
});

test("evaluates string.split()[index] inside calendar strips and keeps slim progress bar tracks unpadded", () => {
  const widget = readChatWidget([
    '{@body const days = ["Mon 23", "Tue 24", "Thu 26"]}',
    "<box>",
    '  <row gap={1}>',
    '    {#each days as day}',
    '      <box flex={1}><text>{day.split(" ")[0]}</text><text weight="bold">{day.split(" ")[1]}</text></box>',
    '    {/each}',
    '  </row>',
    '  <box height={8} radius="full" background="surface-secondary"><box width="60%" height="100%" radius="full" background="#16A34A" /></box>',
    "</box>",
  ].join("\n"))?.widget;
  if (!widget) throw new Error("缺少日历条与进度条");

  const html = renderToStaticMarkup(createElement(ChatWidgetView, {
    widget,
    streaming: false,
    canSend: true,
    onSend: () => {},
    resolveImages: () => [],
  }));
  expect(html).toContain(">Mon<");
  expect(html).toContain(">23<");
  expect(html).toContain(">Thu<");
  expect(html).toContain(">26<");
  expect(html).not.toContain("day.split");
  expect(html).toContain("height:8px");
  expect(html).toContain("padding-top:0");
});
