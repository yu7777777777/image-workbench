import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText, ImageOff, Terminal } from "lucide-react";
import { toast } from "sonner";
import webConfig from "@/constants/common-env";
import { getStoredAuthSession } from "@/store/auth";
import type { ChatResource } from "@/lib/chat-resources";
import "./chat-resource-view.css";

type ResourceProps = { resource: ChatResource };

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
      const session = await getStoredAuthSession();
      if (!session || `${session.role}:${session.subjectId}` !== owner) {
        throw new Error("登录状态已变化，请重新打开对话");
      }
      const response = await fetch(`${webConfig.apiUrl}/v1/chat/attachments/${encodeURIComponent(resource.id)}`, {
        headers: { Authorization: `Bearer ${session.key}` },
        redirect: "error",
        signal,
      });
      if (response.status === 401 || response.status === 403) throw new Error("当前登录无法访问此附件");
      if (response.status === 404 || response.status === 410) throw new Error("附件已失效或无法访问");
      if (!response.ok) throw new Error("文件下载失败，请重试");
      const url = URL.createObjectURL(await response.blob());
      if (signal.aborted) {
        URL.revokeObjectURL(url);
        return;
      }
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = title.replace(/[<>:"\\/|?*\u0000-\u001f\u007f]/g, "_");
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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

export function ChatResourceLink({ resource, label }: ResourceProps & { label?: ReactNode }) {
  if (!resource.url) return null;
  const host = new URL(resource.url).hostname.replace(/^www\./, "");
  return (
    <a className="chat-resource-cite" href={resource.url} target="_blank" rel="noopener noreferrer" title={resource.title || host}>
      {label || host}<ExternalLink size={12} aria-hidden="true" />
    </a>
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
  const products = resources.filter(({ type }) => type === "product");
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
