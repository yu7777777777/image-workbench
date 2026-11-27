import { readChatResources, recordValue, type ChatResource } from "./chat-resources";

// randomUUID is unavailable on non-HTTPS deployments; getRandomValues also works there.
export function createChatId(): string {
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) =>
    value.toString(16).padStart(8, "0"),
  ).join("");
}

export type ChatContent =
  | string
  | (
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    )[];
export type RequestMessage = {
  role: "system" | "user" | "assistant";
  content: ChatContent;
};

function errorText(value: unknown): string {
  if (typeof value === "string") {
    if (/token_expired|token_invalidated|token_revoked|authentication token is expired/i.test(value))
      return "模型账号认证已失效，请重试；若持续失败，请联系管理员检查账号授权。";
    return value;
  }
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return errorText(item.message || item.error || item.detail);
  }
  return "";
}

export type ChatStreamStatusStage =
  | "thinking"
  | "searching"
  | "tool"
  | "retrying"
  | "answering";

export type ChatStreamStatus = {
  stage: ChatStreamStatusStage;
  label?: string;
  detail?: string;
  thoughts?: string[];
  thoughtDurationSec?: number;
};

const CHAT_STREAM_STAGES = new Set<string>([
  "thinking",
  "searching",
  "tool",
  "retrying",
  "answering",
]);

export function readChatStreamStatus(raw: unknown): ChatStreamStatus | undefined {
  const item = recordValue(raw);
  if (!item || typeof item.stage !== "string") return undefined;
  const stage = item.stage.trim();
  if (!CHAT_STREAM_STAGES.has(stage)) return undefined;

  const status: ChatStreamStatus = { stage: stage as ChatStreamStatusStage };

  if (typeof item.label === "string") {
    const label = item.label.trim().slice(0, 120);
    if (label) status.label = label;
  }
  if (typeof item.detail === "string") {
    const detail = item.detail.trim().slice(0, 280);
    if (detail) status.detail = detail;
  }
  if (Array.isArray(item.thoughts)) {
    const thoughts: string[] = [];
    for (const entry of item.thoughts) {
      if (typeof entry !== "string") continue;
      const cleaned = entry.trim().slice(0, 280);
      if (cleaned) thoughts.push(cleaned);
      if (thoughts.length >= 12) break;
    }
    if (thoughts.length) status.thoughts = thoughts;
  }
  if (
    typeof item.thoughtDurationSec === "number"
    && Number.isSafeInteger(item.thoughtDurationSec)
    && item.thoughtDurationSec >= 0
  ) {
    status.thoughtDurationSec = item.thoughtDurationSec;
  }

  return status;
}

// Decode frames, not network chunks: UTF-8 and SSE boundaries may split anywhere.
export async function readChatResponse(
  response: Response,
  onText: (text: string) => void,
  onResources?: (resources: ChatResource[]) => void,
  onStatus?: (status: ChatStreamStatus) => void,
): Promise<void> {
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(errorText(payload) || `请求失败 (${response.status})`);
  }
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    const payload = recordValue(await response.json());
    if (payload?.error) throw new Error(errorText(payload.error));
    const choice = Array.isArray(payload?.choices) ? recordValue(payload.choices[0]) : undefined;
    const text = recordValue(choice?.message)?.content;
    const workbench = recordValue(payload?.workbench);
    const status = onStatus ? readChatStreamStatus(workbench?.status) : undefined;
    const resources = onResources ? readChatResources(workbench?.blocks) : [];
    const hasText = typeof text === "string" && Boolean(text);
    if (status) onStatus?.(status);
    if (!hasText && !resources.length)
      throw new Error("模型没有返回内容，请重试或更换模型");
    if (hasText) onText(text);
    if (resources.length) onResources?.(resources);
    return;
  }
  if (!response.body) throw new Error("无法读取回复流");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let complete = false;
  let hasContent = false;
  const frame = (raw: string) => {
    const data = raw
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    if (data.trim() === "[DONE]") {
      complete = true;
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      // 上游偶发返回非 JSON 的 data 行（网关错误页片段等），避免裸 SyntaxError 打断整个流
      throw new Error(`收到无法解析的回复帧：${data.slice(0, 120)}`);
    }
    const event = recordValue(payload);
    if (event?.error) {
      throw new Error(errorText(event.error) || "生成失败");
    }
    const workbench = recordValue(event?.workbench);
    if (onStatus) {
      const status = readChatStreamStatus(workbench?.status);
      if (status) onStatus(status);
    }
    const choice = Array.isArray(event?.choices) ? recordValue(event.choices[0]) : undefined;
    const text = recordValue(choice?.delta)?.content;
    if (typeof text === "string" && text) {
      hasContent = true;
      onText(text);
    }
    if (onResources) {
      const resources = readChatResources(workbench?.blocks);
      if (resources.length) {
        hasContent = true;
        onResources(resources);
      }
    }
    if (choice?.finish_reason) complete = true;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      pending = pending.replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = pending.indexOf("\n\n")) !== -1) {
        frame(pending.slice(0, boundary));
        pending = pending.slice(boundary + 2);
      }
      if (done) break;
    }
    if (pending.trim()) frame(pending);
    if (!complete) throw new Error("连接提前断开，已保留收到的内容，请重试");
    if (!hasContent) throw new Error("模型没有返回内容，请重试或更换模型");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function isChatModel(id: string): boolean {
  return !/image|dall-e|flux|stable.diffusion|midjourney|sora|embedding|whisper|tts/i.test(
    id,
  );
}
