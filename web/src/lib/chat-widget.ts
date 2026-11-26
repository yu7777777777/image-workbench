import { parseExpressionAt, type Expression, type ObjectExpression } from "acorn";

type Scalar = string | number | boolean;
type Value = Scalar | { variable: string } | { add: [Value, Value] } | { choose: [Value, Value, Value] } | { fallback: [Value, Value] } | { join: Value[]; separator: string };
type Attribute = string | true | { expression: string };
type Element = { tag: string; attributes: Map<string, Attribute>; children: (Element | string)[]; inner: string; end: number };
type State = { setter: string; initial: Scalar; derived?: Value };
type Option = { value: string; label: string };
type Action = { submit: Value } | { reset: string[] } | { adjust: { name: string; change: number; bound: number } };
type AstNode = Expression | { type: "PrivateIdentifier"; name: string } | { type: "SpreadElement"; argument: Expression };

export type WidgetNode =
  | { kind: "layout"; variant: "box" | "row" | "title" | "text" | "badge"; children: WidgetNode[] }
  | { kind: "markdown"; parts: (string | { value: Value })[] }
  | { kind: "icon"; name: string }
  | { kind: "divider" }
  | { kind: "radio"; name: string; label: string; options: Option[] }
  | { kind: "checkbox"; name: string; label: string }
  | { kind: "select"; name: string; label: string; options: Option[] }
  | { kind: "slider"; name: string; min: number; max: number; step: number }
  | { kind: "chart"; chartType: "bar" | "line" | "pie"; rows: { name: string; values: Value[] }[]; series: string[]; label: string; description?: string; min: number }
  | { kind: "condition"; value: Value; threshold: number; children: WidgetNode[]; fallback: WidgetNode[] }
  | { kind: "link"; label: string; href?: string }
  | { kind: "button"; children: WidgetNode[]; action: Action; label?: string };

export type ChatWidget = { root: WidgetNode; initial: Map<string, Scalar>; form: boolean };

export function widgetValue(value: Value, state: ReadonlyMap<string, Scalar>): Scalar {
  if (typeof value !== "object") return value;
  if ("variable" in value) return state.get(value.variable) ?? "";
  if ("choose" in value) return widgetValue(widgetValue(value.choose[0], state) ? value.choose[1] : value.choose[2], state);
  if ("fallback" in value) return widgetValue(value.fallback[0], state) || widgetValue(value.fallback[1], state);
  if ("join" in value) return value.join.map((item) => widgetValue(item, state)).filter(Boolean).join(value.separator);
  const left = widgetValue(value.add[0], state);
  const right = widgetValue(value.add[1], state);
  return typeof left === "number" && typeof right === "number" ? left + right : String(left) + String(right);
}

function readBraces(source: string, from: number): number | undefined {
  let depth = 0;
  let quote = "";
  for (let index = from; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (char === "\\") index++;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return index + 1;
  }
  return undefined;
}

function readElement(source: string, from: number, depth = 0): Element | undefined {
  if (depth > 16) return undefined;
  const opening = /<([A-Za-z][\w-]*)(?=[\s/>])/y;
  opening.lastIndex = from;
  const match = opening.exec(source);
  if (!match) return undefined;
  const tag = match[1];
  const attributes = new Map<string, Attribute>();
  const children: Element["children"] = [];
  const attr = /\s*([\w-]+)(?:\s*=\s*|(?=[\s/>]))/y;
  const endTag = /\s*(\/?)\s*>/y;
  let cursor = opening.lastIndex;
  while (cursor < source.length) {
    endTag.lastIndex = cursor;
    const end = endTag.exec(source);
    if (end) {
      cursor = endTag.lastIndex;
      if (end[1]) return { tag, attributes, children, inner: "", end: cursor };
      break;
    }
    attr.lastIndex = cursor;
    const item = attr.exec(source);
    if (!item || attributes.has(item[1])) return undefined;
    cursor = attr.lastIndex;
    const name = item[1];
    if (!item[0].includes("=")) {
      attributes.set(name, true);
    } else if (source[cursor] === "{") {
      const end = readBraces(source, cursor);
      if (end === undefined) return undefined;
      attributes.set(name, { expression: source.slice(cursor + 1, end - 1) });
      cursor = end;
    } else {
      const literal = /"([^"\r\n]*)"|'([^'\r\n]*)'/y;
      literal.lastIndex = cursor;
      const value = literal.exec(source);
      if (!value) return undefined;
      attributes.set(name, value[1] ?? value[2]);
      cursor = literal.lastIndex;
    }
  }

  const start = cursor;
  const nextTag = /<(\/?)([A-Za-z][\w-]*)(?=[\s/>])/g;
  const closing = new RegExp(`</${tag}\\s*>`, "y");
  nextTag.lastIndex = cursor;
  for (let next = nextTag.exec(source); next; next = nextTag.exec(source)) {
    if (next.index > cursor) children.push(source.slice(cursor, next.index));
    if (next[1]) {
      closing.lastIndex = next.index;
      if (!closing.test(source)) return undefined;
      return { tag, attributes, children, inner: source.slice(start, next.index), end: closing.lastIndex };
    }
    const child = readElement(source, next.index, depth + 1);
    if (!child) return undefined;
    children.push(child);
    cursor = nextTag.lastIndex = child.end;
  }
  return undefined;
}

function parseExpression(source: string | undefined): Expression | undefined {
  if (!source || source.length > 16384) return undefined;
  try {
    const node = parseExpressionAt(source, 0, { ecmaVersion: 2020 }) as Expression;
    return source.slice(node.end).trim() === "" ? node : undefined;
  } catch {
    return undefined;
  }
}

function valueExpression(node: AstNode | null | undefined, states: Map<string, State>, depth = 0): Value | undefined {
  if (!node || depth > 32) return undefined;
  if (node.type === "PrivateIdentifier" || node.type === "SpreadElement") return undefined;
  if (node.type === "Literal") {
    if (node.value === null) return "";
    return typeof node.value === "string" || typeof node.value === "boolean" || (typeof node.value === "number" && Number.isFinite(node.value)) ? node.value : undefined;
  }
  if (node.type === "Identifier" && states.has(node.name)) return states.get(node.name)?.derived ?? { variable: node.name };
  if (node.type === "ConditionalExpression") {
    const test = valueExpression(node.test, states, depth + 1);
    const yes = valueExpression(node.consequent, states, depth + 1);
    const no = valueExpression(node.alternate, states, depth + 1);
    return test === undefined || yes === undefined || no === undefined ? undefined : { choose: [test, yes, no] };
  }
  if (node.type === "LogicalExpression" && node.operator === "||") {
    const first = valueExpression(node.left, states, depth + 1);
    const next = valueExpression(node.right, states, depth + 1);
    return first === undefined || next === undefined ? undefined : { fallback: [first, next] };
  }
  if (node.type === "CallExpression" && !node.optional && node.callee.type === "MemberExpression" && !node.callee.computed && !node.callee.optional && node.callee.property.type === "Identifier" && node.callee.property.name === "join") {
    const filter = node.callee.object;
    const separator = node.arguments.length === 1 && valueExpression(node.arguments[0], new Map());
    if (typeof separator !== "string" || filter.type !== "CallExpression" || filter.optional || filter.callee.type !== "MemberExpression" || filter.callee.computed || filter.callee.optional || filter.callee.property.type !== "Identifier" || filter.callee.property.name !== "filter" || filter.callee.object.type !== "ArrayExpression" || filter.arguments.length !== 1 || filter.arguments[0].type !== "Identifier" || filter.arguments[0].name !== "Boolean") return undefined;
    const items = filter.callee.object.elements.map((item) => valueExpression(item, states, depth + 1));
    return items.every((item): item is Value => item !== undefined) ? { join: items, separator } : undefined;
  }
  if (node.type === "UnaryExpression" && node.operator === "-" && node.argument.type === "Literal" && typeof node.argument.value === "number" && Number.isFinite(node.argument.value)) {
    return -node.argument.value;
  }
  if (node.type !== "BinaryExpression" || node.operator !== "+") return undefined;
  const left = valueExpression(node.left, states, depth + 1);
  const right = valueExpression(node.right, states, depth + 1);
  return left === undefined || right === undefined ? undefined : { add: [left, right] };
}

function attrText(element: Element, name: string): string | undefined {
  const value = element.attributes.get(name);
  return typeof value === "string" ? value : undefined;
}

function attrExpression(element: Element, name: string): string | undefined {
  const value = element.attributes.get(name);
  return typeof value === "object" ? value.expression : undefined;
}

function attrNumber(element: Element, name: string): number | undefined {
  const value = valueExpression(parseExpression(attrExpression(element, name) ?? attrText(element, name)), new Map());
  return typeof value === "number" ? value : undefined;
}

function stateBinding(element: Element, states: Map<string, State>, attribute = "value"): string | undefined {
  const name = attrExpression(element, attribute)?.trim();
  const setter = attrExpression(element, "onChange")?.trim();
  return name && setter && states.get(name)?.setter === setter ? name : undefined;
}

function parseOptions(element: Element): Option[] | undefined {
  const loop = /^\{#each\s+(\[[\s\S]*?\])\s+as\s+(\w+)\s*\}\s*<radio\s+value=\{\s*\2\s*\}\s*>\s*\{\s*\2\s*\}\s*<\/radio>\s*\{\/each\}$/.exec(element.inner.trim());
  if (loop) {
    const list = parseExpression(loop[1]);
    if (list?.type !== "ArrayExpression") return undefined;
    const values = list.elements.map((item) => valueExpression(item, new Map()));
    if (values.every((value): value is string => typeof value === "string" && Boolean(value.trim()))) {
      return values.map((value) => ({ value, label: value }));
    }
    return undefined;
  }

  const options: Option[] = [];
  for (const child of element.children) {
    if (typeof child === "string" && !child.trim()) continue;
    if (typeof child === "string" || child.tag !== "radio" || child.children.some((part) => typeof part !== "string")) return undefined;
    const value = attrText(child, "value");
    const label = child.inner.trim();
    if (!value || !label) return undefined;
    options.push({ value, label });
  }
  return options;
}

function parseAction(source: string | undefined, states: Map<string, State>): Action | undefined {
  // Model text describes one of two actions. Its functions are never executed.
  const action = parseExpression(source);
  if (action?.type !== "ArrowFunctionExpression" || action.async || action.params.length) return undefined;
  const body = action.body;
  if (body.type === "CallExpression" && !body.optional && body.arguments.length === 1) {
    const target = body.callee;
    if (target.type === "Identifier") {
      const state = [...states].find(([, value]) => value.setter === target.name);
      const match = /^Math\.(min|max)\(\s*(-?\d+)\s*,\s*([\w$]+)\s*([+-])\s*(\d+)\s*\)$/.exec((attrSource(body.arguments[0], source) ?? "").trim());
      if (!state || typeof state[1].initial !== "number" || !match || match[3] !== state[0] || (match[1] === "min") !== (match[4] === "+")) return undefined;
      return { adjust: { name: state[0], change: Number(match[5]) * (match[4] === "+" ? 1 : -1), bound: Number(match[2]) } };
    }
    if (target.type !== "MemberExpression" || target.optional || target.computed || target.object.type !== "Identifier" || target.object.name !== "GenUI" || target.property.type !== "Identifier" || target.property.name !== "issueNewTurn") {
      return undefined;
    }
    const submit = valueExpression(body.arguments[0], states);
    return submit === undefined ? undefined : { submit };
  }
  if (body.type !== "BlockStatement" || !body.body.length) return undefined;
  const reset: string[] = [];
  for (const statement of body.body) {
    if (statement.type !== "ExpressionStatement" || statement.expression.type !== "CallExpression") return undefined;
    const call = statement.expression;
    if (call.optional || call.callee.type !== "Identifier" || call.arguments.length !== 1) return undefined;
    const setter = call.callee.name;
    const state = [...states.entries()].find(([, entry]) => entry.setter === setter);
    if (!state || valueExpression(call.arguments[0], new Map()) !== state[1].initial) return undefined;
    reset.push(state[0]);
  }
  return { reset };
}

function attrSource(node: { start: number; end: number }, source: string | undefined): string | undefined {
  return source?.slice(node.start, node.end);
}

function property(object: ObjectExpression, name: string) {
  for (const member of object.properties) {
    if (member.type !== "Property" || member.computed || member.kind !== "init" || member.method) continue;
    const key = member.key.type === "Identifier" ? member.key.name : member.key.type === "Literal" ? member.key.value : undefined;
    if (key === name) return member.value;
  }
  return undefined;
}

function compileChart(element: Element, states: Map<string, State>): WidgetNode | undefined {
  const config = parseExpression(attrExpression(element, "content"));
  if (config?.type !== "ObjectExpression") return undefined;
  const chartType = valueExpression(property(config, "chartType"), states);
  if (chartType !== "bar" && chartType !== "line" && chartType !== "pie") return undefined;
  const xKey = valueExpression(property(config, chartType === "pie" ? "nameKey" : "xKey"), states);
  const data = property(config, "data");
  const series = property(config, "series");
  if (typeof xKey !== "string" || data?.type !== "ArrayExpression" || !data.elements.length || data.elements.length > 40) return undefined;
  const keys: { key: string; label: string }[] = [];
  if (series?.type === "ArrayExpression" && series.elements.length <= 8) {
    for (const definition of series.elements) {
      if (definition?.type !== "ObjectExpression") return undefined;
      const key = valueExpression(property(definition, "dataKey"), states);
      const label = valueExpression(property(definition, "label"), states);
      if (typeof key !== "string") return undefined;
      keys.push({ key, label: typeof label === "string" ? label : key });
    }
  }
  if (!keys.length && chartType === "pie") {
    const key = valueExpression(property(config, "valueKey"), states);
    if (typeof key === "string") keys.push({ key, label: "数量" });
  }
  if (!keys.length || (chartType === "pie" && keys.length !== 1)) return undefined;
  const meta = property(config, "meta");
  const description = meta?.type === "ObjectExpression" ? valueExpression(property(meta, "description"), states) : undefined;
  const title = meta?.type === "ObjectExpression" ? valueExpression(property(meta, "title"), states) : undefined;
  const min = valueExpression(property(config, "yAxisMin"), states);
  const initial = new Map([...states].map(([name, state]) => [name, state.initial]));
  const rows = [];
  for (const row of data.elements) {
    if (row?.type !== "ObjectExpression") return undefined;
    const name = valueExpression(property(row, xKey), states);
    const values = keys.map(({ key }) => valueExpression(property(row, key), states));
    if (typeof name !== "string" || !values.every((value): value is Value => value !== undefined && Number.isFinite(widgetValue(value, initial)))) return undefined;
    rows.push({ name, values });
  }
  const label = typeof title === "string" ? title : keys[0].label;
  return { kind: "chart", chartType, rows, series: keys.map((key) => key.label), label, description: typeof description === "string" ? description : undefined, min: typeof min === "number" ? min : 0 };
}

function compileText(source: string, states: Map<string, State>): WidgetNode {
  const text = source.trim().replace(/^[ \t]+/gm, "").replace(/\{(?:turn\d+|sample)[\w-]*(?:\.\w+)+\}/g, "");
  const parts: (string | { value: Value })[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/\{([^{}\r\n]+)\}/g)) {
    const value = valueExpression(parseExpression(match[1]), states);
    if (value === undefined) continue;
    parts.push(text.slice(cursor, match.index), { value });
    cursor = match.index + match[0].length;
  }
  parts.push(text.slice(cursor));
  return { kind: "markdown", parts };
}

function compileChildren(element: Element, states: Map<string, State>): WidgetNode[] | undefined {
  const segments: Element["children"] = [];
  for (const part of element.children) {
    const child = typeof part !== "string" && part.tag === "Entity"
      ? (attrText(part, "value") ?? "商品信息未返回").replace(/[\\`*_{}\[\]()<>#!|~$]/g, "\\$&")
      : part;
    const previous = segments.at(-1);
    if (typeof previous === "string" && typeof child === "string") segments[segments.length - 1] = previous + child;
    else segments.push(child);
  }
  const children: WidgetNode[] = [];
  let label = "";
  for (let index = 0; index < segments.length; index++) {
    const child = segments[index];
    if (typeof child === "string") {
      const text = child.trim();
      if (!text) continue;
      const next = segments[index + 1];
      if (next && typeof next !== "string" && (next.tag === "radio-group" || next.tag === "select")) {
        label = text.replace(/^\*\*([^*]+)\*\*$/, "$1");
      } else {
        children.push(compileText(text, states));
      }
    } else {
      const node = compileNode(child, states, label);
      if (!node) return undefined;
      children.push(node);
      label = "";
    }
  }
  return children;
}

function compileNode(element: Element, states: Map<string, State>, label = ""): WidgetNode | undefined {
  const tag = element.tag;
  switch (tag) {
    case "radio-group": {
      const name = stateBinding(element, states);
      const options = parseOptions(element);
      if (!name || !options?.length || options.length > 40) return undefined;
      const values = new Set(options.map((option) => option.value));
      const initial = states.get(name)?.initial;
      if (values.size !== options.length || typeof initial !== "string" || !values.has(initial)) return undefined;
      return { kind: "radio", name, label: label || attrText(element, "label") || "请选择", options };
    }
    case "checkbox": {
      const name = stateBinding(element, states, "checked");
      const label = element.inner.trim();
      if (!name || typeof states.get(name)?.initial !== "boolean" || !label || element.children.some((child) => typeof child !== "string")) return undefined;
      return { kind: "checkbox", name, label };
    }
    case "select": {
      const name = stateBinding(element, states);
      const values = parseExpression(attrExpression(element, "options"));
      if (!name || values?.type !== "ArrayExpression" || values.elements.length > 40) return undefined;
      const options: Option[] = [];
      for (const entry of values.elements) {
        if (entry?.type !== "ObjectExpression") return undefined;
        const value = valueExpression(property(entry, "value"), states);
        const title = valueExpression(property(entry, "label"), states);
        if (typeof value !== "string" || typeof title !== "string" || options.some((option) => option.value === value)) return undefined;
        options.push({ value, label: title });
      }
      if (!options.some((option) => option.value === states.get(name)?.initial)) return undefined;
      return { kind: "select", name, label: label || attrText(element, "label") || "请选择", options };
    }
    case "slider": {
      const name = stateBinding(element, states);
      const min = attrNumber(element, "min");
      const max = attrNumber(element, "max");
      const step = attrNumber(element, "step") ?? 1;
      const initial = name ? states.get(name)?.initial : undefined;
      if (!name || typeof initial !== "number" || min === undefined || max === undefined || min >= max || step <= 0 || initial < min || initial > max) return undefined;
      return { kind: "slider", name, min, max, step };
    }
    case "Chart":
      return compileChart(element, states);
    case "chat-condition": {
      const test = parseExpression(attrExpression(element, "test"));
      if (test?.type !== "BinaryExpression" || test.operator !== ">") return undefined;
      const value = valueExpression(test.left, states);
      const threshold = valueExpression(test.right, states);
      const fallbackIndex = element.children.findIndex((child) => typeof child !== "string" && child.tag === "chat-otherwise");
      const children = compileChildren({ ...element, children: fallbackIndex < 0 ? element.children : element.children.slice(0, fallbackIndex) }, states);
      const fallback = fallbackIndex < 0 ? [] : compileChildren({ ...element, children: element.children.slice(fallbackIndex + 1) }, states);
      return value !== undefined && typeof threshold === "number" && children && fallback ? { kind: "condition", value, threshold, children, fallback } : undefined;
    }
    case "divider":
      return { kind: "divider" };
    case "icon":
      return { kind: "icon", name: attrText(element, "name") ?? "" };
    case "favicon":
      return { kind: "icon", name: "globe" };
    case "Entity":
      return compileText(attrText(element, "value") ?? "商品信息未返回", states);
    case "AsyncImage":
      return compileText("图片未返回", states);
    case "Link": {
      const label = attrText(element, "title") ?? "来源";
      const url = attrText(element, "url") ?? attrText(element, "href");
      let href: string | undefined;
      if (url) {
        try {
          const parsed = new URL(url);
          if (/^https?:$/.test(parsed.protocol) && !parsed.username && !parsed.password) href = parsed.href;
        } catch {
          // Keep the label when the address is unavailable.
        }
      }
      return { kind: "link", label, href };
    }
    case "button": {
      const action = parseAction(attrExpression(element, "onClick"), states);
      const children = compileChildren(element, states);
      return action && children?.length && children.every((child) => child.kind === "icon" || child.kind === "markdown")
        ? { kind: "button", action, children, label: "adjust" in action ? `${action.adjust.change > 0 ? "增加" : "减少"} ${action.adjust.name}` : undefined }
        : undefined;
    }
    case "box":
    case "row":
    case "title":
    case "text":
    case "badge": {
      const children = compileChildren(element, states);
      return children ? { kind: "layout", variant: tag, children } : undefined;
    }
    default:
      return undefined;
  }
}

function expandChartControls(source: string): string {
  return source.replace(/\{#each\s+(\[[^\r\n]*\])\s+as\s+([\w$]+)\s*\}([\s\S]*?)\{\/each\}/g, (original, list: string, alias: string, body: string) => {
    const array = parseExpression(list);
    if (array?.type !== "ArrayExpression" || array.elements.length > 12 || !body.includes("<slider")) return original;
    const expanded = [];
    for (const row of array.elements) {
      if (row?.type !== "ObjectExpression") return original;
      const name = property(row, "name");
      const value = property(row, "value");
      const setter = property(row, "set");
      if (name?.type !== "Literal" || typeof name.value !== "string" || /[<>{}`\r\n]/.test(name.value) || value?.type !== "Identifier" || setter?.type !== "Identifier") return original;
      const prefix = alias.replace(/[$]/g, "\\$");
      expanded.push(body.replace(new RegExp(`\\b${prefix}\\.(name|value|set)\\b`, "g"), (_, field) => field === "name" ? JSON.stringify(name.value) : field === "value" ? value.name : setter.name));
    }
    return expanded.join("");
  }).replace(/\{#if\s+([\w$]+\s*>\s*-?\d+)\s*\}/g, "<chat-condition test={$1}>")
    .replace(/\{:else\}/g, "<chat-otherwise/>")
    .replace(/\{\/if\}/g, "</chat-condition>");
}

export function readChatWidget(source: string): { end: number; widget?: ChatWidget } | undefined {
  const declaration = /\{@body\s+const\s*(?:\[\s*([\w$]+)\s*,\s*([\w$]+)\s*\]\s*=\s*DIL\.useState\(\s*("(?:[^"\\\r\n]|\\.)*"|-?\d+(?:\.\d+)?|true|false)\s*\)|([\w$]+)\s*=\s*([^{};\r\n]+))\s*;?\s*\}\s*/y;
  const states = new Map<string, State>();
  let cursor = 0;
  let valid = true;
  for (let match = declaration.exec(source); match; match = declaration.exec(source)) {
    const [, name, setter, literal, derivedName, derivedSource] = match;
    if (derivedName) {
      const derived = valueExpression(parseExpression(derivedSource), states);
      if (derived === undefined || states.has(derivedName)) valid = false;
      else states.set(derivedName, { setter: "", initial: "", derived });
      cursor = declaration.lastIndex;
      continue;
    }
    const initial = valueExpression(parseExpression(literal), states);
    if (initial === undefined || typeof initial === "object") return undefined;
    if (states.has(name) || [...states.values()].some((state) => state.setter === setter)) valid = false;
    states.set(name, { setter, initial });
    cursor = declaration.lastIndex;
  }
  const element = readElement(source, cursor);
  if (!element) return undefined;
  const original = source.slice(cursor, element.end);
  const expanded = original.includes("<slider") ? expandChartControls(original) : original;
  const display = expanded === original ? element : readElement(expanded, 0);
  const root = valid && display ? compileNode(display, states) : undefined;
  const containsInput = (node: WidgetNode): boolean => node.kind === "radio" || node.kind === "checkbox" || node.kind === "select" || ("children" in node && node.children.some(containsInput));
  const initial = new Map([...states].map(([name, state]) => [name, state.initial]));
  return { end: element.end, widget: root ? { root, initial, form: containsInput(root) } : undefined };
}
