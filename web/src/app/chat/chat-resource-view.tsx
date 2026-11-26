import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText, Globe, ImageOff, Terminal } from "lucide-react";
import { toast } from "sonner";
import webConfig from "@/constants/common-env";
import { bearerAuthHeader } from "@/lib/auth-key";
import { getStoredAuthSession } from "@/store/auth";
import type { ChatResource } from "@/lib/chat-resources";
import type { WidgetImage } from "@/lib/chat-widget";
import "./chat-resource-view.css";

type ResourceProps = { resource: ChatResource };

export async function downloadChatAttachment(resource: ChatResource, owner: string, signal?: AbortSignal): Promise<void> {
  const fromPath = resource.path?.split("/").at(-1);
  const title = resource.title || (fromPath && decodeURIComponent(fromPath)) || "附件";
  const session = await getStoredAuthSession();
  if (!session || `${session.role}:${session.subjectId}` !== owner) {
    throw new Error("登录状态已变化，请重新打开对话");
  }
  const response = await fetch(`${webConfig.apiUrl}/v1/chat/attachments/${encodeURIComponent(resource.id)}`, {
    headers: { Authorization: bearerAuthHeader(session.key) },
    redirect: "error",
    signal,
  });
  if (response.status === 401 || response.status === 403) throw new Error("当前登录无法访问此附件");
  if (response.status === 404 || response.status === 410) throw new Error("附件已失效或无法访问");
  if (!response.ok) throw new Error("文件下载失败，请重试");
  const url = URL.createObjectURL(await response.blob());
  if (signal?.aborted) {
    URL.revokeObjectURL(url);
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = title.replace(/[<>:"\\/|?*\u0000-\u001f\u007f]/g, "_");
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ChatAttachment({ resource, owner, inline = false, children }: ResourceProps & { owner: string; inline?: boolean; children?: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  const fromPath = resource.path?.split("/").at(-1);
  const title = resource.title || (fromPath && decodeURIComponent(fromPath)) || "附件";
  useEffect(() => () => active.current?.abort(), []);

  async function download() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const { signal } = controller;
    setBusy(true);
    try {
      await downloadChatAttachment(resource, owner, signal);
    } catch (error) {
      if (!signal.aborted) toast.error(error instanceof Error ? error.message : "文件下载失败，请重试");
    } finally {
      active.current = null;
      if (!signal.aborted) setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={inline ? "chat-resource-attachment-inline" : "chat-resource-attachment"}
      aria-label={`下载 ${title}`}
      disabled={busy}
      onClick={() => void download()}
    >
      {!inline && <FileText size={17} aria-hidden="true" />}
      <span>{busy ? "正在下载…" : children || title}</span>
      <Download size={14} aria-hidden="true" />
    </button>
  );
}

function PublicImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  return failed
    ? <span className="chat-resource-image-empty" role="img" aria-label={`${alt}加载失败`}><ImageOff size={20} aria-hidden="true" />图片加载失败</span>
    : <img src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

export function ChatResourceImage({ resource }: ResourceProps) {
  if (!resource.imageUrl) return null;
  const title = resource.title || "回复图片";
  const image = <PublicImage key={resource.imageUrl} src={resource.imageUrl} alt={title} />;
  const destination = resource.url || resource.imageUrl;
  return (
    <figure className="chat-resource-image">
      <a href={destination} target="_blank" rel="noopener noreferrer" aria-label={`打开 ${title}`}>{image}</a>
      {resource.title && <figcaption>{resource.title}</figcaption>}
    </figure>
  );
}

export function ChatWidgetImages({ node, images }: { node: WidgetImage; images: ChatResource[] }) {
  const availableImages = images.filter((image): image is ChatResource & { imageUrl: string } => Boolean(image.imageUrl));
  if (!availableImages.length) {
    const message = node.group ? "图片组未返回" : "图片未返回";
    return (
      <span className="chat-widget-image-missing">
        <ImageOff size={14} aria-hidden="true" />
        <span>{node.label ? `${node.label}（${message}）` : message}</span>
      </span>
    );
  }
  return (
    <div className={node.group ? "chat-widget-image-group" : "chat-widget-inline-image"}
      data-bento={node.bento && availableImages.length === 3} data-sized={Boolean(node.maxWidth)}
      style={{ width: node.maxWidth, "--chat-image-ratio": node.aspectRatio } as CSSProperties}>
      {availableImages.map((image) => (
        <figure key={image.id} className="chat-resource-image">
          <a href={image.url || image.imageUrl} target="_blank" rel="noopener noreferrer">
            <PublicImage key={image.imageUrl} src={image.imageUrl} alt={image.title || node.label || "回复图片"} />
          </a>
        </figure>
      ))}
    </div>
  );
}

function ProductCard({ resource }: ResourceProps) {
  const details = (
    <>
      {resource.imageUrl && <div className="chat-resource-product-media"><PublicImage key={resource.imageUrl} src={resource.imageUrl} alt="" /></div>}
      <div className="chat-resource-product-copy">
        <strong>{resource.title}</strong>
        {resource.price && <span className="chat-resource-product-price">{resource.price}</span>}
        {resource.merchant && <span className="chat-resource-muted">{resource.merchant}</span>}
      </div>
      {resource.url && <ExternalLink className="chat-resource-product-open" size={15} aria-hidden="true" />}
    </>
  );
  return resource.url
    ? <a className="chat-resource-product" href={resource.url} target="_blank" rel="noopener noreferrer">{details}</a>
    : <div className="chat-resource-product">{details}</div>;
}

function SiteFavicon({ host }: { host: string }) {
  const [failed, setFailed] = useState(false);
  if (failed || !host) return <Globe size={11} aria-hidden="true" />;
  return (
    <img
      className="chat-resource-cite-favicon"
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`}
      alt=""
      width={12}
      height={12}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function extractPlainLabel(label: ReactNode): string | undefined {
  if (typeof label === "string") return label;
  if (Array.isArray(label) && label.every((item) => typeof item === "string")) return label.join("");
  return undefined;
}

export function ChatResourceLink({
  resource,
  extraResources = [],
  label,
}: ResourceProps & { extraResources?: ChatResource[]; label?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const groupRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (groupRef.current && !groupRef.current.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!resource.url) return null;
  const host = hostOf(resource.url);
  const plainLabel = extractPlainLabel(label)?.trim();
  const autoLabel = label == null || label === false || (plainLabel !== undefined && (!plainLabel || /^来源(?:\s+\d+)?$/.test(plainLabel)));
  const displayLabel = autoLabel ? (host || resource.title || "来源") : label;
  const validExtras = extraResources.filter((item): item is ChatResource & { url: string } => Boolean(item.url));

  if (!validExtras.length) {
    return (
      <a className="chat-resource-cite" href={resource.url} target="_blank" rel="noopener noreferrer" title={resource.title || host}>
        <SiteFavicon host={host} />
        <span className="chat-resource-cite-label">{displayLabel}</span>
      </a>
    );
  }

  const allSources = [resource, ...validExtras];
  return (
    <span className="chat-resource-cite-group" ref={groupRef}>
      <button
        type="button"
        className="chat-resource-cite"
        aria-expanded={open}
        aria-haspopup="menu"
        title={`${resource.title || host} 等 ${allSources.length} 个来源`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <SiteFavicon host={host} />
        <span className="chat-resource-cite-label">{displayLabel}</span>
        <span className="chat-resource-cite-more">+{validExtras.length}</span>
      </button>
      {open && (
        <span className="chat-resource-cite-popover" role="menu">
          {allSources.map((item, idx) => {
            if (!item.url) return null;
            const itemHost = hostOf(item.url);
            return (
              <a
                key={item.id || `${item.url}-${idx}`}
                className="chat-resource-cite-popover-item"
                role="menuitem"
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
              >
                <SiteFavicon host={itemHost} />
                <span className="chat-resource-cite-popover-copy">
                  <span className="chat-resource-cite-popover-title">{item.title || itemHost}</span>
                  {item.title && item.title !== itemHost && (
                    <span className="chat-resource-cite-popover-host">{itemHost}</span>
                  )}
                </span>
              </a>
            );
          })}
        </span>
      )}
    </span>
  );
}

function ImageGallery({ images }: { images: ChatResource[] }) {
  const [index, setIndex] = useState(0);
  const current = Math.min(index, images.length - 1);
  const show = (next: number) => setIndex((next + images.length) % images.length);
  return (
    <section className="chat-resource-gallery" aria-label="回复图片">
      <ChatResourceImage resource={images[current]} />
      {images.length > 1 && (
        <div className="chat-resource-gallery-controls">
          <button type="button" aria-label="上一张图片" onClick={() => show(current - 1)}><ChevronLeft size={17} aria-hidden="true" /></button>
          <span aria-live="polite">{current + 1} / {images.length}</span>
          <button type="button" aria-label="下一张图片" onClick={() => show(current + 1)}><ChevronRight size={17} aria-hidden="true" /></button>
        </div>
      )}
    </section>
  );
}

function ToolResult({ resource }: ResourceProps) {
  const title = resource.title || (resource.type === "python" ? "Python 执行结果" : "工具结果");
  const label = <>
    <Terminal size={16} aria-hidden="true" />{title}
    {resource.status && <span className="chat-resource-tool-status" data-status={resource.status}>{resource.status === "error" ? "执行失败" : "已完成"}</span>}
  </>;
  if (!resource.description && !resource.code && !resource.text && !resource.url) {
    return <p className="chat-resource-tool-status-only">{label}</p>;
  }
  return (
    <details className="chat-resource-tool">
      <summary>{label}</summary>
      <div className="chat-resource-tool-content">
        {resource.description && <p>{resource.description}</p>}
        {resource.code && <pre aria-label="执行代码"><code>{resource.code}</code></pre>}
        {resource.text && <pre aria-label="执行输出"><code>{resource.text}</code></pre>}
        {resource.url && <ChatResourceLink resource={resource} label="打开结果" />}
      </div>
    </details>
  );
}

export function ReplyResourcePanel({ resources, owner }: { resources: ChatResource[]; owner: string }) {
  const attachments = resources.filter(({ type }) => type === "attachment");
  const images = resources.filter(({ type }) => type === "image");
  const seenProducts = new Set<string>();
  const products = resources.filter((resource) => {
    if (resource.type !== "product") return false;
    const key = `${resource.url ?? ""}|${resource.title ?? ""}|${resource.price ?? ""}`;
    if (seenProducts.has(key)) return false;
    seenProducts.add(key);
    return true;
  });
  const results = resources.filter(({ type }) => type === "python" || type === "tool");
  if (!attachments.length && !images.length && !products.length && !results.length) return null;
  return (
    <div className="chat-reply-resources">
      {results.map((resource) => <ToolResult key={resource.id} resource={resource} />)}
      {attachments.map((resource) => <ChatAttachment key={resource.id} resource={resource} owner={owner} />)}
      {images.length > 0 && <ImageGallery images={images} />}
      {products.length > 0 && (
        <div className="chat-resource-products" aria-label="商品">
          {products.map((resource) => <ProductCard key={resource.id} resource={resource} />)}
        </div>
      )}
    </div>
  );
}
