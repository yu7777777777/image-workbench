import { CHAT_FAMILIES, CHAT_LEVELS } from "@/lib/chat-models";
import { isChatModel } from "@/lib/chat-stream";

export type StandaloneChatSettings = {
  model: string;
  effort: string;
};

export const DEFAULT_STANDALONE_CHAT_SETTINGS: StandaloneChatSettings = {
  model: "gpt-6",
  effort: "",
};

const STORAGE_PREFIX = "chatgpt2api-standalone-chat-settings-v1";

function storageKey(owner: string): string {
  return `${STORAGE_PREFIX}:${owner || "anonymous"}`;
}

export function isStandaloneChatModel(model: string): boolean {
  return Boolean(model.trim()) && isChatModel(model);
}

export function defaultEffortForStandaloneChatModel(model: string): string {
  for (const family of CHAT_FAMILIES) {
    if (model === family.id) return "";
    const level = CHAT_LEVELS.find((item) => model === `${family.id}-${item.suffix}`);
    if (level) return level.effort;
  }
  return "";
}

export function hasStoredStandaloneChatSettings(owner: string): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(storageKey(owner)) !== null;
}

export function readStandaloneChatSettings(owner: string): StandaloneChatSettings {
  if (typeof window === "undefined") {
    return DEFAULT_STANDALONE_CHAT_SETTINGS;
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(owner)) || "null") as Partial<StandaloneChatSettings> | null;
    const model = typeof parsed?.model === "string" && isStandaloneChatModel(parsed.model)
      ? parsed.model
      : DEFAULT_STANDALONE_CHAT_SETTINGS.model;
    return {
      model,
      effort: typeof parsed?.effort === "string" ? parsed.effort : defaultEffortForStandaloneChatModel(model),
    };
  } catch {
    return DEFAULT_STANDALONE_CHAT_SETTINGS;
  }
}

export function saveStandaloneChatSettings(owner: string, settings: StandaloneChatSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(owner), JSON.stringify(settings));
}
