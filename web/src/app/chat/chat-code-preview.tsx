import { useMemo } from "react";
import { Parser } from "acorn";
import jsx from "acorn-jsx";
import DOMPurify from "dompurify";
import { ReplyChart, type ReplyChartData } from "./chat-chart";

const jsxParser = Parser.extend(jsx());
const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function literal(node: unknown): string | number | undefined {
  const item = record(node);
  return item.type === "Literal" && (typeof item.value === "string" || typeof item.value === "number") ? item.value : undefined;
}

function jsxStyle(node: Record<string, unknown>): string | undefined {
  if (node.type !== "ObjectExpression" || !Array.isArray(node.properties)) return undefined;
  const styles = [];
  for (const property of node.properties) {
    const entry = record(property);
    const name = record(entry.key).name;
    const value = literal(entry.value);
    if (entry.type !== "Property" || entry.computed || typeof name !== "string" || value === undefined) return undefined;
    const key = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    const unit = typeof value === "number" && !/^(?:opacity|zIndex|fontWeight|lineHeight|flex|flexGrow|flexShrink|order)$/.test(name) ? "px" : "";
    styles.push(`${key}:${value}${unit}`);
  }
  return styles.join(";");
}

function jsxMarkup(node: unknown, depth = 0): string | undefined {
  if (depth > 20) return undefined;
  const item = record(node);
  if (item.type === "JSXText" && typeof item.value === "string") return escapeHtml(item.value);
  if (item.type === "JSXExpressionContainer") {
    const value = literal(item.expression);
    return value === undefined ? undefined : escapeHtml(String(value));
  }
  if (item.type !== "JSXElement" && item.type !== "JSXFragment") return undefined;
  if (!Array.isArray(item.children)) return undefined;
  const children = item.children.map((child) => jsxMarkup(child, depth + 1));
  if (children.some((child) => child === undefined)) return undefined;
  if (item.type === "JSXFragment") return children.join("");
  const opening = record(item.openingElement);
  const tag = record(opening.name).name;
  if (typeof tag !== "string" || !/^[a-z][a-z\d]*$/.test(tag) || !Array.isArray(opening.attributes)) return undefined;
  const attributes = [];
  for (const raw of opening.attributes) {
    const attribute = record(raw);
    const name = record(attribute.name).name;
    if (attribute.type !== "JSXAttribute" || typeof name !== "string" || !/^[a-z][\w-]*$/i.test(name) || /^on/i.test(name)) return undefined;
    const valueNode = record(attribute.value);
    const value = name === "style" ? jsxStyle(record(valueNode.expression)) : literal(valueNode.type === "JSXExpressionContainer" ? valueNode.expression : valueNode);
    if (value === undefined) return undefined;
    attributes.push(` ${name === "className" ? "class" : name}="${escapeHtml(String(value))}"`);
  }
  return `<${tag}${attributes.join("")}>${children.join("")}</${tag}>`;
}

function staticJsx(source: string): string | undefined {
  try {
    const module = jsxParser.parse(source, { ecmaVersion: 2020, sourceType: "module" });
    if (module.body.length !== 1) return undefined;
    const [statement] = module.body;
    const entry = record(statement);
    if (entry.type === "ExpressionStatement") return jsxMarkup(entry.expression);
    const declaration = entry.type === "ExportDefaultDeclaration" ? record(entry.declaration) : entry;
    if (declaration.type !== "FunctionDeclaration" && declaration.type !== "ArrowFunctionExpression") return jsxMarkup(entry.declaration);
    if (declaration.async || declaration.generator || !Array.isArray(declaration.params) || declaration.params.length) return undefined;
    const body = record(declaration.body);
    if (body.type !== "BlockStatement") return jsxMarkup(body);
    if (!Array.isArray(body.body) || body.body.length !== 1) return undefined;
    const output = record(body.body[0]);
    return output.type === "ReturnStatement" ? jsxMarkup(output.argument) : undefined;
  } catch {
    return undefined;
  }
}

export function readVegaChart(source: string): ReplyChartData | undefined {
  if (source.length > 30000) return undefined;
  try {
    const spec = record(JSON.parse(source));
    if (spec.transform || spec.layer || spec.repeat || spec.facet) return undefined;
    const mark = typeof spec.mark === "string" ? spec.mark : record(spec.mark).type;
    if (mark !== "bar" && mark !== "line" && mark !== "arc") return undefined;
    const data = record(spec.data).values;
    if (!Array.isArray(data) || !data.length || data.length > 40) return undefined;
    const encoding = record(spec.encoding);
    const name = record(mark === "arc" ? encoding.color : encoding.x);
    const value = record(mark === "arc" ? encoding.theta : encoding.y);
    if (typeof name.field !== "string" || typeof value.field !== "string" || name.aggregate || value.aggregate || name.bin || value.bin) return undefined;
    const rows = [];
    for (const entry of data) {
      const row = record(entry);
      const category = row[name.field];
      const number = row[value.field];
      if ((typeof category !== "string" && typeof category !== "number") || typeof number !== "number" || !Number.isFinite(number)) return undefined;
      rows.push({ name: String(category), values: [number] });
    }
    return { chartType: mark === "arc" ? "pie" : mark, rows, series: [value.field], label: typeof spec.title === "string" ? spec.title : "Vega-Lite 图表" };
  } catch {
    return undefined;
  }
}

export function StaticCodePreview({ source, language }: { source: string; language: string }) {
  const markup = useMemo(() => {
    const html = language === "jsx" || language === "tsx" ? staticJsx(source) : source;
    if (!html || html.length > 30000) return "";
    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true, svg: true },
      FORBID_TAGS: ["base", "form", "iframe", "link", "meta", "object", "embed", "script", "style", "foreignObject"],
      FORBID_ATTR: ["href", "xlink:href", "src", "srcset", "action", "formaction", "target", "ping"],
    });
  }, [source, language]);
  if (!markup) return <p className="chat-code-status">此代码超出静态预览支持范围。</p>;
  const policy = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
  return <iframe className="chat-static-preview" title={`${language.toUpperCase()} 静态预览`} sandbox="" loading="lazy"
    srcDoc={`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>body{margin:16px;font:14px system-ui;overflow-wrap:anywhere}svg{max-width:100%;max-height:176px}</style>${markup}`} />;
}
