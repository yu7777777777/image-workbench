import { parseExpressionAt, type BlockStatement, type Expression, type ObjectExpression } from "acorn";
import { chatImageQueries } from "./chat-resources";

type Scalar = string | number | boolean;
export type WidgetStateValue = Scalar | readonly Scalar[];
type WidgetData = Scalar | readonly WidgetData[] | ReadonlyMap<string, WidgetData>;
type Comparison = "===" | "!==" | ">" | "<" | ">=" | "<=";
type Value = Scalar | { variable: string } | { add: [Value, Value] } | { compare: [Comparison, Value, Value] } | { choose: [Value, Value, Value] } | { fallback: [Value, Value] } | { join: Value[]; separator: string }
  | { not: Value } | { length: Value } | { trim: Value } | { includes: [Value, Value] } | { joinState: Value; separator: string }
  | { array: readonly Value[] } | { record: ReadonlyMap<string, Value> } | { index: [Value, Value] } | { field: [Value, string] };
type Attribute = string | true | { expression: string };
type Element = { tag: string; attributes: Map<string, Attribute>; children: (Element | string)[]; inner: string; start: number; contentStart: number; end: number; source: string };
type State = { setter: string; initial: WidgetStateValue; derived?: Value; loop?: true };
type CompileContext = { values?: ReadonlyMap<string, WidgetStateValue>; remaining: number; dynamic: boolean };

class WidgetScope extends Map<string, State> {
  constructor(initial: ReadonlyMap<string, State>, readonly context: CompileContext, readonly repeatDepth = 0) {
    super(initial);
  }

  snapshot(): ReadonlyMap<string, WidgetStateValue> {
    const values = new Map([...this].map(([name, state]) => [name, state.initial]));
    for (const [name, value] of this.context.values ?? []) {
      if (this.get(name)?.setter) values.set(name, value);
    }
    return values;
  }
}
type Option = { value: string; label: string };
type StateUpdate = { name: string; value: Value };
type WidgetArrayAction = { name: string } & (
  { kind: "toggle"; item: string } |
  { kind: "replace"; index: number; value: Value } |
  { kind: "select"; list: Value; field: string }
);
type Action = { submit: Value } | { submitForm: true } | { reset: string[] } | { adjust: { name: string; change: number; bound: number } }
  | { set: StateUpdate } | { updates: StateUpdate[] } | { array: WidgetArrayAction };
type FieldBinding = { name: string; updates?: StateUpdate[] };
type AstNode = Expression | { type: "PrivateIdentifier"; name: string } | { type: "SpreadElement"; argument: Expression } | { type: "Super" };
type Layout = "box" | "row" | "col" | "grid" | "card" | "title" | "text" | "badge" | "caption" | "grid-item" | "flow-item" | "carousel-item"
  | "label" | "blockquote" | "callout";
type LayoutOptions = { gap?: number; columns?: number; flex?: number; align?: "start" | "center" | "end" | "stretch"; justify?: "start" | "center" | "end" | "between"; border?: boolean; surface?: boolean; background?: Value;
  padding?: number | Partial<Record<"top" | "right" | "bottom" | "left", number>>; radius?: "md" | "lg" | "xl" | "2xl" | "full"; square?: number; height?: string; aspectRatio?: string; color?: Value; size?: string; wrap?: boolean; numeric?: boolean };
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
  "table", "math", "Math", "CodeBlock", "code-block", "label", "blockquote", "callout", "switch", "toggle", "progress", "favicon", "each", "chat-repeat",
];

const mathTags = new Set(["math", "Math"]);
const codeTags = new Set(["CodeBlock", "code-block"]);

export type WidgetNode =
  | { kind: "layout"; variant: Layout; children: WidgetNode[]; options?: LayoutOptions }
  | { kind: "form"; label?: string; action?: Action; submit?: Value; children: WidgetNode[] }
  | { kind: "popover"; label: string; icon?: string; children: WidgetNode[] }
  | { kind: "carousel"; label: string; binding?: string; showArrows: boolean; children: WidgetNode[] }
  | { kind: "pressable"; action: Action; label: string; options: LayoutOptions; children: WidgetNode[]; pressed?: Value; expanded?: Value }
  | { kind: "markdown"; parts: (string | { value: Value })[] }
  | { kind: "icon"; name: Value; size?: string; color?: Value }
  | { kind: "divider" }
  | { kind: "spacer" }
  | { kind: "unsupported"; tag: string; text: string; source?: string }
  | { kind: "svg"; viewBox: string; shapes: SvgShape[] }
  | { kind: "list"; ordered: boolean; connected: boolean; gap?: number; children: Extract<WidgetNode, { kind: "list-item" }>[] }
  | { kind: "list-item"; children: WidgetNode[] }
  | ({ kind: "radio"; label: string; options: Option[]; segmented?: boolean; horizontal?: boolean; numeric?: boolean; block?: boolean; required?: boolean } & FieldBinding)
  | { kind: "checkbox"; name: string; label: string; item?: string; index?: number; switch?: boolean; compact?: boolean }
  | ({ kind: "select"; label: string; options: Option[] } & FieldBinding)
  | ({ kind: "input"; label: string; inputType: "text" | "textarea" | "date" | "number" | "email"; placeholder?: string; required: boolean; maxLength: number; min?: string; max?: string; rows?: number } & FieldBinding)
  | { kind: "slider"; name: string; min: number; max: number; step: number }
  | { kind: "chart"; chartType: "bar" | "line" | "pie" | "scatter"; rows: ChartRow[]; series: string[]; label: string; description?: string; min?: number; filter?: Value }
  | { kind: "condition"; test: Value; children: WidgetNode[]; fallback: WidgetNode[] }
  | { kind: "link"; label: string; href?: string; ref?: string; product?: boolean }
  | { kind: "resource"; resourceType: "product"; ref?: string; label: string }
  | WidgetImage
  | { kind: "map"; label: string; markers: WidgetMarker[] }
  | { kind: "video"; label: string; src?: string }
  | { kind: "table"; label?: string; children: Extract<WidgetNode, { kind: "table-row" }>[]; unsupportedRepeats?: Extract<WidgetNode, { kind: "unsupported" }>[] }
  | { kind: "table-row"; children: Extract<WidgetNode, { kind: "table-cell" }>[] }
  | { kind: "table-cell"; children: WidgetNode[]; align?: string; width?: number }
  | { kind: "math"; latex: string; inline: boolean }
  | { kind: "code"; source: string; language?: string }
  | { kind: "progress"; value: Value; max: number; label: string }
  | { kind: "button"; children: WidgetNode[]; action: Action; label?: string; color?: Value; style?: Value; disabled?: Value; loading?: Value; block?: boolean; uniform?: boolean; size?: string };

export type ChatWidget = { root: WidgetNode; initial: Map<string, WidgetStateValue>; form: boolean; explicitForm: boolean;
  compileForState?: (values: ReadonlyMap<string, WidgetStateValue>) => WidgetNode };

function isDataArray(value: WidgetData): value is readonly WidgetData[] {
  return Array.isArray(value);
}

function isDataRecord(value: WidgetData): value is ReadonlyMap<string, WidgetData> {
  return typeof value === "object" && !isDataArray(value);
}

function stateValue(value: WidgetData): WidgetStateValue | undefined {
  if (typeof value !== "object") return value;
  return isDataArray(value) && value.every((part): part is Scalar => typeof part !== "object") ? value : undefined;
}

function dataExpression(value: WidgetData): Value {
  if (isDataArray(value)) return { array: value.map(dataExpression) };
  if (isDataRecord(value)) return { record: new Map([...value].map(([key, part]) => [key, dataExpression(part)])) };
  return value;
}

function evaluateData(value: Value, state: ReadonlyMap<string, WidgetStateValue>, onRead?: (name: string) => void): WidgetData {
  let remaining = 4096;
  function evaluate(value: Value, depth: number): WidgetData {
    if (--remaining < 0 || depth > 64) return "";
    if (typeof value !== "object") return value;
    if ("variable" in value) {
      onRead?.(value.variable);
      return state.get(value.variable) ?? "";
    }
    if ("array" in value) return value.array.map((part) => evaluate(part, depth + 1));
    if ("record" in value) return new Map([...value.record].map(([key, part]) => [key, evaluate(part, depth + 1)]));
    if ("field" in value) {
      const record = evaluate(value.field[0], depth + 1);
      return isDataRecord(record) ? record.get(value.field[1]) ?? "" : "";
    }
    if ("index" in value) {
      const sequence = evaluate(value.index[0], depth + 1);
      const index = evaluate(value.index[1], depth + 1);
      if (isDataRecord(sequence) && typeof index === "string") return sequence.get(index) ?? "";
      return isDataArray(sequence) && typeof index === "number" && Number.isInteger(index) && index >= 0 ? sequence[index] ?? "" : "";
    }
    if ("trim" in value) {
      const text = evaluate(value.trim, depth + 1);
      return typeof text === "string" ? text.trim() : text;
    }
    if ("not" in value) return !evaluate(value.not, depth + 1);
    if ("length" in value) {
      const sequence = evaluate(value.length, depth + 1);
      return typeof sequence === "string" || Array.isArray(sequence) ? sequence.length : 0;
    }
    if ("includes" in value) {
      const collection = evaluate(value.includes[0], depth + 1);
      const item = evaluate(value.includes[1], depth + 1);
      return isDataArray(collection) && typeof item !== "object" && collection.includes(item);
    }
    if ("joinState" in value) {
      const collection = evaluate(value.joinState, depth + 1);
      const parts = stateValue(collection);
      return Array.isArray(parts) ? parts.join(value.separator) : "";
    }
    if ("choose" in value) return evaluate(evaluate(value.choose[0], depth + 1) ? value.choose[1] : value.choose[2], depth + 1);
    if ("fallback" in value) return evaluate(value.fallback[0], depth + 1) || evaluate(value.fallback[1], depth + 1);
    if ("join" in value) return value.join.map((item) => stateValue(evaluate(item, depth + 1))).filter(Boolean).join(value.separator);
    if ("compare" in value) {
      const [operator, first, second] = value.compare;
      const left = evaluate(first, depth + 1);
      const right = evaluate(second, depth + 1);
      if (operator === "===") return left === right;
      if (operator === "!==") return left !== right;
      if (typeof left !== "number" || typeof right !== "number") return false;
      if (operator === ">") return left > right;
      if (operator === "<") return left < right;
      if (operator === ">=") return left >= right;
      return left <= right;
    }
    const left = evaluate(value.add[0], depth + 1);
    const right = evaluate(value.add[1], depth + 1);
    return typeof left === "number" && typeof right === "number" ? left + right
      : (String(stateValue(left) ?? "") + String(stateValue(right) ?? "")).slice(0, 30000);
  }
  return evaluate(value, 0);
}

export function widgetValue(value: Value, state: ReadonlyMap<string, WidgetStateValue>): WidgetStateValue {
  return stateValue(evaluateData(value, state)) ?? "";
}

export function applyWidgetArrayAction(action: WidgetArrayAction, state: ReadonlyMap<string, WidgetStateValue>): WidgetStateValue | undefined {
  const current = state.get(action.name);
  if (!Array.isArray(current) || current.length > 40) return undefined;
  if (action.kind === "replace") {
    const replacement = evaluateData(action.value, state);
    if (typeof replacement === "object" || typeof current[action.index] !== typeof replacement
      || (typeof replacement === "number" && !Number.isFinite(replacement))) return undefined;
    return current.map((item, index) => index === action.index ? replacement : item);
  }
  if (current.some((item) => typeof item !== "string")) return undefined;
  if (action.kind === "toggle") {
    if (current.includes(action.item)) return current.filter((item) => item !== action.item);
    return current.length < 40 ? [...current, action.item] : undefined;
  }
  const list = evaluateData(action.list, state);
  if (!isDataArray(list) || list.length > 40) return undefined;
  const items = list.map((row) => isDataRecord(row) ? row.get(action.field) : undefined);
  return items.every((item): item is string => typeof item === "string" && item.length <= 500)
    ? [...new Set(items)] : undefined;
}

function readBraces(source: string, from: number): number | undefined {
  let depth = 0;
  let quote = "";
  for (let index = from; index < Math.min(source.length, from + 16384); index++) {
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
  const element = (inner: string, end: number, contentStart: number): Element => ({
    tag, attributes, children, inner, start: from, contentStart, end, source: source.slice(from, Math.min(end, from + 2000)),
  });
  while (cursor < source.length) {
    endTag.lastIndex = cursor;
    const end = endTag.exec(source);
    if (end) {
      cursor = endTag.lastIndex;
      if (end[1]) return element("", cursor, cursor);
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
        const keyword = /^(?:[A-Za-z_$][\w$-]*|\d+)(?=[\s/>])/.exec(source.slice(cursor));
        const repeatAttribute = ["each", "chat-repeat"].includes(tag) && ["alias", "as", "index", "values", "items", "of", "in"].includes(name);
        if (!keyword || (!repeatAttribute && !["align", "justify", "flex", "marker", "connector", "layout"].includes(name))) return undefined;
        attributes.set(name, keyword[0]);
        cursor += keyword[0].length;
      }
    }
  }

  const start = cursor;
  const closing = new RegExp(`</${tag}\\s*>`, "y");
  if (mathTags.has(tag) || codeTags.has(tag)) {
    const close = new RegExp(closing.source, "g");
    close.lastIndex = start;
    const match = close.exec(source);
    return match ? element(source.slice(start, match.index), close.lastIndex, start) : undefined;
  }
  const nextTag = /\{|<(\/?)([A-Za-z][\w-]*)(?=[\s/>])/g;
  let steps = 0;
  nextTag.lastIndex = cursor;
  for (let next = nextTag.exec(source); next; next = nextTag.exec(source)) {
    if (++steps > 4000) return undefined;
    if (next[0] === "{") {
      const end = readBraces(source, next.index);
      if (end !== undefined) nextTag.lastIndex = end;
      continue;
    }
    if (next.index > cursor) children.push(source.slice(cursor, next.index));
    if (next[1]) {
      closing.lastIndex = next.index;
      if (!closing.test(source)) return undefined;
      return element(source.slice(start, next.index), closing.lastIndex, start);
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
    const tail = source.slice(node.end).trim();
    if (!tail) return node;
    if (!/^[\s)]+$/.test(tail)) return undefined;
    const wrapped = parseExpressionAt(source, 0, { ecmaVersion: 2020, preserveParens: true });
    return source.slice(wrapped.end).trim() === "" ? node : undefined;
  } catch {
    return undefined;
  }
}

function isSafeField(key: unknown): key is string {
  return typeof key === "string" && /^[A-Za-z_$][\w$-]{0,80}$/.test(key) && !["__proto__", "prototype", "constructor"].includes(key);
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
  if (node.type === "ArrayExpression") {
    if (node.elements.length > 40) return undefined;
    const array = node.elements.map((item) => valueExpression(item, states, depth + 1));
    return array.every((item): item is Value => item !== undefined && (typeof item !== "string" || item.length <= 500)) ? { array } : undefined;
  }
  if (node.type === "ObjectExpression") {
    if (node.properties.length > 20) return undefined;
    const record = new Map<string, Value>();
    for (const property of node.properties) {
      if (property.type !== "Property" || property.computed || property.method || property.kind !== "init") return undefined;
      const key = property.key.type === "Identifier" ? property.key.name : property.key.type === "Literal" ? property.key.value : undefined;
      const value = valueExpression(property.value, states, depth + 1);
      if (!isSafeField(key) || record.has(key) || value === undefined || (typeof value === "string" && value.length > 500)) return undefined;
      record.set(key, value);
    }
    return { record };
  }
  if (node.type === "MemberExpression" && node.computed && !node.optional) {
    const collection = valueExpression(node.object, states, depth + 1);
    const index = valueExpression(node.property, states, depth + 1);
    if (collection === undefined || index === undefined || (typeof index === "string" && !isSafeField(index))) return undefined;
    if (typeof collection === "object" && "array" in collection && typeof index === "number") {
      return Number.isInteger(index) && index >= 0 ? collection.array[index] ?? "" : "";
    }
    return { index: [collection, index] };
  }
  if (node.type === "MemberExpression" && !node.computed && !node.optional && node.property.type === "Identifier") {
    const key = node.property.name;
    const target = valueExpression(node.object, states, depth + 1);
    if (target === undefined || !isSafeField(key)) return undefined;
    if (typeof target === "object" && "record" in target) return target.record.get(key);
    if (key === "length") return { length: target };
    return { field: [target, key] };
  }
  if (memberCall(node, "includes") && node.arguments.length === 1) {
    const collection = valueExpression(node.callee.object, states, depth + 1);
    const item = valueExpression(node.arguments[0], states, depth + 1);
    return collection === undefined || item === undefined ? undefined : { includes: [collection, item] };
  }
  if (memberCall(node, "trim") && !node.arguments.length) {
    const text = valueExpression(node.callee.object, states, depth + 1);
    return text === undefined ? undefined : { trim: text };
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
    if (filter.type === "Identifier" && Array.isArray(states.get(filter.name)?.initial)) {
      return { joinState: states.get(filter.name)?.derived ?? { variable: filter.name }, separator };
    }
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

function attrValue(element: Element, name: string, states: Map<string, State>): Value | undefined {
  const attr = element.attributes.get(name);
  if (typeof attr === "object") return valueExpression(parseExpression(attr.expression), states);
  if (attr === "true" || attr === "false") return attr === "true";
  return attr;
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

function numericSelectBinding(element: Element, states: Map<string, State>): string | undefined {
  const value = parseExpression(attrExpression(element, "value"));
  const change = parseExpression(attrExpression(element, "onChange"));
  if (!setterCall(value) || value.callee.name !== "String" || value.arguments[0].type !== "Identifier"
    || !simpleParameter(change) || !setterCall(change.body)) return undefined;
  const name = value.arguments[0].name;
  const state = states.get(name);
  const converted = change.body.arguments[0];
  return typeof state?.initial === "number" && change.body.callee.name === state.setter
    && setterCall(converted) && converted.callee.name === "Number" && isIdentifier(converted.arguments[0], change.params[0].name)
    ? name : undefined;
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

function isRepeat(element: Element): boolean {
  return element.tag === "chat-repeat" || element.tag === "each";
}

function repeatBindings(element: Element, states: WidgetScope): WidgetScope[] | undefined {
  const alias = attrString(element, "alias") ?? attrString(element, "as") ?? (element.tag === "each" ? "item" : undefined);
  const indexName = attrText(element, "index");
  const source = ["values", "items", "of", "in"].map((name) => attrExpression(element, name) ?? attrText(element, name)).find((attr) => attr !== undefined);
  const value = valueExpression(parseExpression(source), states);
  if (!alias || !/^[A-Za-z_$][\w$]*$/.test(alias) || (indexName && !/^[A-Za-z_$][\w$]*$/.test(indexName)) || value === undefined
    || states.has(alias) || (indexName && (states.has(indexName) || indexName === alias))
    || states.repeatDepth >= 3) return undefined;
  const rows = evaluateData(value, states.snapshot(), (name) => {
    if (states.get(name)?.setter) states.context.dynamic = true;
  });
  if (!isDataArray(rows) || rows.length > 40 || rows.length > states.context.remaining) return undefined;
  states.context.remaining -= rows.length;
  const entries: WidgetScope[] = [];
  for (const [index, row] of rows.entries()) {
    const binding = new WidgetScope(states, states.context, states.repeatDepth + 1);
    binding.set(alias, { setter: "", initial: stateValue(row) ?? "", derived: dataExpression(row), loop: true });
    if (indexName) binding.set(indexName, { setter: "", initial: index, derived: index, loop: true });
    entries.push(binding);
  }
  return entries;
}

function option(element: Element, states: Map<string, State>): Option | undefined {
  if (!["radio", "segment", "option", "item"].includes(element.tag) || element.children.some((part) => typeof part !== "string")) return undefined;
  const value = attrString(element, "value", states);
  const body = element.inner.trim();
  const literal = /^\{\s*([\w$]+)\s*\}$/.exec(body);
  const label = attrString(element, "label", states) ?? (literal ? states.get(literal[1])?.derived : body);
  return value && typeof label === "string" && label.trim() ? { value, label } : undefined;
}

function parseOptions(element: Element, states: WidgetScope): Option[] | undefined {
  if (element.attributes.has("options")) return parseOptionArray(element);
  const options: Option[] = [];
  for (const child of element.children) {
    if (typeof child === "string" && !child.trim()) continue;
    if (typeof child === "string") return undefined;
    if (isRepeat(child)) {
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

function setterCall(node: AstNode | BlockStatement | null | undefined): node is Extract<Expression, { type: "CallExpression" }> & { callee: Extract<Expression, { type: "Identifier" }> } {
  return node?.type === "CallExpression" && !node.optional && node.callee.type === "Identifier" && node.arguments.length === 1;
}

function simpleParameter(node: AstNode | null | undefined): node is Extract<Expression, { type: "ArrowFunctionExpression" }> & { params: [Extract<Expression, { type: "Identifier" }>] } {
  return node?.type === "ArrowFunctionExpression" && !node.async && node.params.length === 1 && node.params[0].type === "Identifier";
}

function indexedCheckbox(element: Element, states: Map<string, State>): { name: string; index: number } | undefined {
  const checked = parseExpression(attrExpression(element, "checked"));
  const change = parseExpression(attrExpression(element, "onChange"));
  if (checked?.type !== "MemberExpression" || !checked.computed || checked.optional || checked.object.type !== "Identifier"
    || !simpleParameter(change) || !setterCall(change.body)) return undefined;
  const name = checked.object.name;
  const state = states.get(name);
  const index = valueExpression(checked.property, states);
  const update = change.body.arguments[0];
  if (typeof index !== "number" || !Number.isInteger(index) || !Array.isArray(state?.initial) || typeof state.initial[index] !== "boolean"
    || change.body.callee.name !== state.setter || !simpleParameter(update) || update.body.type === "BlockStatement" || !memberCall(update.body, "map")
    || !isIdentifier(update.body.callee.object, update.params[0].name) || update.body.arguments.length !== 1) return undefined;
  const mapper = update.body.arguments[0];
  if (mapper.type !== "ArrowFunctionExpression" || mapper.async || mapper.params.length !== 2
    || mapper.params[0].type !== "Identifier" || mapper.params[1].type !== "Identifier" || mapper.body.type !== "ConditionalExpression"
    || mapper.body.test.type !== "BinaryExpression" || mapper.body.test.operator !== "==="
    || !isIdentifier(mapper.body.consequent, change.params[0].name) || !isIdentifier(mapper.body.alternate, mapper.params[0].name)) return undefined;
  const { left, right } = mapper.body.test;
  const position = mapper.params[1].name;
  return (isIdentifier(left, position) && valueExpression(right, states) === index)
    || (isIdentifier(right, position) && valueExpression(left, states) === index) ? { name, index } : undefined;
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
  const visible = new Map(states);
  visible.delete(old);
  visible.delete(change.params[0].name);
  return appendedItem(append, old, visible) === item && removedItem(filter, old, visible) === item ? { name, item } : undefined;
}

function appendedItem(node: AstNode | null | undefined, collection: string, states: Map<string, State>): Value | undefined {
  if (node?.type !== "ArrayExpression" || node.elements.length !== 2 || node.elements[0]?.type !== "SpreadElement"
    || !isIdentifier(node.elements[0].argument, collection)) return undefined;
  return valueExpression(node.elements[1], states);
}

function removedItem(filter: AstNode | null | undefined, old: string, states: Map<string, State>): Value | undefined {
  if (!memberCall(filter, "filter") || !isIdentifier(filter.callee.object, old) || filter.arguments.length !== 1) return undefined;
  const predicate = filter.arguments[0];
  if (!simpleParameter(predicate) || predicate.body.type !== "BinaryExpression" || predicate.body.operator !== "!=="
    || !isIdentifier(predicate.body.left, predicate.params[0].name)) return undefined;
  const visible = new Map(states);
  visible.delete(old);
  visible.delete(predicate.params[0].name);
  return valueExpression(predicate.body.right, visible);
}

function arrayAction(target: string, argument: AstNode | undefined, states: Map<string, State>): WidgetArrayAction | undefined {
  const initial = states.get(target)?.initial;
  if (!Array.isArray(initial)) return undefined;
  const isStringCollection = initial.every((item) => typeof item === "string");
  if (isStringCollection && memberCall(argument, "map") && argument.arguments.length === 1) {
    const mapper = argument.arguments[0];
    const list = valueExpression(argument.callee.object, states);
    if (!simpleParameter(mapper) || mapper.body.type !== "MemberExpression" || mapper.body.computed || mapper.body.optional
      || !isIdentifier(mapper.body.object, mapper.params[0].name) || mapper.body.property.type !== "Identifier"
      || !isSafeField(mapper.body.property.name) || list === undefined) return undefined;
    const field = mapper.body.property.name;
    const action = { name: target, kind: "select", list, field } as const;
    const snapshot = new Map([...states].map(([name, state]) => [name, state.initial]));
    return applyWidgetArrayAction(action, snapshot) !== undefined ? action : undefined;
  }
  if (!simpleParameter(argument) || argument.body.type === "BlockStatement") return undefined;
  const old = argument.params[0].name;
  const visible = new Map(states);
  visible.delete(old);
  const body = argument.body;
  if (isStringCollection && body.type === "ConditionalExpression" && memberCall(body.test, "includes")
    && isIdentifier(body.test.callee.object, old) && body.test.arguments.length === 1) {
    const item = valueExpression(body.test.arguments[0], visible);
    if (typeof item === "string" && item === appendedItem(body.alternate, old, visible) && item === removedItem(body.consequent, old, visible)) {
      return { name: target, kind: "toggle", item };
    }
  }
  if (!memberCall(body, "map") || !isIdentifier(body.callee.object, old) || body.arguments.length !== 1) return undefined;
  const mapper = body.arguments[0];
  if (mapper.type !== "ArrowFunctionExpression" || mapper.async || mapper.params.length !== 2 || mapper.params[0].type !== "Identifier"
    || mapper.params[1].type !== "Identifier" || mapper.body.type !== "ConditionalExpression"
    || mapper.body.test.type !== "BinaryExpression" || mapper.body.test.operator !== "==="
    || !isIdentifier(mapper.body.alternate, mapper.params[0].name)) return undefined;
  const position = mapper.params[1].name;
  visible.delete(mapper.params[0].name);
  visible.delete(position);
  const { left, right } = mapper.body.test;
  const index = valueExpression(isIdentifier(left, position) ? right : isIdentifier(right, position) ? left : undefined, visible);
  const value = valueExpression(mapper.body.consequent, visible);
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= 40 || value === undefined) return undefined;
  return { name: target, kind: "replace", index, value };
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
      if (!state) return undefined;
      if (Array.isArray(state[1].initial)) {
        const array = arrayAction(state[0], body.arguments[0], states);
        return array ? { array } : undefined;
      }
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
  const updates = parseStateUpdates(body.body, states);
  if (!updates) return undefined;
  return updates.every(({ name, value }) => typeof value !== "object" && value === states.get(name)?.initial)
    ? { reset: updates.map(({ name }) => name) } : { updates };
}

function parseStateUpdates(statements: BlockStatement["body"], states: Map<string, State>): StateUpdate[] | undefined {
  if (statements.length > 12) return undefined;
  const updates: StateUpdate[] = [];
  const initial = new Map([...states].map(([name, state]) => [name, state.initial]));
  for (const statement of statements) {
    const call = statement.type === "ExpressionStatement" ? statement.expression : undefined;
    if (!setterCall(call)) return undefined;
    const target = [...states].find(([, entry]) => entry.setter === call.callee.name);
    const value = valueExpression(call.arguments[0], states);
    if (!target || value === undefined || Array.isArray(target[1].initial)
      || typeof widgetValue(value, initial) !== typeof target[1].initial) return undefined;
    updates.push({ name: target[0], value });
  }
  return updates;
}

function fieldBinding(element: Element, states: Map<string, State>): FieldBinding | undefined {
  const direct = stateBinding(element, states);
  if (direct) return { name: direct };
  const name = attrExpression(element, "value")?.trim();
  if (!name) return undefined;
  const change = parseExpression(attrExpression(element, "onChange") ?? attrExpression(element, "onInput") ?? attrExpression(element, "onValueChange"));
  if (!simpleParameter(change)) return undefined;
  const statements = change.body.type === "BlockStatement" ? change.body.body : undefined;
  const first = statements?.[0];
  const call = first ? (first.type === "ExpressionStatement" ? first.expression : undefined) : change.body;
  if (!setterCall(call) || call.callee.name !== states.get(name)?.setter || !isIdentifier(call.arguments[0], change.params[0].name)) return undefined;
  const visible = new Map(states);
  visible.delete(change.params[0].name);
  const updates = statements ? parseStateUpdates(statements.slice(1), visible) : undefined;
  if (statements && !updates) return undefined;
  return { name, updates };
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
  for (const [start, end] of bracedRanges(text)) {
    const value = valueExpression(parseExpression(text.slice(start + 1, end - 1)), states);
    if (value === undefined) continue;
    parts.push(text.slice(cursor, start), { value });
    cursor = end;
  }
  parts.push(text.slice(cursor));
  return { kind: "markdown", parts };
}

function compileChildren(element: Element, states: WidgetScope): WidgetNode[] | undefined {
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
      const raw = child.trim();
      if (raw && states.repeatDepth && states.context.remaining-- <= 0) return undefined;
      const declarations = readDeclarations(raw, states, true);
      if (!declarations.valid) return undefined;
      const text = declarations.text.trim();
      if (!text) continue;
      const next = segments[index + 1];
      if (next && typeof next !== "string" && ["radio-group", "select", "input", "text-input", "textarea", "date-picker", "segmented-control", "segmented"].includes(next.tag)) {
        label = text.replace(/^\*\*([^*]+)\*\*$/, "$1");
      } else {
        children.push(compileText(text, states));
      }
    } else {
      if (child.tag === "label") {
        const next = segments.slice(index + 1).find((part) => typeof part !== "string" || part.trim());
        if (typeof next === "object" && ["input", "text-input", "textarea", "text-area", "select", "date", "date-picker"].includes(next.tag)) {
          label = child.inner.trim();
          continue;
        }
      }
      if (isRepeat(child)) {
        const repeated = compileRepeat(child, states);
        if (repeated) children.push(...repeated);
        else children.push({ kind: "unsupported", tag: "each", text: child.inner, source: child.source });
        label = "";
        continue;
      }
      const node = compileNode(child, states, label);
      const previous = children.at(-1);
      if (node?.kind === "condition" && previous?.kind === "pressable" && previous.expanded === undefined
        && togglesCondition(previous.action, node.test)) {
        previous.expanded = node.test;
        previous.pressed = undefined;
      }
      children.push(node ?? { kind: "unsupported", tag: child.tag, text: child.inner, source: child.source });
      label = "";
    }
  }
  return children;
}

function compileRepeat(element: Element, states: WidgetScope): WidgetNode[] | undefined {
  const bindings = repeatBindings(element, states);
  if (!bindings) return undefined;
  const children: WidgetNode[] = [];
  for (const binding of bindings) {
    if (states.context.remaining <= 0) return undefined;
    const repeated = compileChildren(element, binding);
    if (!repeated) return undefined;
    children.push(...repeated);
  }
  return children;
}

function compileInput(element: Element, states: Map<string, State>, label: string): WidgetNode | undefined {
  const binding = fieldBinding(element, states);
  const inputType = element.tag === "textarea" || element.tag === "text-area" ? "textarea"
    : element.tag === "date-picker" || element.tag === "date" ? "date"
      : attrString(element, "inputType") ?? attrString(element, "type") ?? "text";
  if (inputType !== "text" && inputType !== "textarea" && inputType !== "date" && inputType !== "number" && inputType !== "email") return undefined;
  if (!binding) return undefined;
  const initial = states.get(binding.name)?.initial;
  if (typeof initial !== "string" && !(inputType === "number" && typeof initial === "number")) return undefined;
  const maxLength = Math.max(1, Math.min(4000, Math.trunc(attrNumber(element, "maxLength") ?? 1000)));
  const date = /^\d{4}-\d{2}-\d{2}$/;
  const min = attrString(element, "min");
  const max = attrString(element, "max");
  return {
    kind: "input", ...binding, inputType, label: label || attrString(element, "label") || (inputType === "date" ? "选择日期" : "输入内容"),
    required: attrBoolean(element, "required") ?? false, placeholder: attrString(element, "placeholder"),
    maxLength, rows: inputType === "textarea" ? Math.max(2, Math.min(12, Math.trunc(attrNumber(element, "rows") ?? 3))) : undefined,
    min: inputType === "number" ? attrNumber(element, "min")?.toString() : min && date.test(min) ? min : undefined,
    max: inputType === "number" ? attrNumber(element, "max")?.toString() : max && date.test(max) ? max : undefined,
  };
}

function layoutOptions(element: Element, states = new Map<string, State>()): LayoutOptions {
  const align = attrString(element, "align");
  const justify = attrString(element, "justify");
  const gap = attrNumber(element, "gap");
  const columns = attrNumber(element, "columns");
  const flex = attrNumber(element, "flex");
  const padding = attrNumber(element, "padding");
  const paddingRecord = parseExpression(attrExpression(element, "padding"));
  const sides: Exclude<LayoutOptions["padding"], number | undefined> = {};
  if (paddingRecord?.type === "ObjectExpression") {
    for (const side of ["top", "right", "bottom", "left"] as const) {
      const value = valueExpression(property(paddingRecord, side), states);
      if (typeof value === "number") sides[side] = Math.min(24, Math.max(0, value * 4));
    }
  }
  const radius = attrString(element, "radius");
  const size = attrString(element, "size");
  const square = size && /^([1-9]\d{0,2})px$/.exec(size);
  const height = attrString(element, "height") ?? attrString(element, "minHeight");
  const ratio = ratioAttribute(element);
  return {
    gap: gap === undefined ? undefined : Math.min(24, Math.max(0, gap * 4)),
    columns: columns === undefined ? undefined : Math.max(1, Math.min(4, Math.floor(columns))),
    flex: flex === undefined || flex <= 0 ? undefined : Math.min(8, flex),
    align: align === "start" || align === "center" || align === "end" || align === "stretch" ? align : undefined,
    justify: justify === "start" || justify === "center" || justify === "end" || justify === "between" ? justify : undefined,
    border: attrBoolean(element, "border"),
    surface: attrString(element, "background") === "surface-secondary" || undefined,
    background: attrValue(element, "background", states),
    padding: padding === undefined ? (Object.keys(sides).length > 0 ? sides : undefined) : Math.min(24, Math.max(0, padding * 4)),
    radius: radius === "md" || radius === "lg" || radius === "xl" || radius === "2xl" || radius === "full" ? radius : undefined,
    square: square ? Math.min(160, Number(square[1])) : undefined,
    height: height === "100%" || (height && /^[1-9]\d{0,2}px$/.test(height) && parseInt(height, 10) <= 480) ? height : undefined,
    aspectRatio: ratio,
    size,
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

function rawContent(element: Element, names: string[], states: Map<string, State>): string {
  for (const name of names) {
    const attribute = attrText(element, name);
    if (attribute !== undefined) return attribute;
    const expression = parseExpression(attrExpression(element, name));
    if (expression?.type === "TemplateLiteral" && !expression.expressions.length) {
      return expression.quasis[0].value.cooked ?? "";
    }
    if (expression?.type === "TaggedTemplateExpression" && !expression.quasi.expressions.length
      && expression.tag.type === "MemberExpression" && !expression.tag.computed && !expression.tag.optional
      && isIdentifier(expression.tag.object, "String") && isIdentifier(expression.tag.property, "raw")) {
      return expression.quasi.quasis[0].value.raw;
    }
    const value = valueExpression(expression, states);
    if (typeof value === "string") return value;
  }
  const body = codeTags.has(element.tag) ? element.inner.replace(/^\r?\n|\r?\n[ \t]*$/g, "") : element.inner.trim();
  const expression = /^\{([\s\S]*)\}$/.exec(body);
  if (expression) {
    const value = valueExpression(parseExpression(expression[1]), states);
    if (typeof value === "string") return value;
  }
  return body;
}

function togglesCondition(action: Action, test: Value): boolean {
  if (!("set" in action) || typeof test !== "object" || typeof action.set.value !== "object") return false;
  const { name, value } = action.set;
  if ("variable" in test) return test.variable === name && "not" in value && typeof value.not === "object"
    && "variable" in value.not && value.not.variable === name;
  if (!("compare" in test) || !("choose" in value)) return false;
  const [operator, left, right] = test.compare;
  const compared = value.choose[0];
  const isBinding = (part: Value) => typeof part === "object" && "variable" in part && part.variable === name;
  return operator === "===" && isBinding(left) && typeof right !== "object" && typeof compared === "object" && "compare" in compared
    && compared.compare[0] === operator && isBinding(compared.compare[1]) && compared.compare[2] === right && value.choose[2] === right
    && typeof value.choose[1] !== "object" && value.choose[1] !== right;
}

function pressableLabel(nodes: WidgetNode[], values: ReadonlyMap<string, WidgetStateValue>): string {
  for (const node of nodes) {
    if (node.kind === "markdown") {
      const text = node.parts.map((part) => typeof part === "string" ? part : String(widgetValue(part.value, values))).join("")
        .replace(/[*_\x60]/g, "").trim();
      if (text) return text.slice(0, 160);
    }
    if (node.kind === "layout" && !["badge", "caption"].includes(node.variant)) {
      const label = pressableLabel(node.children, values);
      if (label) return label;
    }
  }
  return "";
}

function compileNode(element: Element, states: WidgetScope, label = ""): WidgetNode | undefined {
  if (states.repeatDepth && states.context.remaining-- <= 0) return undefined;
  const tag = element.tag;
  switch (tag) {
    case "each":
    case "chat-repeat": {
      const children = compileRepeat(element, states);
      return children ? { kind: "layout", variant: "col", children } : undefined;
    }
    case "radio-group":
    case "segmented-control":
    case "segmented": {
      const numericBinding = tag === "radio-group" ? undefined : numericSelectBinding(element, states);
      const binding = fieldBinding(element, states) ?? (numericBinding ? { name: numericBinding } : undefined);
      const options = parseOptions(element, states);
      if (!binding || !options?.length || options.length > 40) return undefined;
      const values = new Set(options.map((option) => option.value));
      const initial = states.get(binding.name)?.initial;
      const segmented = tag !== "radio-group";
      if (values.size !== options.length || (numericBinding
        ? !values.has(String(initial)) || options.some(({ value }) => value === "" || !Number.isFinite(Number(value)) || String(Number(value)) !== value)
        : typeof initial !== "string" || (segmented && !values.has(initial)))) return undefined;
      return { kind: "radio", ...binding, label: label || attrString(element, "label") || "请选择", options, segmented,
        required: !segmented && typeof initial === "string" && !values.has(initial),
        horizontal: attrString(element, "direction") === "row", numeric: Boolean(numericBinding), block: attrBoolean(element, "block") };
    }
    case "switch":
    case "toggle":
    case "checkbox": {
      const name = stateBinding(element, states, "checked") ?? (tag === "checkbox" ? undefined : stateBinding(element, states));
      const collection = collectionCheckbox(element, states);
      const indexed = indexedCheckbox(element, states);
      const text = /^\{([^{}]+)\}$/.exec(element.inner.trim());
      const explicitLabel = attrString(element, "label", states);
      const label = explicitLabel ?? (text ? valueExpression(parseExpression(text[1]), states) : element.inner.trim() || collection?.item);
      if (typeof label !== "string" || !label || element.children.some((child) => typeof child !== "string")) return undefined;
      const binding = collection ?? indexed;
      if (binding) return { kind: "checkbox", ...binding, label, compact: Boolean(collection && !explicitLabel && !element.inner.trim()) };
      return name && typeof states.get(name)?.initial === "boolean" ? { kind: "checkbox", name, label, switch: tag !== "checkbox" } : undefined;
    }
    case "select": {
      const binding = fieldBinding(element, states);
      const options = parseOptions(element, states);
      if (!binding || !options || options.length > 40) return undefined;
      if (!options.some((option) => option.value === states.get(binding.name)?.initial)) return undefined;
      return { kind: "select", ...binding, label: label || attrText(element, "label") || "请选择", options };
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
    case "table": {
      const children = compileChildren(element, states);
      if (!children?.length) return undefined;
      const rows: Extract<WidgetNode, { kind: "table-row" }>[] = [];
      const unsupportedRepeats: Extract<WidgetNode, { kind: "unsupported" }>[] = [];
      for (const child of children) {
        if (child.kind === "table-row") rows.push(child);
        else if (child.kind === "unsupported" && child.tag === "each") unsupportedRepeats.push(child);
        else return undefined;
      }
      if (!rows.length || !rows.every((row) => row.children.length === rows[0].children.length)) return undefined;
      return { kind: "table", label: attrString(element, "label"), children: rows,
        ...(unsupportedRepeats.length ? { unsupportedRepeats } : {}) };
    }
    case "table-row": {
      const children = compileChildren(element, states);
      if (!children?.length || children.length > 20 || !children.every((child): child is Extract<WidgetNode, { kind: "table-cell" }> => child.kind === "table-cell")) return undefined;
      return { kind: "table-row", children };
    }
    case "table-cell": {
      const children = compileChildren(element, states);
      const align = attrString(element, "align");
      const width = /^(\d{1,2}|100)%$/.exec(attrString(element, "width") ?? "");
      return children ? { kind: "table-cell", children, align: align === "center" || align === "end" ? align : undefined, width: width ? Number(width[1]) : undefined } : undefined;
    }
    case "Math":
    case "math": {
      const latex = rawContent(element, ["latex", "tex", "expression", "formula", "content", "value"], states).trim()
        .replace(/^\$\$([\s\S]+)\$\$$|^\$([^$\n]+)\$$|^\\\[([\s\S]+)\\\]$|^\\\(([^\n]+)\\\)$/, (_, a, b, c, d) => a ?? b ?? c ?? d).trim();
      return latex && latex.length <= 8000 ? { kind: "math", latex, inline: attrBoolean(element, "inline") === true || attrBoolean(element, "display") === false } : undefined;
    }
    case "CodeBlock":
    case "code-block": {
      const source = rawContent(element, ["code", "content", "text", "value"], states);
      const language = attrString(element, "language") ?? attrString(element, "lang");
      return source && source.length <= 30000 ? { kind: "code", source, language: language && /^[\w.+-]{1,24}$/.test(language) ? language : undefined } : undefined;
    }
    case "progress": {
      const value = attrValue(element, "value", states);
      const max = attrNumber(element, "max") ?? 100;
      return value !== undefined && max > 0 ? { kind: "progress", value, max, label: attrString(element, "label") ?? "进度" } : undefined;
    }
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
      return { kind: "icon", name: attrValue(element, "name", states) ?? "", size: attrString(element, "size"), color: attrValue(element, "color", states) };
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
      if (element.attributes.has("onSubmit") && !action) return undefined;
      const children = compileChildren(element, states);
      if (!children || children.some((child) => widgetHas(child, (node) => node.kind === "form" || node.kind === "unsupported"))) return undefined;
      return { kind: "form", label: attrString(element, "label"), submit: action && "submit" in action ? action.submit : undefined,
        action: action && !("submit" in action) ? action : undefined, children };
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
      const action = element.attributes.has("onClick") ? parseAction(attrExpression(element, "onClick"), states) : { updates: [] };
      const children = compileChildren(element, states);
      if (!action || !children?.length || children.some((child) => widgetHas(child, (node) =>
        !["layout", "markdown", "icon", "spacer", "divider", "svg", "condition"].includes(node.kind)))) return undefined;
      const label = attrString(element, "label", states) || pressableLabel(children, states.snapshot());
      const options = layoutOptions(element, states);
      const background = options.background;
      const pressed: Value | undefined = typeof background === "object" && "choose" in background ? background.choose[0] : undefined;
      return { kind: "pressable", action, children, label: label || "切换卡片状态", options,
        pressed: attrValue(element, "aria-pressed", states) ?? pressed, expanded: attrValue(element, "aria-expanded", states) ?? attrValue(element, "ariaExpanded", states) };
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
      const action = element.attributes.has("onClick") ? parseAction(handler, states)
        : prompt ? { submit: prompt }
          : attrString(element, "type") === "submit" || attrBoolean(element, "submit") ? { submitForm: true as const }
            : tag === "button" ? { updates: [] } : undefined;
      const children = element.children.length ? compileChildren(element, states) : [compileText(attrString(element, "label") ?? "继续", states)];
      const disabled = attrValue(element, "disabled", states);
      const icon = children?.find((child) => child.kind === "icon");
      const label = attrString(element, "label") ?? (action && "adjust" in action ? `${action.adjust.change > 0 ? "增加" : "减少"} ${action.adjust.name}`
        : children?.every((child) => child.kind === "icon") ? icon?.name : undefined);
      return action && children?.length && children.every((child) => child.kind === "icon" || child.kind === "markdown")
        && (!element.attributes.has("disabled") || disabled !== undefined)
        ? { kind: "button", action, children, color: attrValue(element, "color", states), style: attrValue(element, "variant", states),
          disabled, loading: attrValue(element, "loading", states), block: attrBoolean(element, "block"), uniform: attrBoolean(element, "uniform"),
          size: attrString(element, "size"), label: typeof label === "string" ? label : undefined }
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
    case "label":
    case "blockquote":
    case "callout":
    case "badge": {
      const children = compileChildren(element, states);
      const options = layoutOptions(element, states);
      options.color = attrText(element, "color") ?? valueExpression(parseExpression(attrExpression(element, "color")), states);
      return children ? { kind: "layout", variant: tag === "column" ? "col" : tag === "flow" ? "grid" : tag, options, children } : undefined;
    }
    default:
      return { kind: "unsupported", tag, text: element.inner.slice(0, 2000), source: element.source };
  }
}

type WidgetDirective = { name: string; args: string; start: number; end: number };

function* bracedRanges(text: string): Generator<[number, number]> {
  const opening = /\{/g;
  for (let match = opening.exec(text); match; match = opening.exec(text)) {
    const end = readBraces(text, match.index);
    if (end === undefined) continue;
    yield [match.index, end];
    opening.lastIndex = end;
  }
}

function widgetDirectives(root: Element): WidgetDirective[] {
  const directives: WidgetDirective[] = [];
  function visit(element: Element): void {
    if (mathTags.has(element.tag) || codeTags.has(element.tag)) return;
    let cursor = element.contentStart;
    for (const child of element.children) {
      if (typeof child === "string") {
        for (const [start, end] of bracedRanges(child)) {
          const match = /^(#each|#if|\/each|\/if|:else)(?=\s|$)([\s\S]*)$/.exec(child.slice(start + 1, end - 1));
          if (match) directives.push({ name: match[1], args: match[2].trim(), start: cursor + start, end: cursor + end });
        }
        cursor += child.length;
      } else {
        visit(child);
        cursor = child.end;
      }
    }
  }
  visit(root);
  return directives;
}

function expandLegacySliders(source: string, directives: ReadonlyMap<number, WidgetDirective>): string {
  return source.replace(/\{#each\s+(\[[^\r\n]*\])\s+as\s+([\w$]+)\s*\}([\s\S]*?)\{\/each\}/g, (original, list: string, alias: string, body: string, offset: number) => {
    const opening = directives.get(offset);
    const closing = directives.get(offset + original.length - "{/each}".length);
    if (opening?.name !== "#each" || closing?.name !== "/each") return original;
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
  });
}

function expandElementDirectives(source: string, root: Element): string {
  let directives = widgetDirectives(root).map((directive) => ({
    ...directive, start: directive.start - root.start, end: directive.end - root.start,
  }));
  const original = source.slice(root.start, root.end);
  const expanded = expandLegacySliders(original, new Map(directives.map((directive) => [directive.start, directive])));
  if (expanded !== original) {
    const element = readElement(expanded, 0);
    if (!element) return expanded;
    directives = widgetDirectives(element);
  }

  const parts: string[] = [];
  let cursor = 0;
  for (const { name, args, start, end } of directives) {
    let markup: string | undefined;
    if (name === "#each") {
      const binding = /^([\s\S]+)\s+as\s+([A-Za-z_$][\w$]*)(?:\s*,\s*([A-Za-z_$][\w$]*))?$/.exec(args);
      markup = binding
        ? `<chat-repeat values={${binding[1]}} alias="${binding[2]}"${binding[3] ? ` index="${binding[3]}"` : ""}>`
        : "<chat-repeat>";
    } else if (name === "#if" && args) {
      markup = `<chat-condition test={${args}}>`;
    } else if (!args) {
      markup = name === "/each" ? "</chat-repeat>" : name === "/if" ? "</chat-condition>" : "<chat-otherwise/>";
    }
    if (markup === undefined) continue;
    parts.push(expanded.slice(cursor, start), markup);
    cursor = end;
  }
  parts.push(expanded.slice(cursor));
  return parts.join("");
}

function readDeclarations(source: string, states: Map<string, State>, inline = false): { end: number; valid: boolean; text: string } {
  const lineStarts = /^[\t ]*(?=\{@body[\t ])/gm;
  const mutable = /^const\s*\[\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\]\s*=\s*DIL\.useState\(\s*([\s\S]+?)\s*\)$/;
  const constant = /^const\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]+)$/;
  let cursor = 0;
  let text = "";
  let valid = true;
  while (cursor < source.length) {
    if (inline) {
      lineStarts.lastIndex = cursor;
      const start = lineStarts.exec(source);
      if (!start) break;
      text += source.slice(cursor, start.index);
      cursor = lineStarts.lastIndex;
    }
    if (!source.startsWith("{@body", cursor) || !/\s/.test(source[cursor + 6] ?? "")) {
      if (inline) valid = false;
      break;
    }
    const end = readBraces(source, cursor);
    if (end === undefined) {
      valid = false;
      break;
    }
    const body = source.slice(cursor + 6, end - 1).trim().replace(/;\s*$/, "");
    cursor = end;
    if (!inline) cursor += /^[ \t\r\n]*/.exec(source.slice(cursor))![0].length;
    const state = mutable.exec(body);
    const derived = state ? undefined : constant.exec(body);
    const binding = state?.[1] ?? derived?.[1];
    const setter = state?.[2];
    const value = valueExpression(parseExpression(state?.[3] ?? derived?.[2]), state ? new Map() : states);
    if (!binding || value === undefined || states.size >= 64 || states.has(binding) || [...states.values()].some((state) => state.loop)
      || (setter && (binding === setter || states.has(setter) || [...states.values()].some((state) => state.setter === setter)))) {
      valid = false;
      continue;
    }
    const initial = stateValue(evaluateData(value, new Map([...states].map(([key, state]) => [key, state.initial]))));
    if (state && initial === undefined) {
      valid = false;
      continue;
    }
    states.set(binding, { setter: setter ?? "", initial: initial ?? "", derived: derived ? value : undefined });
  }
  return { end: cursor, valid, text: text + source.slice(cursor) };
}

export function readChatWidget(source: string): { end: number; widget?: ChatWidget } | undefined {
  const prelude = new Map<string, State>();
  const { end: cursor, valid } = readDeclarations(source, prelude);
  const element = readElement(source, cursor);
  if (!element) return undefined;
  const original = source.slice(cursor, element.end);
  const expanded = original.includes("{#each") || original.includes("{#if") ? expandElementDirectives(source, element) : original;
  const display = expanded === original ? element : readElement(expanded, 0);
  if (!valid || !display) return { end: element.end };
  const states = new WidgetScope(prelude, { remaining: 800, dynamic: false });
  let root = compileNode(display, states);
  const initial = new Map([...states].map(([name, state]) => [name, state.initial]));
  if (!root) return { end: element.end };
  let end = element.end;
  let captionNode: WidgetNode | undefined;
  if (root.kind === "carousel" && root.binding) {
    const following = /^[\t ]*\r?\n[\r\n\t ]*/.exec(source.slice(end));
    if (following) {
      const offset = end + following[0].length;
      const caption = readElement(source, offset);
      const suffix = caption && ["caption", "text"].includes(caption.tag) ? caption.inner : source.slice(offset).split(/\r?\n/, 1)[0];
      const fields = [...suffix.matchAll(/\{([^{}\r\n]+)\}/g)];
      if (suffix.length <= 250 && !/^[<#]/.test(suffix) && fields.length && fields.every((field) => valueExpression(parseExpression(field[1]), states) !== undefined)) {
        captionNode = { kind: "layout", variant: "caption", children: [compileText(suffix, states)] };
        root = { kind: "layout", variant: "col", children: [root, captionNode] };
        end = caption && ["caption", "text"].includes(caption.tag) ? caption.end : offset + suffix.length;
      }
    }
  }
  const explicitForm = widgetHas(root, (node) => node.kind === "form");
  const form = explicitForm || widgetHas(root, (node) => node.kind === "radio" || node.kind === "checkbox" || node.kind === "select" || node.kind === "input");
  const initialRoot = root;
  const compileForState = states.context.dynamic && [...states.values()].some((state) => state.setter)
    ? (values: ReadonlyMap<string, WidgetStateValue>): WidgetNode => {
      const next = compileNode(display, new WidgetScope(prelude, { values, remaining: 800, dynamic: false }));
      return next && captionNode ? { kind: "layout", variant: "col", children: [next, captionNode] } : next ?? initialRoot;
    } : undefined;
  return { end, widget: { root, initial, form, explicitForm, compileForState } };
}

export function chatWidgetInlineImages(widget: ChatWidget): WidgetImage[] {
  function collect(node: WidgetNode): WidgetImage[] {
    if (node.kind === "image" && !node.href) return [node];
    if (node.kind === "condition" || node.kind === "popover" || node.kind === "carousel") return [];
    return "children" in node ? node.children.flatMap(collect) : [];
  }
  return collect(widget.root);
}
