import { readChatWidget, type ChatWidget } from "./chat-widget";

type ChatReplyBlock = { offset: number } & (
  | { kind: "markdown" | "writing"; text: string }
  | { kind: "widget"; widget: ChatWidget }
  | { kind: "unsupported"; text: string }
  | { kind: "pending" }
);

function findFenceEnd(text: string, from: number, fence: string): number | undefined {
  const closing = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*\\r?$`, "gm");
  closing.lastIndex = from;
  return closing.exec(text) ? closing.lastIndex : undefined;
}

function findWritingEnd(text: string, from: number): RegExpExecArray | null {
  const tokens = /^ {0,3}(`{3,}|~{3,})[^\r\n]*|(`+)|<\/WritingBlock\s*>/gm;
  tokens.lastIndex = from;
  for (let token = tokens.exec(text); token; token = tokens.exec(text)) {
    if (token[1]) {
      const end = findFenceEnd(text, tokens.lastIndex, token[1]);
      if (end === undefined) return null;
      tokens.lastIndex = end;
    } else if (token[2]) {
      const closing = new RegExp("(?<!`)" + token[2] + "(?!`)", "g");
      closing.lastIndex = tokens.lastIndex;
      const end = closing.exec(text);
      if (end && !/[\r\n]/.test(text.slice(tokens.lastIndex, end.index))) tokens.lastIndex = closing.lastIndex;
    } else {
      return token;
    }
  }
  return null;
}

function findBoxEnd(text: string): number | undefined {
  const tokens = /"(?:[^"\\\r\n]|\\.)*"|<(\/?)box(?=[\s>])[^<>]*>/g;
  let depth = 0;
  for (let match = tokens.exec(text); match; match = tokens.exec(text)) {
    if (match[1] === "") depth++;
    else if (match[1] === "/" && depth > 0 && --depth === 0) return tokens.lastIndex;
  }
  return undefined;
}

export function escapeReplyMarkdown(text: string): string {
  return text.replace(/[\\`*_{}\[\]()<>#!|~$]/g, "\\$&");
}

export function prepareReplyMarkdown(text: string): string {
  const parts: string[] = [];
  const tokens = /^ {0,3}(`{3,}|~{3,})[^\r\n]*|(`+)|(?<!\\)\\\(([^\r\n]+?)\\\)|(?<!\\)\\\[([\s\S]+?)\\\]|<Cite\s+refs=\{\s*\[\s*(?:"[^"<>]*"\s*,?\s*)+\]\s*\}\s*\/\s*>|<Link\s+ref="[^"<>]*"\s+title="([^"<>]+)"\s*\/\s*>/gm;
  let cursor = 0;
  for (let token = tokens.exec(text); token; token = tokens.exec(text)) {
    if (token[1]) {
      tokens.lastIndex = findFenceEnd(text, tokens.lastIndex, token[1]) ?? text.length;
      continue;
    }
    if (token[2]) {
      const closing = new RegExp("(?<!`)" + token[2] + "(?!`)", "g");
      closing.lastIndex = tokens.lastIndex;
      if (closing.exec(text)) tokens.lastIndex = closing.lastIndex;
      continue;
    }
    parts.push(text.slice(cursor, token.index));
    if (token[3] !== undefined) parts.push(`$${token[3].trim()}$`);
    else if (token[4] !== undefined) parts.push(`\n\n$$\n${token[4].trim()}\n$$\n\n`);
    else if (token[5]) parts.push(`${escapeReplyMarkdown(token[5])}（来源链接未返回）`);
    else parts.push("〔来源链接未返回〕");
    cursor = tokens.lastIndex;
  }
  parts.push(text.slice(cursor));
  return parts.join("");
}

export function splitChatReply(text: string, streaming = false): ChatReplyBlock[] {
  const markers = /^ {0,3}(`{3,}|~{3,})[^\r\n]*|^((?:<WritingBlock|<box|<row|<badge|<title|<text|<Chart|\{@body)(?=[\s/>]|$))/gm;
  const blocks: ChatReplyBlock[] = [];
  let cursor = 0;
  let trailingMarkdown = text.length;

  for (let marker = markers.exec(text); marker; marker = markers.exec(text)) {
    if (marker[1]) {
      const end = findFenceEnd(text, markers.lastIndex, marker[1]);
      if (end === undefined) {
        if (cursor < text.length) blocks.push({ kind: "markdown", offset: cursor, text: text.slice(cursor) });
        return blocks;
      }
      markers.lastIndex = end;
      continue;
    }

    const offset = marker.index;
    const rest = text.slice(offset);
    if (offset > cursor) blocks.push({ kind: "markdown", offset: cursor, text: text.slice(cursor, offset) });

    if (marker[2] === "<WritingBlock") {
      const opening = /^<WritingBlock(?:[ \t][^<>\r\n]*)?>/.exec(rest);
      const start = offset + (opening?.[0].length ?? 0);
      const closing = opening ? findWritingEnd(text, start) : null;
      cursor = closing ? closing.index + closing[0].length : text.length;
      if (opening) {
        const body = text.slice(start, closing?.index);
        const partial = body.lastIndexOf("<");
        const hidePartial = streaming && !closing && partial !== -1 && "</WritingBlock>".startsWith(body.slice(partial));
        const content = (hidePartial ? body.slice(0, partial) : body).replace(/^[ \t]*\r?\n|\r?\n[ \t]*$/g, "");
        blocks.push({ kind: "writing", offset, text: content });
      } else {
        blocks.push(streaming ? { kind: "pending", offset } : { kind: "unsupported", offset, text: rest });
      }
    } else {
      const parsed = readChatWidget(rest);
      const closing = parsed?.end ?? findBoxEnd(rest);
      cursor = closing === undefined ? text.length : offset + closing;
      const raw = text.slice(offset, cursor);
      if (parsed?.widget) blocks.push({ kind: "widget", offset, widget: parsed.widget });
      else if (streaming && !closing) blocks.push({ kind: "pending", offset });
      else blocks.push({ kind: "unsupported", offset, text: raw });
    }
    markers.lastIndex = cursor;
  }

  if (streaming && cursor < text.length) {
    const lineStart = text.lastIndexOf("\n") + 1;
    const tail = text.slice(lineStart);
    if (lineStart >= cursor && tail.length > 1 && ["<WritingBlock", "{@body", "<box", "<row", "<badge", "<title", "<text", "<Chart"].some((prefix) => prefix.startsWith(tail))) {
      trailingMarkdown = lineStart;
    }
  }
  if (cursor < trailingMarkdown) blocks.push({ kind: "markdown", offset: cursor, text: text.slice(cursor, trailingMarkdown) });
  return blocks;
}
