import { useMemo } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { splitChatReply } from "@/lib/chat-rich-reply";
import { copyReplyText, ReplyMarkdown } from "./chat-markdown";
import { ChatWidgetView } from "./chat-widget-view";

function WritingBlock({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <section className="chat-writing-block" aria-label="写作块">
      <ReplyMarkdown text={text} streaming={streaming} />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={streaming}
        onClick={async () => {
          if (await copyReplyText(text)) toast.success("已复制正文");
        }}
      >
        <Copy size={14} />复制正文
      </Button>
    </section>
  );
}

export function ChatReply({ text, streaming, canSend, onSend }: {
  text: string;
  streaming: boolean;
  canSend: boolean;
  onSend: (text: string) => void;
}) {
  const blocks = useMemo(() => splitChatReply(text, streaming), [text, streaming]);
  return (
    <div className="chat-markdown">
      {blocks.map((block) => {
        switch (block.kind) {
          case "markdown":
            return <ReplyMarkdown key={block.offset} text={block.text} streaming={streaming} />;
          case "writing":
            return block.text && <WritingBlock key={block.offset} text={block.text} streaming={streaming} />;
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
    </div>
  );
}
