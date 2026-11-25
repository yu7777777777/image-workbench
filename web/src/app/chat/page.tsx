"use client";

import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowDown,
  ArrowRight,
  Check,
  Copy,
  ImagePlus,
  LoaderCircle,
  History,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuthGuard } from "@/lib/use-auth-guard";
import { fetchModels } from "@/lib/api";
import { createChatId, isChatModel } from "@/lib/chat-stream";
import {
  CHAT_FAMILIES,
  CHAT_LEVELS,
  chatLevelAvailable,
  chatSelection,
  chatChoice,
  chatModelLabel,
} from "@/lib/chat-models";
import { useChatStore, type ChatImage, type ChatThread } from "@/store/chat";
import "./chat.css";

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    toast.error("复制失败，请手动选择文字复制");
    return false;
  }
}
function CodeBlock({ children, ...props }: ComponentProps<"pre">) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="chat-code">
      <button
        type="button"
        aria-label="复制代码"
        onClick={async () => {
          if (await copy(ref.current?.textContent || "")) setCopied(true);
        }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {copied ? "已复制" : "复制代码"}
      </button>
      <pre ref={ref} {...props}>
        {children}
      </pre>
    </div>
  );
}
function readImage(file: File): Promise<ChatImage> {
  return new Promise((resolve, reject) => {
    if (
      !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        file.type,
      )
    ) {
      reject(new Error("仅支持 PNG、JPG、WebP、GIF 图片"));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      reject(new Error(`${file.name} 超过 10MB`));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`无法读取 ${file.name}`));
    reader.onload = () =>
      resolve({
        id: createChatId(),
        name: file.name,
        url: String(reader.result),
      });
    reader.readAsDataURL(file);
  });
}

export default function ChatPage() {
  const { session, isCheckingAuth } = useAuthGuard();
  const chat = useChatStore();
  const [models, setModels] = useState<string[]>([]);
  const [modelError, setModelError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [query, setQuery] = useState("");
  const [rename, setRename] = useState<ChatThread | null>(null);
  const [title, setTitle] = useState("");
  const [deleting, setDeleting] = useState<ChatThread | null>(null);
  const [preview, setPreview] = useState<ChatImage | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const thread = chat.threads.find((t) => t.id === chat.activeId);
  const owner = session ? `${session.role}:${session.subjectId}` : "";
  useEffect(() => {
    if (owner) void useChatStore.getState().load(owner);
  }, [owner]);
  useEffect(() => {
    document.documentElement.classList.add("chat-route-lock");
    return () => {
      document.documentElement.classList.remove("chat-route-lock");
      useChatStore.getState().stop();
    };
  }, []);
  const loadModels = () => {
    setModelError("");
    void fetchModels({ force: true })
      .then((result) =>
        setModels(
          Array.from(
            new Set([
              ...result.data.map((m) => m.id).filter(isChatModel),
            ]),
          ),
        ),
      )
      .catch(() =>
        setModelError("模型列表加载失败，请点击重试。"),
      );
  };
  useEffect(() => {
    if (owner) loadModels();
  }, [owner]);
  useEffect(() => {
    if (!thread || !models.length) return;
    const current = chatSelection(thread.model, thread.effort);
    if (!current) return;
    const next = chatChoice(current.family, current.level, models);
    if (next && next.model !== thread.model) {
      useChatStore.getState().update(thread.id, next);
    }
  }, [models, thread?.effort, thread?.id, thread?.model]);
  useEffect(() => {
    following.current = true;
    setAtBottom(true);
  }, [chat.activeId]);
  useEffect(() => {
    if (following.current && scroller.current)
      scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [thread?.messages, chat.activeId]);

  if (
    isCheckingAuth ||
    !session ||
    !chat.ready ||
    chat.owner !== owner ||
    !thread
  )
    return (
      <div className="flex h-80 items-center justify-center">
        <LoaderCircle className="animate-spin" aria-label="加载对话" />
      </div>
    );
  const busy = chat.busyId === thread.id;
  const selection = chatSelection(thread.model, thread.effort);
  const canSend = !!selection && models.includes(thread.model) && !modelError
    && chatLevelAvailable(selection.family, selection.level, models);
  const choose = (family: string, level: string) => {
    const next = chatChoice(family, level, models);
    if (next && models.includes(next.model)) chat.update(thread.id, next);
  };
  const list = (
    <div className="chat-history">
      <div className="chat-search">
        <Search size={14} />
        <input
          aria-label="搜索对话"
          placeholder="搜索历史对话"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="chat-history-list">
        {[...chat.threads]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .filter((t) => t.title.toLowerCase().includes(query.toLowerCase()))
          .map((t) => (
            <div
              key={t.id}
              className={`chat-history-item ${t.id === thread.id ? "selected" : ""}`}
            >
              <button
                className="chat-history-select"
                onClick={() => {
                  chat.select(t.id);
                  setHistoryOpen(false);
                }}
              >
                <span className="truncate">{t.title}</span>
                <span className="chat-history-date">
                  {chat.busyId === t.id
                    ? "正在回复…"
                    : new Date(t.updatedAt).toLocaleDateString("zh-CN", {
                        month: "long",
                        day: "numeric",
                      })}
                </span>
              </button>
              <div className="chat-history-actions">
                <button
                  aria-label={`重命名 ${t.title}`}
                  onClick={() => {
                    setRename(t);
                    setTitle(t.title);
                  }}
                >
                  <Pencil size={13} />
                </button>
                <button
                  aria-label={`删除 ${t.title}`}
                  onClick={() => setDeleting(t)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        {!chat.threads.some((t) =>
          t.title.toLowerCase().includes(query.toLowerCase()),
        ) && <p className="p-3 text-sm text-stone-500">没有找到相关对话</p>}
      </div>
      <div className="chat-local-note">
        仅保存在此浏览器
        <br />
        不同账号的记录互相独立
      </div>
    </div>
  );

  const notices = (
    <>
      {!selection && <div className="chat-notice">历史模型设置已保留（{thread.model}）。请选择输入框下方的模型后继续，已有消息不会改变。</div>}
      {selection && !models.includes(thread.model) && !modelError && <div className="chat-notice">正在确认模型目录；若当前模型不可用，请切换模型或思考程度。</div>}
      {modelError && (
        <button className="chat-notice text-left" onClick={loadModels}>
          {modelError}
        </button>
      )}
      {chat.storageError && (
        <div role="alert" className="chat-notice">
          {chat.storageError}
        </div>
      )}
    </>
  );

  const conversationActions = (
    <div className="chat-conversation-actions">
      <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="chat-context-button"><History size={16} />对话历史</button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" sideOffset={8} aria-label="对话历史" className="chat-history-panel p-0">
          {list}
        </PopoverContent>
      </Popover>
      <button type="button" className="chat-context-button" onClick={() => { setHistoryOpen(false); chat.createThread(); }}><Plus size={16} />新建对话</button>
    </div>
  );

  const modelControls = (
    <div className="chat-model-controls">
      <Select
        value={selection?.family || ""}
        disabled={busy}
        onValueChange={(family) => {
          const level = CHAT_LEVELS.find((item) => item.id === selection?.level && models.includes(`${family}-${item.suffix}`))
            || CHAT_LEVELS.find((item) => models.includes(`${family}-${item.suffix}`));
          if (level) choose(family, level.id);
        }}
      >
        <SelectTrigger
          aria-label="选择对话模型"
          className="chat-model-control"
        >
          <SelectValue placeholder="选择模型" />
        </SelectTrigger>
        <SelectContent>
          {CHAT_FAMILIES.map((family) => (
            <SelectItem key={family.id} value={family.id}
              disabled={!CHAT_LEVELS.some((level) => chatLevelAvailable(family.id, level.id, models))}>
              {family.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={selection?.level || ""} disabled={busy || !selection}
        onValueChange={(level) => selection && choose(selection.family, level)}>
        <SelectTrigger aria-label="选择思考程度" className="chat-model-control">
          <SelectValue placeholder="思考程度" />
        </SelectTrigger>
        <SelectContent>
          {CHAT_LEVELS.map((level) => <SelectItem key={level.id} value={level.id}
            disabled={!selection || !chatLevelAvailable(selection.family, level.id, models)}>
            {level.label}
          </SelectItem>)}
        </SelectContent>
      </Select>
      <button type="button" className="chat-icon-button" aria-label="对话设置" title="对话设置" onClick={() => setSettings(true)}>
        <Settings2 size={17} />
      </button>
    </div>
  );

  return (
    <div className="chat-workspace">
      <section className="chat-main">
        <div
          ref={scroller}
          className="chat-scroll"
          onScroll={(e) => {
            const el = e.currentTarget;
            following.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 90;
            setAtBottom(following.current);
          }}
        >
          {!thread.messages.length ? (
            <div className="chat-welcome">
              <h1 className="studio-empty-title">开始新对话</h1>
              <p className="chat-empty-description">描述想法，或引用图片继续修改。</p>
              <div className="chat-suggestions studio-empty-actions">
                {["帮我梳理一个想法", "润色一段文案", "一起分析一张图片"].map(
                  (text) => (
                    <button
                      key={text}
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent("chat-suggestion", { detail: text }),
                        )
                      }
                    >
                      {text}
                    </button>
                  ),
                )}
              </div>
            </div>
          ) : (
            <div className="chat-messages">
              {thread.messages.map((message, index) => (
                <article
                  key={message.id}
                  className={`chat-message ${message.role}`}
                >
                  <div className="chat-message-label" title={message.role === "assistant" ? `请求模型：${message.model || "未知"}；不代表上游实际执行型号的独立验证。` : undefined}>
                    {message.role === "user"
                      ? "你"
                      : chatModelLabel(message.model || "助手")}
                  </div>
                  {!!message.images?.length && (
                    <div className="chat-message-images">
                      {message.images.map((img) => (
                        <button
                          key={img.id}
                          onClick={() => setPreview(img)}
                          aria-label={`预览 ${img.name}`}
                        >
                          <img src={img.url} alt={img.name} />
                        </button>
                      ))}
                    </div>
                  )}
                  {message.role === "user" ? (
                    <div className="chat-user-text">{message.text}</div>
                  ) : (
                    <div className="chat-markdown">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          pre: CodeBlock,
                          a: ({ children, ...props }) => (
                            <a
                              {...props}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {children}
                            </a>
                          ),
                        }}
                      >
                        {message.text}
                      </ReactMarkdown>
                    </div>
                  )}
                  {message.status === "streaming" && (
                    <div className="chat-generating" role="status">
                      <span />
                      {message.text ? "正在回复" : "正在等待模型回复…"}
                    </div>
                  )}
                  {message.status === "stopped" && (
                    <p className="chat-message-status">
                      已停止 · 已保留收到的内容
                    </p>
                  )}
                  {message.error && (
                    <p role="alert" className="chat-message-error">
                      {message.error}
                    </p>
                  )}
                  {message.role === "assistant" &&
                    message.status !== "streaming" && (
                      <div className="chat-message-actions">
                        <button
                          disabled={!message.text}
                          onClick={async () => {
                            if (await copy(message.text))
                              toast.success("已复制回答");
                          }}
                        >
                          <Copy size={13} />
                          复制
                        </button>
                        {index === thread.messages.length - 1 && (
                          <button
                            disabled={!canSend || !!chat.busyId}
                            onClick={() => { if (canSend) void chat.send("", [], true); }}
                          >
                            <RotateCcw size={13} />
                            {message.status === "error" ? "重试" : "重新生成"}
                          </button>
                        )}
                      </div>
                    )}
                </article>
              ))}
            </div>
          )}
        </div>
        {!atBottom && (
          <button
            className="chat-jump"
            aria-label="回到最新消息"
            onClick={() => {
              following.current = true;
              setAtBottom(true);
              scroller.current?.scrollTo({
                top: scroller.current.scrollHeight,
                behavior: "smooth",
              });
            }}
          >
            <ArrowDown size={16} />
          </button>
        )}
        {chat.busyId && !busy && (
          <p className="chat-other-busy">
            另一段对话正在回复。
            <button onClick={() => chat.select(chat.busyId!)}>前往查看</button>{" "}
            · <button onClick={chat.stop}>停止回复</button>
          </p>
        )}
        <Composer
          key={`${owner}:${thread.id}`}
          busy={busy}
          disabled={!!chat.busyId || !canSend}
          onSend={(text, images) => { if (canSend) void chat.send(text, images); }}
          onStop={chat.stop}
          onPreview={setPreview}
          conversationActions={conversationActions}
          modelControls={modelControls}
          notices={notices}
        />
      </section>
      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>对话设置</DialogTitle>
            <DialogDescription>仅影响当前对话的后续请求。</DialogDescription>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            思考程度可在输入框下方选择；即时 / Pro 是回答模式，中 / 高 / 极高是思考档位。极高与 Pro 需要可用的 Pro 账号，目录可见不保证额度可用。
          </p>
          <label className="space-y-2 text-sm">
            <span>系统提示词</span>
            <Textarea
              value={thread.system}
              disabled={busy}
              onChange={(e) =>
                chat.update(thread.id, { system: e.target.value })
              }
              placeholder="例如：请用简洁的中文回答。"
              className="min-h-32"
            />
          </label>
          <p className="text-xs leading-5 text-muted-foreground">
            本页不会默认启用联网搜索。搜索专用模型由现有后端处理；普通模型不保证能获取实时信息。
          </p>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!rename}
        onOpenChange={(open) => {
          if (!open) setRename(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名对话</DialogTitle>
            <DialogDescription>
              给这段对话起一个方便查找的名字。
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (rename && title.trim()) {
                chat.update(rename.id, { title: title.trim() });
                setRename(null);
              }
            }}
          >
            <Input
              aria-label="对话名称"
              value={title}
              maxLength={80}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
            <Button className="mt-4" disabled={!title.trim()}>
              保存
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除这段对话？</DialogTitle>
            <DialogDescription>
              「{deleting?.title}」的本地消息和图片将被移除，无法恢复。
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleting) chat.remove(deleting.id);
                setDeleting(null);
              }}
            >
              删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-5">{preview?.name}</DialogTitle>
            <DialogDescription>图片预览</DialogDescription>
          </DialogHeader>
          {preview && (
            <img
              src={preview.url}
              alt={preview.name}
              className="max-h-[70dvh] w-full object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Composer({
  busy,
  disabled,
  onSend,
  onStop,
  onPreview,
  conversationActions,
  modelControls,
  notices,
}: {
  busy: boolean;
  disabled: boolean;
  onSend: (text: string, images: ChatImage[]) => void;
  onStop: () => void;
  onPreview: (image: ChatImage) => void;
  conversationActions: ReactNode;
  modelControls: ReactNode;
  notices: ReactNode;
}) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<ChatImage[]>([]);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const readingRef = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const handler = (e: Event) => {
      setText((e as CustomEvent<string>).detail);
      input.current?.focus();
    };
    window.addEventListener("chat-suggestion", handler);
    return () => {
      mounted.current = false;
      window.removeEventListener("chat-suggestion", handler);
    };
  }, []);
  useEffect(() => {
    if (input.current) {
      input.current.style.height = "auto";
      input.current.style.height = `${Math.min(input.current.scrollHeight, 180)}px`;
    }
  }, [text]);
  const addImages = async (incoming: File[]) => {
    if (disabled || readingRef.current || !incoming.length) return;
    if (images.length + incoming.length > 4) {
      toast.error("每条消息最多 4 张图片");
      return;
    }
    readingRef.current = true;
    setReading(true);
    try {
      const added = await Promise.all(incoming.map(readImage));
      if (mounted.current) setImages((current) => [...current, ...added]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片读取失败");
    } finally {
      readingRef.current = false;
      if (mounted.current) setReading(false);
    }
  };
  const submit = () => {
    if (disabled || reading || (!text.trim() && !images.length)) return;
    onSend(text, images);
    setText("");
    setImages([]);
    input.current?.focus();
  };
  return (
    <div className="chat-composer-wrap">
      {notices}
      {conversationActions}
      <div
        className={`chat-composer ${dragging ? "dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node))
            setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void addImages(Array.from(e.dataTransfer.files));
        }}
      >
        {!!images.length && (
          <div className="chat-attachments">
            {images.map((img) => (
              <div key={img.id}>
                <button
                  aria-label={`预览 ${img.name}`}
                  onClick={() => onPreview(img)}
                >
                  <img src={img.url} alt={img.name} />
                </button>
                <button
                  className="chat-remove-image"
                  aria-label={`移除 ${img.name}`}
                  onClick={() =>
                    setImages(images.filter((i) => i.id !== img.id))
                  }
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={input}
          aria-label="输入消息"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={1}
          placeholder={
            dragging ? "松开以添加图片" : "发送消息，或粘贴一张图片…"
          }
          onPaste={(e) => {
            const pasted = Array.from(e.clipboardData.files);
            if (pasted.length) {
              e.preventDefault();
              void addImages(pasted);
            }
          }}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              e.nativeEvent.keyCode !== 229
            ) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="chat-composer-actions">
          <input
            ref={files}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            hidden
            onChange={(e) => {
              void addImages(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
          {modelControls}
          <button
            className="chat-icon-button chat-attachment-button"
            disabled={disabled || reading}
            aria-label="添加图片"
            title="最多 4 张，每张不超过 10MB"
            onClick={() => files.current?.click()}
          >
            {reading ? (
              <LoaderCircle size={18} className="animate-spin" />
            ) : (
              <ImagePlus size={18} />
            )}
          </button>
          {busy ? (
            <button
              className="chat-send"
              aria-label="停止生成"
              onClick={onStop}
            >
              <span>停止</span><Square size={15} fill="currentColor" />
            </button>
          ) : (
            <button
              className="chat-send"
              aria-label="发送消息"
              disabled={disabled || reading || (!text.trim() && !images.length)}
              onClick={submit}
            >
              <span>发送</span><ArrowRight size={17} />
            </button>
          )}
        </div>
      </div>
      <p className="chat-composer-footnote">
        回答可能有误，请核实重要信息。历史仅保存在当前浏览器。
      </p>
    </div>
  );
}
