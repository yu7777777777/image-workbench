import { chatWidgetStartTags, readChatWidget, type ChatWidget } from "./chat-widget";
import { attachmentPath, type ChatResource } from "./chat-resources";

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

export function readReplyResources(text: string, resources: ChatResource[] = []) {
  const links = new Map<string, string>();
  const citations = new Map<string, string>();
  const ambiguous = new Set<string>();
  const names = new Map<string, Set<string>>();
  const attachmentPaths = new Set<string>();
  let previous: { end: number; url: string } | undefined;
  let hasReferences = false;
  const tokens = /^ {0,3}(`{3,}|~{3,})[^\r\n]*|(`+)|<(?:Cite\s+refs|Link\s+ref)\b|(?<!!)\[([^\]\r\n]+)\]\((<?(?:https?:\/\/|sandbox:\/)[^\s)>]+>?)\)/gm;
  for (let token = tokens.exec(text); token; token = tokens.exec(text)) {
    if (token[1]) {
      tokens.lastIndex = findFenceEnd(text, tokens.lastIndex, token[1]) ?? text.length;
    } else if (token[2]) {
      const end = new RegExp("(?<!`)" + token[2] + "(?!`)", "g");
      end.lastIndex = tokens.lastIndex;
      if (end.exec(text)) tokens.lastIndex = end.lastIndex;
    } else if (!token[4]) {
      hasReferences = true;
      const ref = /^<Cite\s+refs=\{\s*\[\s*"([\w.:-]{1,160})"\s*\]\s*\}\s*\/\s*>/.exec(text.slice(token.index))?.[1];
      // Link an ID only when the reply places its single citation immediately after an explicit URL.
      if (ref && previous && /^[ \t。.!?;：:]*$/.test(text.slice(previous.end, token.index))) {
        if (citations.has(ref) && citations.get(ref) !== previous.url) ambiguous.add(ref);
        citations.set(ref, previous.url);
      }
    } else {
      const href = token[4].replace(/^<|>$/g, "");
      if (href.startsWith("sandbox:")) {
        const path = attachmentPath(href);
        if (path) attachmentPaths.add(path);
        const filename = href.match(/\/([a-z\d][a-z\d_.-]{0,95}\.(csv|txt))$/i);
        if (filename) {
          const extension = filename[2].toLowerCase();
          const files = names.get(extension) ?? new Set<string>();
          files.add(filename[1]);
          names.set(extension, files);
        }
      } else {
        try {
          const url = new URL(href);
          if (!url.username && !url.password) {
            if (!links.has(url.href)) links.set(url.href, token[3]);
            previous = { url: url.href, end: tokens.lastIndex };
          }
        } catch {
          // A malformed source remains ordinary Markdown.
        }
      }
    }
  }
  const filenames = new Map([...names].flatMap(([extension, files]) => files.size === 1 ? [[extension, [...files][0]] as const] : []));
  for (const ref of ambiguous) citations.delete(ref);
  const sources = hasReferences ? links : new Map<string, string>();
  const inlineSources = new Map<string, ChatResource>();
  const sourceDetails = new Map<string, ChatResource>();
  const attachments = new Map<string, ChatResource>();
  const ambiguousSources = new Set<string>();
  for (const resource of resources) {
    if (resource.type === "attachment" && resource.path) attachments.set(resource.path, resource);
    if (resource.type !== "source" || !resource.url) continue;
    sources.set(resource.url, resource.title || sources.get(resource.url) || new URL(resource.url).hostname);
    if (!sourceDetails.has(resource.url)) sourceDetails.set(resource.url, resource);
    if (!resource.ref) continue;
    const previousSource = inlineSources.get(resource.ref);
    if (previousSource && previousSource.url !== resource.url) ambiguousSources.add(resource.ref);
    else inlineSources.set(resource.ref, resource);
  }
  for (const [ref, source] of inlineSources) {
    if (ambiguousSources.has(ref)) {
      inlineSources.delete(ref);
      citations.delete(ref);
    } else if (source.url) {
      citations.set(ref, source.url);
    }
  }
  return { sources, filenames, citations, inlineSources, sourceDetails, attachments, attachmentPaths };
}

export function prepareReplyMarkdown(
  text: string,
  citations?: ReadonlyMap<string, string>,
  inlineSources?: ReadonlyMap<string, ChatResource>,
): string {
  const parts: string[] = [];
  const tokens = /^ {0,3}(`{3,}|~{3,})[^\r\n]*|(`+)|(?<!\\)\\\(([^\r\n]+?)\\\)|(?<!\\)\\\[([\s\S]+?)\\\]|<LearningViz\b[^<>]*>([\s\S]*?)<\/LearningViz\s*>|(<Cite\s+refs=\{\s*\[\s*(?:"[^"<>]*"\s*,?\s*)+\]\s*\}\s*\/\s*>(?:[ \t]*<Cite\s+refs=\{\s*\[\s*(?:"[^"<>]*"\s*,?\s*)+\]\s*\}\s*\/\s*>)*)|<Link\s+ref="([\w.:-]{1,160})"\s+title="([^"<>]+)"\s*\/\s*>|<icon\s+[^<>]*\/\s*>|<badge(?:\s[^<>]*)?>([^<>]*)<\/badge>|(<divider(?:\s+color=(?:"[a-z]+"|'[a-z]+'))?\s*\/\s*>)/gm;
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
    else if (token[5] !== undefined) {
      const latex = token[5].trim();
      if (latex) parts.push(latex.includes("\n") ? `\n\n$$\n${latex}\n$$\n\n` : `$${latex}$`);
    } else if (token[10]) parts.push("\n\n---\n\n");
    else if (token[9] !== undefined) parts.push(token[9]);
    else if (token[7] && token[8]) {
      const title = escapeReplyMarkdown(token[8]);
      const url = citations?.get(token[7]);
      if (url) {
        const target = inlineSources?.has(token[7]) ? `workbench-cite:${encodeURIComponent(token[7])}` : url;
        parts.push(`[${title}](<${target}>)`);
      } else {
        parts.push(`${title}（来源链接未返回）`);
      }
    } else if (token[6]) {
      const refs = [...token[6].matchAll(/"([\w.:-]{1,160})"/g)].map((item) => item[1]);
      const seenUrls = new Set<string>();
      const inlineRefs: string[] = [];
      const plainUrls: string[] = [];
      let unresolved = false;
      for (const ref of refs) {
        const url = citations?.get(ref);
        if (!url) unresolved = true;
        else if (!seenUrls.has(url)) {
          seenUrls.add(url);
          if (inlineSources?.has(ref)) inlineRefs.push(ref);
          else plainUrls.push(url);
        }
      }
      const emitted: string[] = [];
      if (inlineRefs.length) {
        const encoded = inlineRefs.map((ref) => encodeURIComponent(ref)).join(",");
        emitted.push(`[来源](<workbench-cite:${encoded}>)`);
      }
      if (plainUrls.length) {
        emitted.push(
          ...plainUrls.map((url, index) => `[来源${plainUrls.length > 1 && !inlineRefs.length ? ` ${index + 1}` : ""}](<${url}>)`),
        );
      }
      if (emitted.length) parts.push(emitted.join(" · "));
      if (!emitted.length || unresolved) parts.push("〔来源链接未返回〕");
    }
    cursor = tokens.lastIndex;
  }
  parts.push(text.slice(cursor));
  return parts.join("");
}

const richStarts = ["<WritingBlock", ...chatWidgetStartTags.map((tag) => "<" + tag), "{@body"];
const markerAlternatives = richStarts.map((prefix) => prefix.replace("{", "\\{")).join("|");
const blockPattern = /^ {0,3}(`{3,}|~{3,})[^\r\n]*/.source
  + "|^(" + markerAlternatives + ")" + /(?=[\s/>]|$)/.source;

export function splitChatReply(text: string, streaming = false): ChatReplyBlock[] {
  const markers = new RegExp(blockPattern, "gm");
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
    if (lineStart >= cursor && tail.length > 1 && richStarts.some((prefix) => prefix.startsWith(tail))) {
      trailingMarkdown = lineStart;
    }
  }
  if (cursor < trailingMarkdown) blocks.push({ kind: "markdown", offset: cursor, text: text.slice(cursor, trailingMarkdown) });
  return blocks;
}
