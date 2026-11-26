import { isValidElement, memo, useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { Check, Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { prepareReplyMarkdown } from "@/lib/chat-rich-reply";
import "katex/dist/katex.min.css";

export async function copyReplyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    toast.error("复制失败，请手动选择文字复制");
    return false;
  }
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

function downloadCsv(source: string): void {
  const url = URL.createObjectURL(new Blob(["\uFEFF", source], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "reply.csv";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function CodeBlock({ children, streaming }: { children?: ReactNode; streaming: boolean }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const code = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children.props : undefined;
  const language = code?.className?.match(/\blanguage-([\w.+-]+)/)?.[1]?.toLowerCase();
  const source = typeof code?.children === "string" ? code.children : "";
  const diagram = language === "mermaid" && Boolean(source) && !streaming;
  return (
    <div className="chat-code">
      <div className="chat-code-tools">
        {language && <span>{language}</span>}
        <div>
          {language === "csv" && source && !streaming && (
            <button type="button" onClick={() => downloadCsv(source)}><Download size={13} />下载 CSV 正文</button>
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
      {diagram ? (
        <details className="chat-code-source"><summary>查看源码</summary><pre ref={ref}>{children}</pre></details>
      ) : <pre ref={ref}>{children}</pre>}
    </div>
  );
}

export const ReplyMarkdown = memo(function ReplyMarkdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
      rehypePlugins={[[rehypeKatex, { trust: false, strict: "ignore" }]]}
      urlTransform={(url, key, node) => (node.tagName === "a" && key === "href" && url.startsWith("sandbox:")) ? url : defaultUrlTransform(url)}
      components={{
        pre: ({ children }) => <CodeBlock streaming={streaming}>{children}</CodeBlock>,
        a: ({ node: _node, children, href, ...props }) => href?.startsWith("sandbox:") ? (
          <span className="chat-unavailable-link" title="附件未随回复返回">{children}（附件未返回）</span>
        ) : href ? <a {...props} href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
      }}
    >
      {prepareReplyMarkdown(text)}
    </ReactMarkdown>
  );
});
