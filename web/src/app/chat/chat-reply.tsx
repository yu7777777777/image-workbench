import { useMemo, useState } from "react";
import { Copy, FileText, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { readReplyResources, splitChatReply } from "@/lib/chat-rich-reply";
import { attachmentPath, chatExternalUrl, type ChatResource } from "@/lib/chat-resources";
import { copyReplyText, ReplyMarkdown, type ReplyMarkdownResources } from "./chat-markdown";
import { ChatResourceLink, downloadChatAttachment, ReplyResourcePanel } from "./chat-resource-view";
import { ChatWidgetView } from "./chat-widget-view";
import { chatWidgetInlineImages, type WidgetImage } from "@/lib/chat-widget";

function WritingBlock({ text, streaming, onSave, markdownResources }: {
  text: string;
  streaming: boolean;
  onSave: (value: string) => Promise<void>;
  markdownResources: ReplyMarkdownResources;
}) {
  const [edit, setEdit] = useState<string>();
  const [saving, setSaving] = useState(false);
  return (
    <section className="chat-writing-block" aria-label="写作块">
      <div className="chat-writing-header">
        <span className="chat-writing-title"><FileText size={14} aria-hidden="true" />文档草稿</span>
        <div className="chat-writing-actions">
          {edit === undefined ? <>
            <Button type="button" variant="ghost" size="sm" disabled={streaming} onClick={() => setEdit(text)}><Pencil size={13} />编辑</Button>
            <Button type="button" variant="ghost" size="sm" disabled={streaming || !text} onClick={async () => {
              if (await copyReplyText(text)) toast.success("已复制正文");
            }}><Copy size={13} />复制正文</Button>
          </> : <>
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setEdit(undefined)}>取消</Button>
            <Button type="button" size="sm" disabled={saving} onClick={async () => {
              setSaving(true);
              try {
                await onSave(edit);
                setEdit(undefined);
              } finally {
                setSaving(false);
              }
            }}>{saving ? "保存中…" : "保存"}</Button>
          </>}
        </div>
      </div>
      <div className="chat-writing-body">
        {edit === undefined ? <ReplyMarkdown text={text} streaming={streaming} {...markdownResources} /> : (
          <Textarea aria-label="编辑写作块" rows={Math.min(14, Math.max(4, edit.split("\n").length + 1))} value={edit} onChange={(event) => setEdit(event.target.value)} disabled={saving} autoFocus />
        )}
      </div>
    </section>
  );
}

const emptyResources: ChatResource[] = [];
const SEARCH_RESULT_REF_RE = /^turn\d+(?:search|web|news|view|image)\d+$/i;
const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "image", "images", "img",
  "photo", "picture", "http", "https", "www", "com", "org", "net", "html", "htm",
]);
const UTM_PARAMS = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]);

function canonicalSourceUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    for (const key of [...parsed.searchParams.keys()]) {
      if (UTM_PARAMS.has(key.toLowerCase())) parsed.searchParams.delete(key);
    }
    parsed.hash = "";
    const pathname = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, "") : parsed.pathname;
    const query = parsed.searchParams.toString();
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${parsed.port ? `:${parsed.port}` : ""}${pathname}${query ? `?${query}` : ""}`;
  } catch {
    return rawUrl;
  }
}

function extractCitedRefs(text: string): string[] {
  const refs = new Set<string>();
  for (const match of text.matchAll(/<Cite\s+refs=\{\s*\[([^\]]{1,2048})\]\s*\}\s*\/\s*>/g)) {
    for (const token of match[1].matchAll(/"([\w.:-]{1,160})"/g)) {
      refs.add(token[1]);
    }
  }
  for (const match of text.matchAll(/<Link\b[^<>]*?\bref="([\w.:-]{1,160})"/g)) {
    refs.add(match[1]);
  }
  return [...refs];
}

function extractQueryTokens(queries: readonly string[]): { exact: string[]; bigrams: string[] } {
  const exact = new Set<string>();
  const bigrams = new Set<string>();
  for (const query of queries) {
    const lower = query.toLowerCase();
    for (const latin of lower.matchAll(/[a-z0-9]{2,}/g)) {
      const token = latin[0];
      if (!STOP_WORDS.has(token)) exact.add(token);
    }
    for (const cjk of lower.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
      const run = cjk[0];
      exact.add(run);
      if (run.length >= 4) {
        for (let i = 0; i <= run.length - 2; i++) {
          bigrams.add(run.slice(i, i + 2));
        }
      }
    }
  }
  return { exact: [...exact], bigrams: [...bigrams] };
}

function urlPathText(rawUrl?: string): string {
  if (!rawUrl) return "";
  try {
    const pathname = decodeURIComponent(new URL(rawUrl).pathname);
    return pathname.replace(/[/\-_.]+/g, " ");
  } catch {
    return "";
  }
}

function widgetImageKey(node: WidgetImage): string {
  return `${node.group ? "G" : "I"}|${node.ref ?? ""}|${(node.queries ?? []).join("\u001f")}|${node.label ?? ""}`;
}

function dedupeByImageUrl(items: readonly ChatResource[]): ChatResource[] {
  const urls = new Set<string>();
  return items.filter(({ imageUrl }) => {
    if (!imageUrl || urls.has(imageUrl)) return false;
    urls.add(imageUrl);
    return true;
  });
}

function scoreKeywordMatches(
  candidates: readonly ChatResource[],
  queryList: readonly string[],
  limit: number,
): ChatResource[] {
  const { exact, bigrams } = extractQueryTokens(queryList);
  if (!exact.length && !bigrams.length) return [];
  const scored: Array<{ image: ChatResource; score: number; index: number }> = [];
  for (let index = 0; index < candidates.length; index++) {
    const image = candidates[index];
    const haystack = `${image.title ?? ""} ${urlPathText(image.url)}`.toLowerCase().trim();
    if (!haystack) continue;
    let score = 0;
    for (const token of exact) {
      if (haystack.includes(token)) score += 2;
    }
    for (const token of bigrams) {
      if (haystack.includes(token)) score += 1;
    }
    if (score > 0) scored.push({ image, score, index });
  }
  scored.sort((a, b) => (b.score - a.score) || (a.index - b.index));
  return dedupeByImageUrl(scored.map((entry) => entry.image)).slice(0, limit);
}

export function ChatReply({ text, writingDrafts, resources = emptyResources, owner, streaming, canSend, onSend, onSaveWriting }: {
  text: string;
  writingDrafts?: Record<number, string>;
  resources?: ChatResource[];
  owner: string;
  streaming: boolean;
  canSend: boolean;
  onSend: (text: string) => void;
  onSaveWriting: (offset: number, text: string) => Promise<void>;
}) {
  const blocks = useMemo(() => splitChatReply(text, streaming), [text, streaming]);
  const references = useMemo(() => readReplyResources(text, resources), [text, resources]);
  const { sources, sourceDetails, filenames, attachments } = references;
  const resolvedCitations = useMemo(() => {
    const citations = new Map(references.citations);
    const inlineSources = new Map(references.inlineSources);
    const byRef = new Map<string, ChatResource[]>();
    for (const resource of resources) {
      if (resource.type !== "source" || !resource.url || !resource.ref) continue;
      const list = byRef.get(resource.ref) ?? [];
      list.push(resource);
      byRef.set(resource.ref, list);
    }
    for (const [ref, group] of byRef) {
      if (inlineSources.has(ref)) continue;
      const canonicalUrls = new Set(group.map((item) => canonicalSourceUrl(item.url!)));
      if (canonicalUrls.size !== 1) continue;
      const preferred = group.find((item) => !item.url!.includes("utm_source=") && item.title)
        ?? group.find((item) => !item.url!.includes("utm_source="))
        ?? group[0];
      if (preferred?.url) {
        inlineSources.set(ref, preferred);
        citations.set(ref, preferred.url);
      }
    }
    const lowerInlineSources = new Map<string, ChatResource>();
    const ambiguousLower = new Set<string>();
    for (const [ref, source] of inlineSources) {
      const lower = ref.toLowerCase();
      const existing = lowerInlineSources.get(lower);
      if (existing && existing.url !== source.url) ambiguousLower.add(lower);
      else lowerInlineSources.set(lower, source);
    }
    for (const lower of ambiguousLower) lowerInlineSources.delete(lower);
    for (const ref of extractCitedRefs(text)) {
      if (citations.has(ref)) continue;
      const matched = lowerInlineSources.get(ref.toLowerCase());
      if (matched?.url) {
        inlineSources.set(ref, matched);
        citations.set(ref, matched.url);
      }
    }
    return { citations, inlineSources, lowerInlineSources };
  }, [text, resources, references]);
  const { citations, inlineSources, lowerInlineSources } = resolvedCitations;
  const markdownResources = { citations, inlineSources, filenames, attachments, owner };
  const inlineAssets = useMemo(() => {
    const images: ChatResource[] = [];
    const products = new Map<string, ChatResource>();
    for (const asset of resources) {
      if (asset.type === "image" && asset.imageUrl) images.push(asset);
      if (asset.type === "product" && asset.ref && !products.has(asset.ref)) products.set(asset.ref, asset);
    }
    return { images, products };
  }, [resources]);

  const imageBindings = useMemo(() => {
    const { images, products } = inlineAssets;
    const widgetImageNodes: WidgetImage[] = [];
    for (const block of blocks) {
      if (block.kind === "widget") {
        widgetImageNodes.push(...chatWidgetInlineImages(block.widget));
      }
    }
    const widgetRefs = new Set<string>();
    for (const node of widgetImageNodes) {
      if (node.ref) widgetRefs.add(node.ref);
    }
    const isUnkeyedImage = (image: ChatResource): boolean => (
      !image.queries?.length
      && (!image.ref || (!widgetRefs.has(image.ref) && SEARCH_RESULT_REF_RE.test(image.ref)))
    );

    const assignmentsByNode = new Map<WidgetImage, ChatResource[]>();
    const assignmentsByKey = new Map<string, ChatResource[]>();
    const tier1Matched = new Set<WidgetImage>();
    const claimedIds = new Set<string>();
    const claimedUrls = new Set<string>();

    const recordAssignment = (node: WidgetImage, matched: ChatResource[]) => {
      assignmentsByNode.set(node, matched);
      const key = widgetImageKey(node);
      if (!assignmentsByKey.has(key)) assignmentsByKey.set(key, matched);
      for (const item of matched) {
        if (item.type === "image") {
          claimedIds.add(item.id);
          if (item.imageUrl) claimedUrls.add(item.imageUrl);
        }
      }
    };

    const matchTier1 = (node: WidgetImage): ChatResource[] => {
      let matches = node.ref ? images.filter((image) => image.ref === node.ref) : [];
      if (!matches.length && node.queries) {
        const queries = node.queries;
        matches = images.filter((image) => image.queries?.length === queries.length
          && image.queries.every((query, index) => query === queries[index]));
        if (!matches.length && node.group) {
          matches = queries.flatMap((query) => images.find((image) => image.queries?.length === 1 && image.queries[0] === query) ?? []);
        }
      }
      if (!matches.length && node.ref && !node.group) {
        const product = products.get(node.ref);
        if (product?.imageUrl) return [product];
      }
      const deduped = dedupeByImageUrl(matches);
      return node.group ? deduped : deduped.slice(0, 1);
    };

    // Tier 1: exact ref / queries / product match
    for (const node of widgetImageNodes) {
      const matched = matchTier1(node);
      if (matched.length) {
        tier1Matched.add(node);
        recordAssignment(node, matched);
      }
    }

    // Tier 2: improved CJK + Latin keyword overlap against unclaimed unkeyed images
    for (const node of widgetImageNodes) {
      if (tier1Matched.has(node)) continue;
      const queryList = node.queries ?? (node.label ? [node.label] : []);
      if (!queryList.length) continue;
      const limit = node.group ? Math.min(4, Math.max(1, node.queries?.length ?? 3)) : 1;
      const candidates = images.filter((image) => !claimedIds.has(image.id)
        && Boolean(image.imageUrl) && !claimedUrls.has(image.imageUrl!) && isUnkeyedImage(image));
      const matched = scoreKeywordMatches(candidates, queryList, limit);
      if (matched.length) recordAssignment(node, matched);
    }

    // Tier 3: smart sequential fallback for remaining unclaimed unkeyed images
    const fallbackPool: ChatResource[] = [];
    const poolUrls = new Set<string>(claimedUrls);
    for (const image of images) {
      if (claimedIds.has(image.id) || !image.imageUrl || poolUrls.has(image.imageUrl)) continue;
      if (!isUnkeyedImage(image)) continue;
      poolUrls.add(image.imageUrl);
      fallbackPool.push(image);
    }
    let cursor = 0;
    for (const node of widgetImageNodes) {
      if (tier1Matched.has(node)) continue;
      if (node.ref && !node.queries?.length) continue;
      const existing = assignmentsByNode.get(node) ?? [];
      const limit = node.group ? Math.min(4, Math.max(1, node.queries?.length ?? 3)) : 1;
      const need = limit - existing.length;
      if (need <= 0 || cursor >= fallbackPool.length) continue;
      const extra = fallbackPool.slice(cursor, cursor + need);
      cursor += extra.length;
      if (extra.length) recordAssignment(node, [...existing, ...extra]);
    }

    return {
      assignmentsByNode,
      assignmentsByKey,
      claimedIds,
      claimedUrls,
      remainingPool: fallbackPool.slice(cursor),
      matchTier1,
    };
  }, [blocks, inlineAssets]);

  function resolveImages(node: WidgetImage): ChatResource[] {
    const exact = imageBindings.assignmentsByNode.get(node);
    if (exact) return exact;
    const byKey = imageBindings.assignmentsByKey.get(widgetImageKey(node));
    if (byKey) return byKey;
    const tier1 = imageBindings.matchTier1(node);
    if (tier1.length) return tier1;
    const limit = node.group ? Math.min(4, Math.max(1, node.queries?.length ?? 3)) : 1;
    const queryList = node.queries ?? (node.label ? [node.label] : []);
    if (queryList.length && imageBindings.remainingPool.length) {
      const tier2 = scoreKeywordMatches(imageBindings.remainingPool, queryList, limit);
      if (tier2.length) return tier2;
    }
    if (!(node.ref && !node.queries?.length) && imageBindings.remainingPool.length) {
      return imageBindings.remainingPool.slice(0, limit);
    }
    return [];
  }

  function handleOpenUrl(rawUrl: string) {
    if (rawUrl.startsWith("sandbox:")) {
      const path = attachmentPath(rawUrl);
      const attachment = path ? attachments.get(path) : undefined;
      if (!attachment || !owner) {
        toast.error("附件未随回复返回");
        return;
      }
      void downloadChatAttachment(attachment, owner).catch((error) => {
        toast.error(error instanceof Error ? error.message : "文件下载失败，请重试");
      });
      return;
    }
    const safeUrl = chatExternalUrl(rawUrl);
    if (safeUrl) window.open(safeUrl, "_blank", "noopener,noreferrer");
  }

  const renderedInline = new Set<string>(imageBindings.claimedIds);
  for (const image of inlineAssets.images) {
    if (image.imageUrl && imageBindings.claimedUrls.has(image.imageUrl)) {
      renderedInline.add(image.id);
    }
  }
  for (const block of blocks) {
    if (attachments.size && (block.kind === "markdown" || block.kind === "writing")) {
      const markdown = block.kind === "writing" ? writingDrafts?.[block.offset] ?? block.text : block.text;
      for (const path of readReplyResources(markdown).attachmentPaths) {
        const attachment = attachments.get(path);
        if (attachment) renderedInline.add(attachment.id);
      }
    }
  }

  function renderResource(type: "product" | "source", ref: string, fallback: string, key: string) {
    const source = type === "product"
      ? inlineAssets.products.get(ref)
      : (inlineSources.get(ref) ?? lowerInlineSources.get(ref.toLowerCase()));
    return source?.url ? <ChatResourceLink key={key} resource={source} label={fallback} /> : undefined;
  }

  return (
    <div className="chat-markdown">
      {blocks.map((block) => {
        switch (block.kind) {
          case "markdown":
            return <ReplyMarkdown key={block.offset} text={block.text} streaming={streaming} {...markdownResources} />;
          case "writing":
            return block.text && <WritingBlock key={block.offset} text={writingDrafts?.[block.offset] ?? block.text} streaming={streaming} markdownResources={markdownResources} onSave={(value) => onSaveWriting(block.offset, value)} />;
          case "widget":
            return <ChatWidgetView key={block.offset} widget={block.widget} canSend={canSend} streaming={streaming} onSend={onSend} onOpenUrl={handleOpenUrl} renderResource={renderResource} resolveImages={resolveImages} />;
          case "unsupported":
            return (
              <details key={block.offset} className="chat-reply-source">
                <summary>此内容暂无法渲染，查看原文</summary>
                <pre>{block.text}</pre>
              </details>
            );
          case "pending":
            return null;
        }
      })}
      <ReplyResourcePanel resources={resources.filter(({ id }) => !renderedInline.has(id))} owner={owner} />
      {!streaming && sources.size > 0 && (
        <details className="chat-reply-source chat-sources">
          <summary>回复中的来源链接（{sources.size}）</summary>
          <ul className="chat-resource-source-list">{[...sources].map(([url, title]) => (
            <li key={url}>
              <a href={url} target="_blank" rel="noopener noreferrer">{title}</a>
              {sourceDetails.get(url)?.description && <div className="chat-resource-muted">{sourceDetails.get(url)?.description}</div>}
            </li>
          ))}</ul>
        </details>
      )}
    </div>
  );
}
