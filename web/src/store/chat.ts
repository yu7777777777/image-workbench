"use client";

import { create } from "zustand";
import localforage from "localforage";
import webConfig from "@/constants/common-env";
import { bearerAuthHeader } from "@/lib/auth-key";
import { getStoredAuthSession } from "@/store/auth";
import { mergeChatResources, readChatResources, type ChatResource } from "@/lib/chat-resources";
import {
  createChatId,
  readChatResponse,
  type ChatStreamStatus,
  type RequestMessage,
} from "@/lib/chat-stream";
import {
  defaultEffortForStandaloneChatModel,
  hasStoredStandaloneChatSettings,
  isStandaloneChatModel,
  readStandaloneChatSettings,
  saveStandaloneChatSettings,
} from "@/lib/standalone-chat-settings";

export type ChatImage = { id: string; name: string; url: string };
export type ChatMessageThinking = {
  stage?: ChatStreamStatus["stage"];
  label?: string;
  detail?: string;
  thoughts?: string[];
  durationSec?: number;
  done?: boolean;
};
export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  writingDrafts?: Record<number, string>;
  resources?: ChatResource[];
  images?: ChatImage[];
  model?: string;
  status?: "streaming" | "done" | "stopped" | "error";
  error?: string;
  startedAt?: number;
  thinking?: ChatMessageThinking;
};
export type ChatThread = {
  id: string;
  title: string;
  updatedAt: number;
  model: string;
  effort: string;
  system: string;
  messages: ChatMessage[];
};
type Snapshot = { threads: ChatThread[]; activeId: string; lastModel?: string };
type ChatState = {
  owner: string;
  ready: boolean;
  storageError: string;
  threads: ChatThread[];
  activeId: string;
  busyId: string | null;
  load: (owner: string) => Promise<void>;
  createThread: () => void;
  select: (id: string) => void;
  update: (
    id: string,
    patch: Partial<Pick<ChatThread, "title" | "model" | "effort" | "system">>,
  ) => void;
  remove: (id: string) => void;
  saveWritingDraft: (threadId: string, messageId: string, offset: number, text: string) => Promise<void>;
  send: (text: string, images: ChatImage[], retry?: boolean) => Promise<void>;
  stop: () => void;
};
const storage = localforage.createInstance({
  name: "chatgpt2api",
  storeName: "chat_conversations",
});
let generation = 0;
let controller: AbortController | null = null;
let writeQueue = Promise.resolve();
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const makeThread = (model: string, effort = model.endsWith("-thinking") ? "standard" : ""): ChatThread => ({
  id: createChatId(),
  title: "新对话",
  updatedAt: Date.now(),
  model,
  effort,
  system: "",
  messages: [],
});

async function persist(): Promise<void> {
  const { owner, ready, threads, activeId } =
    useChatStore.getState();
  if (!owner || !ready) return;
  const snapshot: Snapshot = { threads, activeId };
  writeQueue = writeQueue
    .then(async () => {
      await storage.setItem(owner, snapshot);
    })
    .catch(() => {
      if (useChatStore.getState().owner === owner)
        useChatStore.setState({
          storageError:
            "历史记录保存失败，可能是浏览器空间不足。请勿关闭页面。",
        });
    });
  await writeQueue;
}
function saveSoon(): void {
  if (saveTimer) return;
  const owner = useChatStore.getState().owner;
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    if (useChatStore.getState().owner !== owner) return;
    persist();
  }, 500);
}

export const useChatStore = create<ChatState>((set, get) => ({
  owner: "",
  ready: false,
  storageError: "",
  threads: [],
  activeId: "",
  busyId: null,
  load: async (owner) => {
    if (get().owner === owner && get().ready) return;
    controller?.abort();
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
    }
    const ticket = ++generation;
    set({
      owner,
      ready: false,
      threads: [],
      activeId: "",
      busyId: null,
      storageError: "",
    });
    try {
      await writeQueue;
      const saved = await storage.getItem<Snapshot>(owner);
      if (ticket !== generation) return;
      if (
        saved?.lastModel
        && !hasStoredStandaloneChatSettings(owner)
        && isStandaloneChatModel(saved.lastModel)
      ) {
        saveStandaloneChatSettings(owner, {
          model: saved.lastModel,
          effort: defaultEffortForStandaloneChatModel(saved.lastModel),
        });
      }
      const defaults = readStandaloneChatSettings(owner);
      const threads: ChatThread[] = (saved?.threads || []).map((thread) => ({
        ...thread,
        messages: thread.messages.map((message) => {
          const interrupted = message.status === "streaming";
          const thinking = message.thinking
            ? (interrupted && !message.thinking.done ? { ...message.thinking, done: true } : message.thinking)
            : undefined;
          return {
            ...message,
            status: interrupted ? ("stopped" as const) : message.status,
            ...(thinking !== undefined ? { thinking } : {}),
            ...(message.resources !== undefined ? { resources: readChatResources(message.resources) } : {}),
          };
        }),
      }));
      if (!threads.length) {
        threads.push(makeThread(defaults.model, defaults.effort));
      }
      set({
        threads,
        activeId: threads.some((t) => t.id === saved?.activeId)
          ? saved!.activeId
          : threads[0].id,
        ready: true,
      });
    } catch {
      if (ticket !== generation) return;
      const defaults = readStandaloneChatSettings(owner);
      const thread = makeThread(defaults.model, defaults.effort);
      set({
        threads: [thread],
        activeId: thread.id,
        ready: true,
        storageError: "无法读取本地历史，请检查浏览器存储权限。",
      });
    }
  },
  createThread: () => {
    const defaults = readStandaloneChatSettings(get().owner);
    const thread = makeThread(defaults.model, defaults.effort);
    set({ threads: [thread, ...get().threads], activeId: thread.id });
    persist();
  },
  select: (id) => {
    set({ activeId: id });
    persist();
  },
  saveWritingDraft: (threadId, messageId, offset, text) => {
    set({
      threads: get().threads.map((thread) => {
        if (thread.id !== threadId) return thread;
        return {
          ...thread,
          messages: thread.messages.map((message) => {
            if (message.id !== messageId || message.role !== "assistant" || message.status === "streaming") return message;
            return { ...message, writingDrafts: { ...message.writingDrafts, [offset]: text } };
          }),
        };
      }),
    });
    return persist();
  },
  update: (id, patch) => {
    set({
      threads: get().threads.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    });
    persist();
  },
  remove: (id) => {
    if (get().busyId === id) get().stop();
    const threads = get().threads.filter((t) => t.id !== id);
    if (!threads.length) {
      const defaults = readStandaloneChatSettings(get().owner);
      threads.push(makeThread(defaults.model, defaults.effort));
    }
    set({
      threads,
      activeId: get().activeId === id ? threads[0].id : get().activeId,
    });
    persist();
  },
  stop: () => {
    controller?.abort();
  },
  send: async (text, images, retry = false) => {
    const state = get();
    const thread = state.threads.find((t) => t.id === state.activeId);
    if (!thread || state.busyId || !state.ready) return;
    let previous = thread.messages;
    if (retry) {
      const index = previous.map((m) => m.role).lastIndexOf("user");
      if (index < 0) return;
      previous = previous.slice(0, index + 1);
    } else {
      if (!text.trim() && !images.length) return;
      previous = [
        ...previous,
        { id: createChatId(), role: "user", text: text.trim(), images },
      ];
    }
    const startedAt = Date.now();
    const isDeepEffort =
      thread.effort === "high"
      || thread.effort === "xhigh"
      || thread.effort === "extended"
      || thread.effort === "max";
    let thinking: ChatMessageThinking | undefined = thread.effort
      ? {
          stage: "thinking",
          label: isDeepEffort ? "正在深度思考" : "正在思考",
        }
      : undefined;
    const answer: ChatMessage = {
      id: createChatId(),
      role: "assistant",
      text: "",
      model: thread.model,
      status: "streaming",
      startedAt,
      ...(thinking ? { thinking } : {}),
    };
    const ticket = generation;
    const abort = new AbortController();
    controller = abort;
    const patchAnswer = (patch: Partial<ChatMessage>) => {
      if (ticket !== generation) return;
      set({
        threads: get().threads.map((t) =>
          t.id === thread.id
            ? {
                ...t,
                messages: t.messages.map((m) =>
                  m.id === answer.id ? { ...m, ...patch } : m,
                ),
              }
            : t,
        ),
      });
    };
    set({
      busyId: thread.id,
      threads: state.threads.map((t) =>
        t.id === thread.id
          ? {
              ...t,
              messages: [...previous, answer],
              updatedAt: Date.now(),
              title: t.messages.length
                ? t.title
                : (text.trim() || images[0]?.name || "图片对话").slice(0, 28),
            }
          : t,
      ),
    });
    persist();
    try {
      const session = await getStoredAuthSession();
      if (!session || `${session.role}:${session.subjectId}` !== state.owner)
        throw new Error("登录状态已变化，请刷新页面后重试");
      const messages: RequestMessage[] = previous
        .filter((m) => m.role === "user" || (m.status === "done" && m.text))
        .map((m) => ({
          role: m.role,
          content: m.images?.length
            ? [
                { type: "text", text: m.text },
                ...m.images.map((img) => ({
                  type: "image_url" as const,
                  image_url: { url: img.url },
                })),
              ]
            : m.text,
        }));
      if (thread.system.trim())
        messages.unshift({ role: "system", content: thread.system.trim() });
      const response = await fetch(`${webConfig.apiUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: bearerAuthHeader(session.key),
        },
        body: JSON.stringify({
          model: thread.model,
          messages,
          stream: true,
          rich_content: true,
          ...(thread.effort ? { reasoning_effort: thread.effort } : {}),
          ...(retry ? { metadata: { chat_retry_id: answer.id } } : {}),
        }),
        signal: abort.signal,
      });
      let output = "";
      let resources: ChatResource[] = [];
      let thinkingFinalized = false;
      const mergeThoughts = (
        prev: readonly string[] | undefined,
        next: readonly string[] | undefined,
      ): string[] | undefined => {
        if (!next?.length) return prev?.length ? [...prev] : undefined;
        const merged: string[] = [];
        const seen = new Set<string>();
        for (const item of [...(prev ?? []), ...next]) {
          if (!seen.has(item)) {
            seen.add(item);
            merged.push(item);
          }
        }
        return merged.slice(-12);
      };
      await readChatResponse(
        response,
        (delta) => {
          if (abort.signal.aborted) return;
          const isFirst = !output;
          output += delta;
          const patch: Partial<ChatMessage> = { text: output };
          if (isFirst && !thinkingFinalized) {
            thinkingFinalized = true;
            const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
            if (thinking || elapsedSec >= 3) {
              thinking = {
                ...thinking,
                stage: "answering",
                done: true,
                durationSec: thinking?.durationSec ?? Math.max(1, elapsedSec),
              };
              patch.thinking = thinking;
            }
          }
          patchAnswer(patch);
          saveSoon();
        },
        (incoming) => {
          if (abort.signal.aborted) return;
          resources = mergeChatResources(resources, incoming);
          patchAnswer({ resources });
          saveSoon();
        },
        (status) => {
          if (abort.signal.aborted) return;
          const prevThoughts = thinking?.thoughts;
          const nextThoughts = mergeThoughts(prevThoughts, status.thoughts);
          const thoughtsChanged =
            nextThoughts?.length !== prevThoughts?.length
            || Boolean(nextThoughts?.some((item, idx) => item !== prevThoughts?.[idx]));
          const stageChanged = status.stage !== thinking?.stage;
          const nextDetail =
            status.detail !== undefined
              ? status.detail
              : stageChanged
                ? undefined
                : thinking?.detail;
          thinking = {
            ...thinking,
            stage: status.stage,
            label: status.label ?? (stageChanged ? undefined : thinking?.label),
            ...(nextDetail !== undefined ? { detail: nextDetail } : { detail: undefined }),
            ...(nextThoughts ? { thoughts: nextThoughts } : {}),
            ...(status.thoughtDurationSec !== undefined
              ? { durationSec: status.thoughtDurationSec }
              : {}),
            ...(thinking?.done ? { done: true } : {}),
          };
          patchAnswer({ thinking });
          if (thoughtsChanged) saveSoon();
        },
      );
      if (thinking && !thinking.done) {
        thinking = {
          ...thinking,
          done: true,
          durationSec:
            thinking.durationSec ?? Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
        };
      }
      patchAnswer({
        status: "done",
        ...(thinking ? { thinking } : {}),
      });
    } catch (error) {
      if (thinking && !thinking.done) {
        const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
        thinking = {
          ...thinking,
          done: true,
          durationSec: thinking.durationSec ?? elapsedSec,
        };
      }
      patchAnswer({
        status: abort.signal.aborted ? "stopped" : "error",
        ...(thinking ? { thinking } : {}),
        error: abort.signal.aborted
          ? undefined
          : error instanceof Error
            ? error.message
            : "请求失败，请重试",
      });
    } finally {
      if (ticket === generation) {
        controller = null;
        set({ busyId: null });
        persist();
      }
    }
  },
}));
