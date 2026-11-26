export type ChatResource = {
  id: string;
  type: "attachment" | "python" | "source" | "image" | "product" | "tool";
  ref?: string;
  path?: string;
  title?: string;
  url?: string;
  imageUrl?: string;
  price?: string;
  merchant?: string;
  text?: string;
  code?: string;
  status?: "success" | "error";
  description?: string;
};

const resourceTypes = new Set<ChatResource["type"]>([
  "attachment", "python", "source", "image", "product", "tool",
]);
const resourceKey = /^[\w.:-]{1,160}$/;
const resourceLimit = 128;

export function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function chatExternalUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 8192 || /[\s<>\u0000-\u001f\u007f]/.test(value)) return;
  try {
    const url = new URL(value);
    if ((url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password) return url.href;
  } catch {
    // Invalid addresses cannot be opened.
  }
}

export function chatPublicMediaUrl(value: unknown): string | undefined {
  const href = chatExternalUrl(value);
  if (!href) return;
  const { protocol, hostname } = new URL(href);
  if (protocol === "https:" && /^[a-z0-9][a-z0-9.-]*\.(?:[a-z]{2,}|xn--[a-z0-9-]+)\.?$/i.test(hostname)
    && !/\.(?:localhost|local|internal|test|invalid)\.?$/i.test(hostname)) return href;
}

export function attachmentPath(value: unknown): string | undefined {
  const prefix = "sandbox:/mnt/data/";
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith(prefix)) return;
  try {
    const decoded = decodeURIComponent(value.slice(prefix.length));
    const segments = decoded.split("/");
    if (/[\u0000-\u001f\u007f\\]/.test(decoded) || segments.some((part) => !part || part === "." || part === "..")) return;
    return prefix + segments.map(encodeURIComponent).join("/");
  } catch {
    // Incomplete URL escapes cannot match an attachment.
  }
}

export function readChatResources(value: unknown): ChatResource[] {
  if (!Array.isArray(value)) return [];
  const resources = new Map<string, ChatResource>();
  for (const candidate of value.slice(0, resourceLimit)) {
    const item = recordValue(candidate);
    if (!item || typeof item.id !== "string" || !resourceKey.test(item.id)) continue;
    const type = item.type as ChatResource["type"];
    if (!resourceTypes.has(type)) continue;
    const resource: ChatResource = { id: item.id, type };
    if (typeof item.ref === "string" && resourceKey.test(item.ref)) resource.ref = item.ref;
    const path = attachmentPath(item.path);
    if (path) resource.path = path;
    const url = chatExternalUrl(item.url);
    if (url) resource.url = url;
    const imageUrl = chatPublicMediaUrl(item.imageUrl);
    if (imageUrl) resource.imageUrl = imageUrl;
    if (item.status === "success" || item.status === "error") resource.status = item.status;
    for (const name of ["title", "price", "merchant", "description", "text", "code"] as const) {
      const content = item[name];
      if (typeof content !== "string" || !content.trim()) continue;
      const limit = name === "text" || name === "code" ? 24000 : 1000;
      resource[name] = content.slice(0, limit);
    }
    if (!isVisibleResource(resource)) continue;
    resources.set(resource.id, resource);
  }
  return [...resources.values()];
}

function isVisibleResource(resource: ChatResource): boolean {
  switch (resource.type) {
    case "attachment":
      return Boolean(resource.title || resource.path);
    case "source":
      return Boolean(resource.url);
    case "image":
      return Boolean(resource.imageUrl);
    case "product":
      return Boolean(resource.title && (resource.url || resource.imageUrl || resource.price));
    case "python":
    case "tool":
      return Boolean(resource.text || resource.code || resource.url || resource.description || (resource.title && resource.status));
  }
}

export function mergeChatResources(current: ChatResource[], incoming: ChatResource[]): ChatResource[] {
  const resources = new Map(current.map((resource) => [resource.id, resource]));
  for (const resource of incoming) {
    const existing = resources.get(resource.id);
    if (existing?.type === resource.type) resources.set(resource.id, { ...existing, ...resource });
    else if (!existing && resources.size < resourceLimit) resources.set(resource.id, resource);
  }
  return [...resources.values()];
}
