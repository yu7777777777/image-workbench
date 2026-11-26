import { isValidElement, memo, useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { Check, Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { prepareReplyMarkdown } from "@/lib/chat-rich-reply";
import { attachmentPath, type ChatResource } from "@/lib/chat-resources";
import { ReplyChart } from "./chat-chart";
import { StaticCodePreview, readVegaChart } from "./chat-code-preview";
import { ChatAttachment, ChatResourceLink } from "./chat-resource-view";
import "katex/dist/katex.min.css";

export async function copyReplyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to the browser's copy command on HTTP or when clipboard access is denied.
  }

  const focused = document.activeElement;
  const selection = window.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
  document.body.append(field);
  try {
    field.focus({ preventScroll: true });
    field.select();
    if (document.execCommand("copy")) return true;
  } catch {
    // Both clipboard mechanisms can be blocked by the browser.
  } finally {
    field.remove();
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
  }
  toast.error("复制失败，请手动选择文字复制");
  return false;
}

let mermaidId = 0;
let mermaidLoader: Promise<typeof import("mermaid")["default"]> | undefined;

function loadMermaid() {
  mermaidLoader ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      htmlLabels: false,
      maxTextSize: 15000,
      maxEdges: 100,
      suppressErrorRendering: true,
      theme: "neutral",
    });
    return mermaid;
  }).catch((error: unknown) => {
    mermaidLoader = undefined;
    throw error;
  });
  return mermaidLoader;
}

function MermaidPreview({ source }: { source: string }) {
  const [preview, setPreview] = useState<{ url: string; width?: number }>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    // Keep the diagram's configuration under the application's control.
    if (source.length > 15000 || /^\s*---|%%\s*\{|(?:img|icon)\s*:/im.test(source)) {
      setFailed(true);
      return;
    }
    let active = true;
    let url = "";
    void loadMermaid()
      .then((mermaid) => mermaid.render(`chat-mermaid-${++mermaidId}`, source))
      .then(({ svg }) => {
        if (!active) return;
        const viewBox = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement.getAttribute("viewBox");
        const width = Number(viewBox?.trim().split(/[\s,]+/)[2]);
        url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        setPreview({ url, width: Number.isFinite(width) && width > 0 ? Math.ceil(width) : undefined });
      })
      .catch(() => { if (active) setFailed(true); });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [source]);
  if (failed) return <p className="chat-code-status">暂时无法预览此 Mermaid 图，可查看源码。</p>;
  return preview
    ? <figure className="chat-diagram"><img src={preview.url} width={preview.width} alt="Mermaid 图表" /></figure>
    : <p className="chat-code-status" role="status">正在渲染图表…</p>;
}

function downloadText(source: string, format: "csv" | "txt", filename: string): void {
  const mime = format === "csv" ? "text/csv" : "text/plain";
  const url = URL.createObjectURL(new Blob([format === "csv" ? "\uFEFF" : "", source], { type: `${mime};charset=utf-8` }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CodeBlock({ children, streaming, filenames }: { children?: ReactNode; streaming: boolean; filenames?: ReadonlyMap<string, string> }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const code = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children.props : undefined;
  const language = code?.className?.match(/\blanguage-([\w.+-]+)/)?.[1]?.toLowerCase();
  const source = typeof code?.children === "string" ? code.children : "";
  const diagram = language === "mermaid" && Boolean(source) && !streaming;
  const staticPreview = /^(html|jsx|tsx|svg)$/.test(language ?? "") && source.length <= 30000;
  const vega = !streaming && /^(json|vega-lite|vegalite)$/.test(language ?? "") ? readVegaChart(source) : undefined;
  const canPreview = Boolean(source) && !streaming && (staticPreview || vega);
  const format = language === "csv" ? "csv" : /^(?:text|txt|plaintext)$/.test(language ?? "") ? "txt" : undefined;
  return (
    <div className="chat-code">
      <div className="chat-code-tools">
        {language && <span>{language}</span>}
        <div>
          {canPreview && <button type="button" aria-pressed={showPreview} onClick={() => setShowPreview((value) => !value)}>{showPreview ? "查看代码" : "预览"}</button>}
          {format && source && !streaming && (
            <button type="button" onClick={() => downloadText(source, format, filenames?.get(format) ?? `reply.${format}`)}><Download size={13} />下载 {format.toUpperCase()} 正文</button>
          )}
          <button
            type="button"
            aria-label="复制代码"
            onClick={async () => {
              if (await copyReplyText(source || ref.current?.textContent || "")) setCopied(true);
            }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "已复制" : "复制代码"}
          </button>
        </div>
      </div>
      {diagram && <MermaidPreview key={source} source={source} />}
      {canPreview && showPreview ? (
        vega ? <div className="chat-code-chart"><ReplyChart {...vega} /></div> : <StaticCodePreview source={source} language={language!} />
      ) : diagram ? (
        <details className="chat-code-source"><summary>查看源码</summary><pre ref={ref}>{children}</pre></details>
      ) : <pre ref={ref}>{children}</pre>}
    </div>
  );
}

export type ReplyMarkdownResources = {
  filenames?: ReadonlyMap<string, string>;
  citations?: ReadonlyMap<string, string>;
  inlineSources?: ReadonlyMap<string, ChatResource>;
  attachments?: ReadonlyMap<string, ChatResource>;
  owner?: string;
};

export const ReplyMarkdown = memo(function ReplyMarkdown({
  text, streaming = false, filenames, citations, inlineSources, attachments, owner,
}: { text: string; streaming?: boolean } & ReplyMarkdownResources) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
      rehypePlugins={[[rehypeKatex, { trust: false, strict: "ignore" }]]}
      urlTransform={(url, key, node) => (
        node.tagName === "a" && key === "href" && (url.startsWith("sandbox:") || url.startsWith("workbench-cite:"))
      ) ? url : defaultUrlTransform(url)}
      components={{
        pre: ({ children }) => <CodeBlock streaming={streaming} filenames={filenames}>{children}</CodeBlock>,
        a: ({ node: _node, children, href, ...props }) => {
          if (href?.startsWith("sandbox:")) {
            const path = attachmentPath(href);
            const attachment = path && attachments?.get(path);
            return attachment && owner
              ? <ChatAttachment resource={attachment} owner={owner} inline>{children}</ChatAttachment>
              : <span className="chat-unavailable-link" title="附件未随回复返回">{children}（附件未返回）</span>;
          }
          if (href?.startsWith("workbench-cite:")) {
            const source = inlineSources?.get(href.slice("workbench-cite:".length));
            return source ? <ChatResourceLink resource={source} label={children} /> : <span>{children}</span>;
          }
          return href ? <a {...props} href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>;
        },
      }}
    >
      {prepareReplyMarkdown(text, citations, inlineSources)}
    </ReactMarkdown>
  );
});
