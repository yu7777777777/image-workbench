import { parseExpressionAt, type Expression, type ObjectExpression } from "acorn";
import { chatImageQueries } from "./chat-resources";

type Scalar = string | number | boolean;
export type WidgetStateValue = Scalar | readonly string[];
type Comparison = "===" | "!==" | ">" | "<" | ">=" | "<=";
type Value = Scalar | { variable: string } | { add: [Value, Value] } | { compare: [Comparison, Value, Value] } | { choose: [Value, Value, Value] } | { fallback: [Value, Value] } | { join: Value[]; separator: string }
  | { not: Value } | { length: Value } | { includes: [Value, Value] } | { joinState: Value; separator: string };
type Attribute = string | true | { expression: string };
type Element = { tag: string; attributes: Map<string, Attribute>; children: (Element | string)[]; inner: string; end: number };
type State = { setter: string; initial: WidgetStateValue; derived?: Value; loop?: true };
type Option = { value: string; label: string };
type Action = { submit: Value } | { submitForm: true } | { reset: string[] } | { adjust: { name: string; change: number; bound: number } } | { set: { name: string; value: Value } };
type AstNode = Expression | { type: "PrivateIdentifier"; name: string } | { type: "SpreadElement"; argument: Expression } | { type: "Super" };
type Layout = "box" | "row" | "col" | "grid" | "card" | "title" | "text" | "badge" | "caption" | "grid-item" | "flow-item" | "carousel-item";
type LayoutOptions = { gap?: number; columns?: number; flex?: number; align?: "start" | "center" | "end" | "stretch"; justify?: "start" | "center" | "end" | "between"; border?: boolean; surface?: boolean; padding?: number; height?: string; aspectRatio?: string; color?: Value; size?: string; wrap?: boolean; numeric?: boolean };
type ChartRow = { name: Value; values: Value[]; x?: Value; filter?: Scalar };
export type WidgetMarker = { lat: number; lon: number; label: string } | { address: string; label: string };
type SvgShape = { tag: "rect" | "circle" | "ellipse" | "path" | "line" | "polygon" | "polyline"; attrs: Record<string, string> };
export type WidgetResourceType = "source" | "product";
export type WidgetImage = { kind: "image"; ref?: string; queries?: string[]; label?: string; href?: string; group: boolean; bento: boolean; maxWidth?: number; aspectRatio?: string };

export const chatWidgetStartTags = [
  "box", "row", "col", "column", "grid", "card", "title", "text", "badge", "form", "popover", "carousel",
  "segmented-control", "segmented", "Chart", "chart", "Map", "map", "AsyncImage", "AsyncImageGroup", "Entity", "AsyncVideo", "list", "caption",
  "video", "follow-up", "FollowUp", "input", "text-input", "textarea", "text-area", "date-picker", "date",
  "flow", "MapWidgetV2", "pressable", "divider", "spacer", "svg", "icon", "button", "radio-group", "checkbox", "select", "slider",
];

export type WidgetNode =
  | { kind: "layout"; variant: Layout; children: WidgetNode[]; options?: LayoutOptions }
  | { kind: "form"; label?: string; submit?: Value; children: WidgetNode[] }
  | { kind: "popover"; label: string; icon?: string; children: WidgetNode[] }
  | { kind: "carousel"; label: string; binding?: string; showArrows: boolean; children: WidgetNode[] }
  | { kind: "pressable"; action: Action; label: string; options: LayoutOptions; children: WidgetNode[] }
  | { kind: "markdown"; parts: (string | { value: Value })[] }
  | { kind: "icon"; name: string; size?: string }
  | { kind: "divider" }
  | { kind: "spacer" }
  | { kind: "unsupported"; tag: string; text: string }
  | { kind: "svg"; viewBox: string; shapes: SvgShape[] }
  | { kind: "list"; ordered: boolean; connected: boolean; gap?: number; children: Extract<WidgetNode, { kind: "list-item" }>[] }
  | { kind: "list-item"; children: WidgetNode[] }
  | { kind: "radio"; name: string; label: string; options: Option[]; segmented?: boolean; horizontal?: boolean }
  | { kind: "checkbox"; name: string; label: string; item?: string }
  | { kind: "select"; name: string; label: string; options: Option[] }
  | { kind: "input"; name: string; label: string; inputType: "text" | "textarea" | "date" | "number"; placeholder?: string; required: boolean; maxLength: number; min?: string; max?: string; rows?: number }
  | { kind: "slider"; name: string; min: number; max: number; step: number }
  | { kind: "chart"; chartType: "bar" | "line" | "pie" | "scatter"; rows: ChartRow[]; series: string[]; label: string; description?: string; min?: number; filter?: Value }
  | { kind: "condition"; test: Value; children: WidgetNode[]; fallback: WidgetNode[] }
  | { kind: "link"; label: string; href?: string; ref?: string; product?: boolean }
  | { kind: "resource"; resourceType: "product"; ref?: string; label: string }
  | WidgetImage
  | { kind: "map"; label: string; markers: WidgetMarker[] }
  | { kind: "video"; label: string; src?: string }
  | { kind: "button"; children: WidgetNode[]; action: Action; label?: string; color?: string; style?: string };

export type ChatWidget = { root: WidgetNode; initial: Map<string, WidgetStateValue>; form: boolean; explicitForm: boolean };

export function widgetValue(value: Value, state: ReadonlyMap<string, WidgetStateValue>): WidgetStateValue {
  if (typeof value !== "object") return value;
  if ("variable" in value) return state.get(value.variable) ?? "";
  if ("not" in value) return !widgetValue(value.not, state);
  if ("length" in value) {
    const sequence = widgetValue(value.length, state);
    return typeof sequence === "string" || Array.isArray(sequence) ? sequence.length : 0;
  }
  if ("includes" in value) {
    const collection = widgetValue(value.includes[0], state);
    const item = widgetValue(value.includes[1], state);
    return Array.isArray(collection) && typeof item === "string" && collection.includes(item);
  }
  if ("joinState" in value) {
    const collection = widgetValue(value.joinState, state);
    return Array.isArray(collection) ? collection.join(value.separator) : "";
  }
  if ("choose" in value) return widgetValue(widgetValue(value.choose[0], state) ? value.choose[1] : value.choose[2], state);
  if ("fallback" in value) return widgetValue(value.fallback[0], state) || widgetValue(value.fallback[1], state);
  if ("join" in value) return value.join.map((item) => widgetValue(item, state)).filter(Boolean).join(value.separator);
  if ("compare" in value) {
    const [operator, first, second] = value.compare;
    const left = widgetValue(first, state);
    const right = widgetValue(second, state);
    if (operator === "===") return left === right;
    if (operator === "!==") return left !== right;
    if (typeof left !== "number" || typeof right !== "number") return false;
    if (operator === ">") return left > right;
    if (operator === "<") return left < right;
    if (operator === ">=") return left >= right;
    return left <= right;
  }
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
      if (value) {
        attributes.set(name, value[1] ?? value[2]);
        cursor = literal.lastIndex;
      } else {
        const keyword = /^(?:[a-z][a-z-]*|\d+)(?=[\s/>])/.exec(source.slice(cursor));
        if (!keyword || !["align", "justify", "flex", "marker", "connector", "layout"].includes(name)) return undefined;
        attributes.set(name, keyword[0]);
        cursor += keyword[0].length;
      }
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

function literalStrings(expression: Expression | undefined): string[] | undefined {
  if (expression?.type !== "ArrayExpression" || expression.elements.length > 40) return undefined;
  const values = expression.elements.map((item) => item?.type === "Literal" ? item.value : undefined);
  return values.every((item): item is string => typeof item === "string" && item.length <= 500) ? values : undefined;
}

function memberCall(node: AstNode | null | undefined, name: string): node is Extract<Expression, { type: "CallExpression" }> & { callee: Extract<Expression, { type: "MemberExpression" }> } {
  return node?.type === "CallExpression" && !node.optional && node.callee.type === "MemberExpression" && !node.callee.computed
    && !node.callee.optional && node.callee.property.type === "Identifier" && node.callee.property.name === name;
}

function valueExpression(node: AstNode | null | undefined, states: Map<string, State>, depth = 0): Value | undefined {
  if (!node || depth > 32) return undefined;
  if (node.type === "PrivateIdentifier" || node.type === "SpreadElement" || node.type === "Super") return undefined;
  if (node.type === "Literal") {
    if (node.value === null) return "";
    return typeof node.value === "string" || typeof node.value === "boolean" || (typeof node.value === "number" && Number.isFinite(node.value)) ? node.value : undefined;
  }
  if (node.type === "Identifier" && states.has(node.name)) return states.get(node.name)?.derived ?? { variable: node.name };
  if (node.type === "MemberExpression" && !node.computed && !node.optional && node.property.type === "Identifier" && node.property.name === "length") {
    const value = valueExpression(node.object, states, depth + 1);
    return value === undefined ? undefined : { length: value };
  }
  if (memberCall(node, "includes") && node.arguments.length === 1) {
    const collection = valueExpression(node.callee.object, states, depth + 1);
    const item = valueExpression(node.arguments[0], states, depth + 1);
    return collection === undefined || item === undefined ? undefined : { includes: [collection, item] };
  }
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
  if (memberCall(node, "join")) {
    const filter = node.callee.object;
    const separator = node.arguments.length === 1 && valueExpression(node.arguments[0], new Map());
    if (typeof separator !== "string") return undefined;
    if (filter.type === "Identifier" && Array.isArray(states.get(filter.name)?.initial)) return { joinState: { variable: filter.name }, separator };
    if (!memberCall(filter, "filter") || filter.callee.object.type !== "ArrayExpression" || filter.arguments.length !== 1 || filter.arguments[0].type !== "Identifier" || filter.arguments[0].name !== "Boolean") return undefined;
    const items = filter.callee.object.elements.map((item) => valueExpression(item, states, depth + 1));
    return items.every((item): item is Value => item !== undefined) ? { join: items, separator } : undefined;
  }
  if (node.type === "UnaryExpression" && node.operator === "!") {
    const value = valueExpression(node.argument, states, depth + 1);
    return value === undefined ? undefined : { not: value };
  }
  if (node.type === "UnaryExpression" && node.operator === "-" && node.argument.type === "Literal" && typeof node.argument.value === "number" && Number.isFinite(node.argument.value)) {
    return -node.argument.value;
  }
  if (node.type !== "BinaryExpression") return undefined;
  const operator = node.operator;
  if (operator !== "+" && operator !== "===" && operator !== "!==" && operator !== ">" && operator !== "<" && operator !== ">=" && operator !== "<=") return undefined;
  const left = valueExpression(node.left, states, depth + 1);
  const right = valueExpression(node.right, states, depth + 1);
  if (left === undefined || right === undefined) return undefined;
  return operator === "+" ? { add: [left, right] } : { compare: [operator, left, right] };
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

function attrString(element: Element, name: string, states = new Map<string, State>()): string | undefined {
  const value = attrText(element, name) ?? valueExpression(parseExpression(attrExpression(element, name)), states);
  return typeof value === "string" ? value : undefined;
}

function attrBoolean(element: Element, name: string): boolean | undefined {
  const literal = element.attributes.get(name);
  if (literal === true || literal === "true") return true;
  if (literal === "false") return false;
  const value = valueExpression(parseExpression(attrExpression(element, name)), new Map());
  return typeof value === "boolean" ? value : undefined;
}

function stateBinding(element: Element, states: Map<string, State>, attribute = "value"): string | undefined {
  const name = attrExpression(element, attribute)?.trim();
  const setter = (attrExpression(element, "onChange") ?? attrExpression(element, "onInput") ?? attrExpression(element, "onValueChange"))?.trim();
  return name && setter && states.get(name)?.setter === setter ? name : undefined;
}

function parseOptionArray(element: Element): Option[] | undefined {
  const values = parseExpression(attrExpression(element, "options"));
  if (values?.type !== "ArrayExpression" || values.elements.length > 40) return undefined;
  const options: Option[] = [];
  for (const part of values.elements) {
    const object = part?.type === "ObjectExpression" ? part : undefined;
    const value = valueExpression(object ? property(object, "value") : part, new Map());
    const label = object ? valueExpression(property(object, "label"), new Map()) : value;
    if (typeof value !== "string" || typeof label !== "string" || options.some((option) => option.value === value)) return undefined;
    options.push({ value, label });
  }
  return options;
}

function repeatBindings(element: Element, states: Map<string, State>): Map<string, State>[] | undefined {
  const alias = attrText(element, "alias");
  const entries = literalStrings(parseExpression(attrExpression(element, "values")));
  if (!alias || !entries || states.has(alias) || [...states.values()].some((state) => state.loop)) return undefined;
  return entries.map((item) => new Map(states).set(alias, { setter: "", initial: item, derived: item, loop: true }));
}

function option(element: Element, states: Map<string, State>): Option | undefined {
  if (!["radio", "segment", "option", "item"].includes(element.tag) || element.children.some((part) => typeof part !== "string")) return undefined;
  const value = attrString(element, "value", states);
  const body = element.inner.trim();
  const literal = /^\{\s*([\w$]+)\s*\}$/.exec(body);
  const label = attrString(element, "label", states) ?? (literal ? states.get(literal[1])?.derived : body);
  return value && typeof label === "string" && label.trim() ? { value, label } : undefined;
}

function parseOptions(element: Element): Option[] | undefined {
  if (element.attributes.has("options")) return parseOptionArray(element);
  const states = new Map<string, State>();
  const options: Option[] = [];
  for (const child of element.children) {
    if (typeof child === "string" && !child.trim()) continue;
    if (typeof child === "string") return undefined;
    if (child.tag === "chat-repeat") {
      const items = child.children.filter((part) => typeof part !== "string" || part.trim());
      const bindings = repeatBindings(child, states);
      if (!bindings || items.length !== 1 || typeof items[0] === "string") return undefined;
      for (const binding of bindings) {
        const entry = option(items[0], binding);
        if (!entry) return undefined;
        options.push(entry);
      }
    } else {
      const entry = option(child, states);
      if (!entry) return undefined;
      options.push(entry);
    }
  }
  return options;
}

function isIdentifier(node: AstNode | null | undefined, name: string): boolean {
  return node?.type === "Identifier" && node.name === name;
}

function collectionCheckbox(element: Element, states: Map<string, State>): { name: string; item: string } | undefined {
  const checked = parseExpression(attrExpression(element, "checked"));
  if (!memberCall(checked, "includes") || checked.callee.object.type !== "Identifier" || checked.arguments.length !== 1) return undefined;
  const name = checked.callee.object.name;
  const state = states.get(name);
  const item = valueExpression(checked.arguments[0], states);
  const change = parseExpression(attrExpression(element, "onChange"));
  if (!state || !Array.isArray(state.initial) || typeof item !== "string" || change?.type !== "ArrowFunctionExpression"
    || change.async || change.params.length !== 1 || change.params[0].type !== "Identifier") return undefined;
  const setter = change.body;
  if (setter.type !== "CallExpression" || setter.optional || !isIdentifier(setter.callee, state.setter) || setter.arguments.length !== 1) return undefined;
  const update = setter.arguments[0];
  if (update.type !== "ArrowFunctionExpression" || update.async || update.params.length !== 1 || update.params[0].type !== "Identifier") return undefined;
  const old = update.params[0].name;
  const updateBody = update.body;
  if (updateBody.type !== "ConditionalExpression" || !isIdentifier(updateBody.test, change.params[0].name)) return undefined;
  const append = updateBody.consequent;
  const filter = updateBody.alternate;
  if (append.type !== "ArrayExpression" || append.elements.length !== 2 || append.elements[0]?.type !== "SpreadElement"
    || !isIdentifier(append.elements[0].argument, old) || valueExpression(append.elements[1], states) !== item
    || !memberCall(filter, "filter") || !isIdentifier(filter.callee.object, old) || filter.arguments.length !== 1) return undefined;
  const predicate = filter.arguments[0];
  if (predicate.type !== "ArrowFunctionExpression" || predicate.async || predicate.params.length !== 1 || predicate.params[0].type !== "Identifier"
    || predicate.body.type !== "BinaryExpression" || predicate.body.operator !== "!==" || !isIdentifier(predicate.body.left, predicate.params[0].name)
    || valueExpression(predicate.body.right, states) !== item) return undefined;
  return { name, item };
}

function parseAction(source: string | undefined, states: Map<string, State>): Action | undefined {
  // Compile only declared state changes and normal follow-up messages.
  const action = parseExpression(source);
  if (action?.type !== "ArrowFunctionExpression" || action.async || action.params.length) return undefined;
  const body = action.body;
  if (body.type === "CallExpression" && !body.optional && body.arguments.length === 1) {
    const target = body.callee;
    if (target.type === "Identifier") {
      const state = [...states].find(([, value]) => value.setter === target.name);
      const match = /^Math\.(min|max)\(\s*(-?\d+)\s*,\s*([\w$]+)\s*([+-])\s*(\d+)\s*\)$/.exec((attrSource(body.arguments[0], source) ?? "").trim());
      if (!state || Array.isArray(state[1].initial)) return undefined;
      if (match && typeof state[1].initial === "number" && match[3] === state[0] && (match[1] === "min") === (match[4] === "+")) {
        return { adjust: { name: state[0], change: Number(match[5]) * (match[4] === "+" ? 1 : -1), bound: Number(match[2]) } };
      }
      const value = valueExpression(body.arguments[0], states);
      const initial = new Map([...states].map(([name, entry]) => [name, entry.initial]));
      return value !== undefined && typeof widgetValue(value, initial) === typeof state[1].initial ? { set: { name: state[0], value } } : undefined;
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
  if (typeof chartType !== "string" || (chartType !== "bar" && chartType !== "line" && chartType !== "pie" && chartType !== "scatter")) return undefined;
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
  if (!keys.length && chartType === "scatter") {
    const key = valueExpression(property(config, "yKey"), states);
    if (typeof key === "string") keys.push({ key, label: key });
  }
  if (!keys.length || (chartType === "pie" && keys.length !== 1)) return undefined;
  const meta = property(config, "meta");
  const description = meta?.type === "ObjectExpression" ? valueExpression(property(meta, "description"), states) : undefined;
  const title = meta?.type === "ObjectExpression" ? valueExpression(property(meta, "title"), states) : undefined;
  const min = valueExpression(property(config, "yAxisMin"), states);
  const rowLabelKey = valueExpression(property(config, "labelKey"), new Map());
  const filterKey = valueExpression(property(config, "filterKey"), new Map());
  const filter = valueExpression(property(config, "filterValue"), states);
  if ((filterKey !== undefined || filter !== undefined) && (typeof filterKey !== "string" || filter === undefined)) return undefined;
  const initial = new Map([...states].map(([name, state]) => [name, state.initial]));
  const rows: ChartRow[] = [];
  for (const row of data.elements) {
    if (row?.type !== "ObjectExpression") return undefined;
    const name = valueExpression(property(row, typeof rowLabelKey === "string" ? rowLabelKey : xKey), states);
    const x = chartType === "scatter" ? valueExpression(property(row, xKey), states) : undefined;
    const values = keys.map(({ key }) => valueExpression(property(row, key), states));
    const rowFilter = typeof filterKey === "string" ? valueExpression(property(row, filterKey), new Map()) : undefined;
    if (name === undefined || (chartType === "scatter" && (x === undefined || !Number.isFinite(widgetValue(x, initial))))) return undefined;
    if (!values.every((value): value is Value => value !== undefined && Number.isFinite(widgetValue(value, initial)))) return undefined;
    if (typeof rowFilter === "object" || (typeof filterKey === "string" && rowFilter === undefined)) return undefined;
    rows.push({ name, values, x, filter: rowFilter });
  }
  const label = typeof title === "string" ? title : keys[0].label;
  return { kind: "chart", chartType, rows, series: keys.map((key) => key.label), label, description: typeof description === "string" ? description : undefined, min: typeof min === "number" ? min : undefined, filter };
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
      if (next && typeof next !== "string" && ["radio-group", "select", "input", "text-input", "textarea", "date-picker", "segmented-control", "segmented"].includes(next.tag)) {
        label = text.replace(/^\*\*([^*]+)\*\*$/, "$1");
      } else {
        children.push(compileText(text, states));
      }
    } else {
      if (child.tag === "chat-repeat") {
        const bindings = repeatBindings(child, states);
        if (!bindings) children.push({ kind: "unsupported", tag: "each", text: child.inner });
        else for (const binding of bindings) {
          const repeated = compileChildren(child, binding);
          if (!repeated) return undefined;
          children.push(...repeated);
        }
        label = "";
        continue;
      }
      const node = compileNode(child, states, label);
      if (!node) return undefined;
      children.push(node);
      label = "";
    }
  }
  return children;
}

function compileInput(element: Element, states: Map<string, State>, label: string): WidgetNode | undefined {
  const name = stateBinding(element, states);
  const inputType = element.tag === "textarea" || element.tag === "text-area" ? "textarea"
    : element.tag === "date-picker" || element.tag === "date" ? "date"
      : attrString(element, "inputType") ?? attrString(element, "type") ?? "text";
  if (inputType !== "text" && inputType !== "textarea" && inputType !== "date" && inputType !== "number") return undefined;
  const initial = name ? states.get(name)?.initial : undefined;
  if (!name || (typeof initial !== "string" && !(inputType === "number" && typeof initial === "number"))) return undefined;
  const maxLength = Math.max(1, Math.min(4000, Math.trunc(attrNumber(element, "maxLength") ?? 1000)));
  const date = /^\d{4}-\d{2}-\d{2}$/;
  const min = attrString(element, "min");
  const max = attrString(element, "max");
  return {
    kind: "input", name, inputType, label: label || attrString(element, "label") || (inputType === "date" ? "选择日期" : "输入内容"),
    required: attrBoolean(element, "required") ?? false, placeholder: attrString(element, "placeholder"),
    maxLength, rows: inputType === "textarea" ? Math.max(2, Math.min(12, Math.trunc(attrNumber(element, "rows") ?? 3))) : undefined,
    min: inputType === "number" ? attrNumber(element, "min")?.toString() : min && date.test(min) ? min : undefined,
    max: inputType === "number" ? attrNumber(element, "max")?.toString() : max && date.test(max) ? max : undefined,
  };
}

function layoutOptions(element: Element): LayoutOptions {
  const align = attrString(element, "align");
  const justify = attrString(element, "justify");
  const gap = attrNumber(element, "gap");
  const columns = attrNumber(element, "columns");
  const flex = attrNumber(element, "flex");
  const padding = attrNumber(element, "padding");
  const height = attrString(element, "height");
  const ratio = ratioAttribute(element);
  return {
    gap: gap === undefined ? undefined : Math.min(24, Math.max(0, gap * 4)),
    columns: columns === undefined ? undefined : Math.max(1, Math.min(4, Math.floor(columns))),
    flex: flex === undefined || flex <= 0 ? undefined : Math.min(8, flex),
    align: align === "start" || align === "center" || align === "end" || align === "stretch" ? align : undefined,
    justify: justify === "start" || justify === "center" || justify === "end" || justify === "between" ? justify : undefined,
    border: attrBoolean(element, "border"),
    surface: attrString(element, "background") === "surface-secondary" || undefined,
    padding: padding === undefined ? undefined : Math.min(24, Math.max(0, padding * 4)),
    height: height === "100%" || (height && /^[1-9]\d{0,2}px$/.test(height) && parseInt(height, 10) <= 480) ? height : undefined,
    aspectRatio: ratio,
    size: attrString(element, "size"),
    wrap: attrString(element, "wrap") === "wrap" || undefined,
    numeric: attrBoolean(element, "tabularNums"),
  };
}

function ratioAttribute(element: Element): string | undefined {
  const ratio = /^(\d{1,2})\s*[:/]\s*(\d{1,2})$/.exec(attrString(element, "aspectRatio") ?? "");
  return ratio && Number(ratio[1]) && Number(ratio[2]) ? `${Number(ratio[1])} / ${Number(ratio[2])}` : undefined;
}

function safeMediaUrl(value: string | undefined): URL | undefined {
  if (!value || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    const host = url.hostname;
    if (url.protocol === "https:" && !url.username && !url.password
      && /^[a-z][a-z0-9.-]*\.[a-z]{2,}\.?$/i.test(host)
      && !/\.(?:localhost|local|internal|test|invalid)\.?$/i.test(host)) return url;
  } catch {
    // Incomplete or relative addresses remain plain placeholders.
  }
  return undefined;
}

function compileImage(element: Element): WidgetImage {
  const group = element.tag === "AsyncImageGroup";
  const expression = parseExpression(attrExpression(element, "query"));
  const queries = expression?.type === "ArrayExpression" && group
    ? expression.elements.map((item) => valueExpression(item, new Map()))
    : [attrString(element, "query")];
  const width = /^([1-9]\d{0,3})(?:px)?$/.exec(attrString(element, "maxWidth") ?? String(attrNumber(element, "maxWidth") ?? ""));
  return {
    kind: "image", group, bento: group && attrString(element, "layout") === "bento",
    ref: attrString(element, "ref"), queries: chatImageQueries(queries),
    label: attrString(element, "alt") || attrString(element, "title"),
    href: group ? undefined : safeMediaUrl(attrString(element, "src"))?.href,
    aspectRatio: ratioAttribute(element),
    maxWidth: width ? Math.min(960, Number(width[1])) : undefined,
  };
}

function marker(element: Element, fallbackLabel: string): WidgetMarker | undefined {
  const lat = attrNumber(element, "lat") ?? attrNumber(element, "latitude");
  const lon = attrNumber(element, "lon") ?? attrNumber(element, "lng") ?? attrNumber(element, "longitude");
  if (lat === undefined || lon === undefined || Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return { lat, lon, label: attrString(element, "label") ?? attrString(element, "title") ?? fallbackLabel };
}

function addressMarkers(element: Element): WidgetMarker[] | undefined {
  const points = parseExpression(attrExpression(element, "points"));
  if (points?.type !== "ArrayExpression" || !points.elements.length || points.elements.length > 20) return undefined;
  const markers: WidgetMarker[] = [];
  for (const point of points.elements) {
    if (point?.type !== "ObjectExpression") return undefined;
    const get = (key: string) => valueExpression(property(point, key), new Map());
    const name = get("name");
    const address = get("address");
    const lat = get("lat") ?? get("latitude");
    const lon = get("lon") ?? get("lng") ?? get("longitude");
    const label = typeof name === "string" && name.trim() ? name.trim().slice(0, 160) : `位置 ${markers.length + 1}`;
    if (typeof lat === "number" && typeof lon === "number" && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) markers.push({ label, lat, lon });
    else if (typeof address === "string" && address.trim() && address.length <= 320) markers.push({ label, address: address.trim() });
    else return undefined;
  }
  return markers;
}

const svgTags = new Set(["rect", "circle", "ellipse", "path", "line", "polygon", "polyline"]);
const svgNumericAttrs = new Set(["x", "y", "width", "height", "rx", "ry", "cx", "cy", "r", "x1", "x2", "y1", "y2", "opacity", "strokeWidth"]);

function compileSvg(element: Element): WidgetNode | undefined {
  const box = (attrText(element, "viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (box.length !== 4 || box.some((value) => !Number.isFinite(value) || Math.abs(value) > 100000) || box[2] <= 0 || box[3] <= 0) return undefined;
  const shapes: SvgShape[] = [];
  for (const child of element.children) {
    if (typeof child === "string" && !child.trim()) continue;
    if (typeof child === "string" || !svgTags.has(child.tag) || child.inner.trim() || shapes.length >= 40) return undefined;
    const attrs: Record<string, string> = {};
    for (const [key, value] of child.attributes) {
      if (typeof value !== "string" || value.length > 2000) continue;
      const prop = key === "stroke-width" ? "strokeWidth" : key;
      if ((svgNumericAttrs.has(prop) && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value))
        || ((prop === "fill" || prop === "stroke") && /^(?:#[a-f\d]{3,8}|none|currentColor|[a-z]+)$/i.test(value))
        || (prop === "d" && /^[AaCcEeHhLlMmQqSsTtVvZz0-9.\s,+-]+$/.test(value))
        || (prop === "points" && /^[\d.\s,+-]+$/.test(value))) attrs[prop] = value;
    }
    shapes.push({ tag: child.tag as SvgShape["tag"], attrs });
  }
  return shapes.length ? { kind: "svg", viewBox: box.join(" "), shapes } : undefined;
}

function popoverTrigger(element: Element, states: Map<string, State>): { label: string; icon?: string } | undefined {
  const pieces = element.children.filter((child) => typeof child !== "string" || child.trim());
  const button = pieces.length === 1 && typeof pieces[0] !== "string" && pieces[0].tag === "button" ? pieces[0] : element;
  if (["onClick", "onSubmit", "href"].some((name) => button.attributes.has(name))) return undefined;
  const label = attrString(button, "label", states) || button.children.filter((child) => typeof child === "string").join(" ").trim();
  const icon = button.children.find((child): child is Element => typeof child !== "string" && child.tag === "icon");
  return label ? { label: label.slice(0, 160), icon: icon ? attrString(icon, "name", states) : undefined } : undefined;
}

function widgetHas(node: WidgetNode, matches: (child: WidgetNode) => boolean): boolean {
  return matches(node) || ("children" in node && node.children.some((child) => widgetHas(child, matches)))
    || (node.kind === "condition" && node.fallback.some((child) => widgetHas(child, matches)));
}

function compileNode(element: Element, states: Map<string, State>, label = ""): WidgetNode | undefined {
  const tag = element.tag;
  switch (tag) {
    case "radio-group":
    case "segmented-control":
    case "segmented": {
      const name = stateBinding(element, states);
      const options = parseOptions(element);
      if (!name || !options?.length || options.length > 40) return undefined;
      const values = new Set(options.map((option) => option.value));
      const initial = states.get(name)?.initial;
      if (values.size !== options.length || typeof initial !== "string" || !values.has(initial)) return undefined;
      return { kind: "radio", name, label: label || attrString(element, "label") || "请选择", options, segmented: tag !== "radio-group", horizontal: attrString(element, "direction") === "row" };
    }
    case "checkbox": {
      const name = stateBinding(element, states, "checked");
      const collection = collectionCheckbox(element, states);
      const label = attrString(element, "label") ?? (collection?.item || element.inner.trim());
      if (!label || element.children.some((child) => typeof child !== "string")) return undefined;
      if (collection) return { kind: "checkbox", ...collection, label };
      return name && typeof states.get(name)?.initial === "boolean" ? { kind: "checkbox", name, label } : undefined;
    }
    case "select": {
      const name = stateBinding(element, states);
      const options = parseOptions(element);
      if (!name || !options || options.length > 40) return undefined;
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
    case "input":
    case "text-input":
    case "textarea":
    case "text-area":
    case "date":
    case "date-picker":
      return compileInput(element, states, label);
    case "Chart":
    case "chart":
      return compileChart(element, states);
    case "chat-condition": {
      const test = parseExpression(attrExpression(element, "test"));
      const value = valueExpression(test, states);
      const fallbackIndex = element.children.findIndex((child) => typeof child !== "string" && child.tag === "chat-otherwise");
      const children = compileChildren({ ...element, children: fallbackIndex < 0 ? element.children : element.children.slice(0, fallbackIndex) }, states);
      const fallback = fallbackIndex < 0 ? [] : compileChildren({ ...element, children: element.children.slice(fallbackIndex + 1) }, states);
      return value !== undefined && children && fallback ? { kind: "condition", test: value, children, fallback } : undefined;
    }
    case "divider":
      return { kind: "divider" };
    case "spacer":
      return { kind: "spacer" };
    case "svg":
      return compileSvg(element) ?? { kind: "unsupported", tag: "svg", text: element.inner };
    case "list": {
      const children = compileChildren(element, states);
      if (!children?.length || !children.every((child): child is Extract<WidgetNode, { kind: "list-item" }> => child.kind === "list-item")) return undefined;
      return { kind: "list", ordered: attrString(element, "marker") === "number", connected: attrString(element, "connector") === "solid", gap: layoutOptions(element).gap, children };
    }
    case "list-item": {
      const children = compileChildren(element, states);
      return children ? { kind: "list-item", children } : undefined;
    }
    case "icon":
      return { kind: "icon", name: attrString(element, "name", states) ?? "", size: attrString(element, "size") };
    case "favicon":
      return { kind: "icon", name: "globe" };
    case "Entity":
      return { kind: "resource", resourceType: "product", ref: attrString(element, "ref"), label: attrString(element, "value") ?? "商品信息未返回" };
    case "AsyncImage":
    case "AsyncImageGroup":
      return compileImage(element);
    case "Link": {
      const label = attrText(element, "title") ?? "来源";
      const url = attrString(element, "url") ?? attrString(element, "href");
      let href: string | undefined;
      if (url) {
        try {
          const parsed = new URL(url);
          if (/^https?:$/.test(parsed.protocol) && !parsed.username && !parsed.password) href = parsed.href;
        } catch {
          // Keep the label when the address is unavailable.
        }
      }
      const productRef = /^([\w$]+)\.product_page\.uri$/.exec(attrExpression(element, "url")?.trim() ?? "")?.[1];
      return { kind: "link", label, href, ref: attrString(element, "ref") ?? productRef, product: Boolean(productRef) };
    }
    case "Cite": {
      const references = parseExpression(attrExpression(element, "refs"));
      if (references?.type !== "ArrayExpression" || !references.elements.length || references.elements.length > 8) return undefined;
      const refs = references.elements.map((part) => valueExpression(part, new Map()));
      if (!refs.every((ref): ref is string => typeof ref === "string" && !!ref)) return undefined;
      const links: WidgetNode[] = refs.map((ref) => ({ kind: "link", ref, label: "来源" }));
      return links.length === 1 ? links[0] : { kind: "layout", variant: "row", children: links };
    }
    case "form": {
      const handler = attrExpression(element, "onSubmit");
      const action = parseAction(handler, states);
      if (handler && (!action || !("submit" in action))) return undefined;
      const children = compileChildren(element, states);
      if (!children || children.some((child) => widgetHas(child, (node) => node.kind === "form"))) return undefined;
      return { kind: "form", label: attrString(element, "label"), submit: action && "submit" in action ? action.submit : undefined, children };
    }
    case "popover": {
      const trigger = element.children.find((child): child is Element => typeof child !== "string" && child.tag === "popover-trigger");
      const panel = element.children.find((child): child is Element => typeof child !== "string" && child.tag === "popover-content");
      const button = trigger ? popoverTrigger(trigger, states) : undefined;
      if ((trigger || panel) && (!button || !panel)) return undefined;
      const children = compileChildren(panel ?? element, states);
      return children?.length ? { kind: "popover", label: button?.label ?? attrString(element, "label") ?? attrString(element, "title") ?? "展开详情", icon: button?.icon, children } : undefined;
    }
    case "carousel": {
      const children = compileChildren(element, states);
      const binding = stateBinding(element, states, "activeIndex");
      if ((element.attributes.has("onChange") || element.attributes.has("onValueChange")) && (!binding || typeof states.get(binding)?.initial !== "number")) return undefined;
      return children?.length ? { kind: "carousel", label: attrString(element, "label") ?? attrString(element, "title") ?? "内容轮播", binding, showArrows: attrBoolean(element, "showArrows") ?? true, children } : undefined;
    }
    case "pressable": {
      const action = parseAction(attrExpression(element, "onClick"), states);
      const children = compileChildren(element, states);
      if (!action || !children?.length || children.some((child) => widgetHas(child, (node) => !["layout", "markdown", "icon", "spacer", "divider", "svg"].includes(node.kind)))) return undefined;
      return { kind: "pressable", action, children, label: attrString(element, "label") ?? "切换卡片状态", options: layoutOptions(element) };
    }
    case "AsyncVideo":
    case "video": {
      const url = safeMediaUrl(attrString(element, "src") ?? attrString(element, "url"));
      const src = url && /\.(?:mp4|webm|ogv|ogg|mov)$/i.test(url.pathname) ? url.href : undefined;
      return { kind: "video", label: attrString(element, "title") ?? "视频", src };
    }
    case "Map":
    case "map":
    case "MapWidgetV2": {
      const label = attrString(element, "label") ?? attrString(element, "title") ?? "位置";
      if (element.attributes.has("points")) {
        const markers = addressMarkers(element);
        return markers?.length ? { kind: "map", label, markers } : undefined;
      }
      const location = marker(element, label);
      const markers = location ? [location] : [];
      for (const child of element.children) {
        if (typeof child === "string" && !child.trim()) continue;
        if (typeof child === "string" || (child.tag !== "Marker" && child.tag !== "marker") || markers.length >= 20) return undefined;
        const point = marker(child, `位置 ${markers.length + 1}`);
        if (!point) return undefined;
        markers.push(point);
      }
      return markers.length ? { kind: "map", label, markers } : undefined;
    }
    case "button":
    case "FollowUp":
    case "follow-up": {
      const prompt = attrString(element, "prompt");
      const handler = attrExpression(element, "onClick");
      const action: Action | undefined = handler ? parseAction(handler, states)
        : prompt ? { submit: prompt }
          : attrString(element, "type") === "submit" ? { submitForm: true } : undefined;
      const children = element.children.length ? compileChildren(element, states) : [compileText(attrString(element, "label") ?? "继续", states)];
      return action && children?.length && children.every((child) => child.kind === "icon" || child.kind === "markdown")
        ? { kind: "button", action, children, color: attrString(element, "color"), style: attrString(element, "variant"), label: "adjust" in action ? `${action.adjust.change > 0 ? "增加" : "减少"} ${action.adjust.name}` : undefined }
        : undefined;
    }
    case "box":
    case "row":
    case "col":
    case "column":
    case "grid":
    case "flow":
    case "grid-item":
    case "flow-item":
    case "carousel-item":
    case "card":
    case "title":
    case "text":
    case "caption":
    case "badge": {
      const children = compileChildren(element, states);
      const options = layoutOptions(element);
      options.color = attrText(element, "color") ?? valueExpression(parseExpression(attrExpression(element, "color")), states);
      return children ? { kind: "layout", variant: tag === "column" ? "col" : tag === "flow" ? "grid" : tag, options, children } : undefined;
    }
    default:
      return { kind: "unsupported", tag, text: element.inner.slice(0, 2000) };
  }
}

function expandWidgetDirectives(source: string): string {
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
  }).replace(/\{#each\s+(\[[^\r\n]*?\])\s+as\s+([a-zA-Z_$][\w$]*)\s*\}/g, '<chat-repeat values={$1} alias="$2">')
    .replace(/\{\/each\}/g, "</chat-repeat>")
    .replace(/\{#if\s+([^{}\r\n]+?)\s*\}/g, "<chat-condition test={$1}>")
    .replace(/\{:else\}/g, "<chat-otherwise/>")
    .replace(/\{\/if\}/g, "</chat-condition>");
}

export function readChatWidget(source: string): { end: number; widget?: ChatWidget } | undefined {
  const declaration = /\{@body\s+const\s*(?:\[\s*([\w$]+)\s*,\s*([\w$]+)\s*\]\s*=\s*DIL\.useState\(\s*("(?:[^"\\\r\n]|\\.)*"|'(?:[^'\\\r\n]|\\.)*'|\[[^\r\n]*?\]|-?\d+(?:\.\d+)?|true|false)\s*\)|([\w$]+)\s*=\s*([^{};\r\n]+))\s*;?\s*\}\s*/y;
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
    const expression = parseExpression(literal);
    const initial = expression?.type === "ArrayExpression" ? literalStrings(expression) : valueExpression(expression, new Map());
    if (initial === undefined || (typeof initial === "object" && !Array.isArray(initial))) return undefined;
    if (states.has(name) || [...states.values()].some((state) => state.setter === setter)) valid = false;
    states.set(name, { setter, initial });
    cursor = declaration.lastIndex;
  }
  const element = readElement(source, cursor);
  if (!element) return undefined;
  const original = source.slice(cursor, element.end);
  const expanded = original.includes("{#each") || original.includes("{#if") ? expandWidgetDirectives(original) : original;
  const display = expanded === original ? element : readElement(expanded, 0);
  let root = valid && display ? compileNode(display, states) : undefined;
  const initial = new Map([...states].map(([name, state]) => [name, state.initial]));
  if (!root) return { end: element.end };
  let end = element.end;
  if (root.kind === "carousel" && root.binding) {
    const following = /^[\t ]*\r?\n[\r\n\t ]*/.exec(source.slice(end));
    if (following) {
      const offset = end + following[0].length;
      const caption = readElement(source, offset);
      const suffix = caption && ["caption", "text"].includes(caption.tag) ? caption.inner : source.slice(offset).split(/\r?\n/, 1)[0];
      const fields = [...suffix.matchAll(/\{([^{}\r\n]+)\}/g)];
      if (suffix.length <= 250 && !/^[<#]/.test(suffix) && fields.length && fields.every((field) => valueExpression(parseExpression(field[1]), states) !== undefined)) {
        root = { kind: "layout", variant: "col", children: [root, { kind: "layout", variant: "caption", children: [compileText(suffix, states)] }] };
        end = caption && ["caption", "text"].includes(caption.tag) ? caption.end : offset + suffix.length;
      }
    }
  }
  const explicitForm = widgetHas(root, (node) => node.kind === "form");
  const form = explicitForm || widgetHas(root, (node) => node.kind === "radio" || node.kind === "checkbox" || node.kind === "select" || node.kind === "input");
  return { end, widget: { root, initial, form, explicitForm } };
}

export function chatWidgetInlineImages(widget: ChatWidget): WidgetImage[] {
  function collect(node: WidgetNode): WidgetImage[] {
    if (node.kind === "image" && !node.href) return [node];
    if (node.kind === "condition" || node.kind === "popover" || node.kind === "carousel") return [];
    return "children" in node ? node.children.flatMap(collect) : [];
  }
  return collect(widget.root);
}
