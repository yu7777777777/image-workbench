import { useMemo, useState } from "react";
import { Copy, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { readReplyResources, splitChatReply } from "@/lib/chat-rich-reply";
import type { ChatResource } from "@/lib/chat-resources";
import { copyReplyText, ReplyMarkdown, type ReplyMarkdownResources } from "./chat-markdown";
import { ChatResourceImage, ChatResourceLink, ReplyResourcePanel } from "./chat-resource-view";
import { ChatWidgetView } from "./chat-widget-view";
import { chatWidgetResourceRefs } from "@/lib/chat-widget";

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
      {edit === undefined ? <ReplyMarkdown text={text} streaming={streaming} {...markdownResources} /> : (
        <Textarea aria-label="编辑写作块" rows={Math.min(14, Math.max(4, edit.split("\n").length + 1))} value={edit} onChange={(event) => setEdit(event.target.value)} disabled={saving} autoFocus />
      )}
      <div className="chat-writing-actions">
        {edit === undefined ? <>
          <Button type="button" variant="ghost" size="sm" disabled={streaming} onClick={() => setEdit(text)}><Pencil size={14} />编辑</Button>
          <Button type="button" variant="ghost" size="sm" disabled={streaming || !text} onClick={async () => {
            if (await copyReplyText(text)) toast.success("已复制正文");
          }}><Copy size={14} />复制正文</Button>
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
    </section>
  );
}

const emptyResources: ChatResource[] = [];

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
  const { sources, inlineSources, sourceDetails, citations, filenames, attachments } = references;
  const markdownResources = { citations, inlineSources, filenames, attachments, owner };
  const inlineAssets = useMemo(() => {
    const images = new Map<string, ChatResource>();
    const products = new Map<string, ChatResource>();
    for (const asset of resources) {
      if (!asset.ref) continue;
      if (asset.type === "image" && !images.has(asset.ref)) images.set(asset.ref, asset);
      if (asset.type === "product" && !products.has(asset.ref)) products.set(asset.ref, asset);
    }
    return { images, products };
  }, [resources]);
  const renderedInline = new Set<string>();
  for (const block of blocks) {
    if (block.kind === "widget") {
      for (const reference of chatWidgetResourceRefs(block.widget)) {
        const image = reference.type === "image" ? inlineAssets.images.get(reference.ref) : undefined;
        if (image) renderedInline.add(image.id);
      }
    } else if (attachments.size && (block.kind === "markdown" || block.kind === "writing")) {
      const markdown = block.kind === "writing" ? writingDrafts?.[block.offset] ?? block.text : block.text;
      for (const path of readReplyResources(markdown).attachmentPaths) {
        const attachment = attachments.get(path);
        if (attachment) renderedInline.add(attachment.id);
      }
    }
  }

  function renderResource(type: "image" | "product" | "source", ref: string, fallback: string, key: string) {
    if (type === "image") {
      const asset = inlineAssets.images.get(ref) || inlineAssets.products.get(ref);
      return asset?.imageUrl ? <ChatResourceImage key={key} resource={asset} /> : undefined;
    }
    const source = type === "product" ? inlineAssets.products.get(ref) : inlineSources.get(ref);
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
            return <ChatWidgetView key={block.offset} widget={block.widget} canSend={canSend} streaming={streaming} onSend={onSend} renderResource={renderResource} />;
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
