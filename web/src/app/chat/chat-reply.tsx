import { useMemo, useState } from "react";
import { Copy, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { readReplyResources, splitChatReply } from "@/lib/chat-rich-reply";
import { copyReplyText, ReplyMarkdown } from "./chat-markdown";
import { ChatWidgetView } from "./chat-widget-view";

function WritingBlock({ text, streaming, onSave }: { text: string; streaming: boolean; onSave: (value: string) => Promise<void> }) {
  const [edit, setEdit] = useState<string>();
  const [saving, setSaving] = useState(false);
  return (
    <section className="chat-writing-block" aria-label="写作块">
      {edit === undefined ? <ReplyMarkdown text={text} streaming={streaming} /> : (
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

export function ChatReply({ text, writingDrafts, streaming, canSend, onSend, onSaveWriting }: {
  text: string;
  writingDrafts?: Record<number, string>;
  streaming: boolean;
  canSend: boolean;
  onSend: (text: string) => void;
  onSaveWriting: (offset: number, text: string) => Promise<void>;
}) {
  const blocks = useMemo(() => splitChatReply(text, streaming), [text, streaming]);
  const resources = useMemo(() => readReplyResources(text), [text]);
  return (
    <div className="chat-markdown">
      {blocks.map((block) => {
        switch (block.kind) {
          case "markdown":
            return <ReplyMarkdown key={block.offset} text={block.text} streaming={streaming} filenames={resources.filenames} citations={resources.citations} />;
          case "writing":
            return block.text && <WritingBlock key={block.offset} text={writingDrafts?.[block.offset] ?? block.text} streaming={streaming} onSave={(value) => onSaveWriting(block.offset, value)} />;
          case "widget":
            return <ChatWidgetView key={block.offset} widget={block.widget} canSend={canSend} streaming={streaming} onSend={onSend} />;
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
      {!streaming && resources.sources.size > 0 && (
        <details className="chat-reply-source chat-sources">
          <summary>回复中的来源链接（{resources.sources.size}）</summary>
          <ul>{[...resources.sources].map(([url, title]) => (
            <li key={url}><a href={url} target="_blank" rel="noopener noreferrer">{title}</a></li>
          ))}</ul>
        </details>
      )}
    </div>
  );
}
