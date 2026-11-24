import { CHAT_FAMILIES, CHAT_LEVELS, chatChoice } from "@/lib/chat-models";

export type StandaloneChatSettings = {
  model: string;
  effort: string;
};

export const DEFAULT_STANDALONE_CHAT_SETTINGS: StandaloneChatSettings = {
  model: "gpt-6-instant",
  effort: "",
};

const STORAGE_PREFIX = "chatgpt2api-standalone-chat-settings-v1";

function storageKey(owner: string): string {
  return `${STORAGE_PREFIX}:${owner || "anonymous"}`;
}

function isSupportedModel(model: string): boolean {
  return CHAT_FAMILIES.some((family) =>
    CHAT_LEVELS.some((level) => model === `${family.id}-${level.suffix}`),
  );
}

export function readStandaloneChatSettings(owner: string): StandaloneChatSettings {
  if (typeof window === "undefined") {
    return DEFAULT_STANDALONE_CHAT_SETTINGS;
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(owner)) || "null") as Partial<StandaloneChatSettings> | null;
    const model = typeof parsed?.model === "string" && isSupportedModel(parsed.model)
      ? parsed.model
      : DEFAULT_STANDALONE_CHAT_SETTINGS.model;
    const fallback = CHAT_LEVELS.find((level) => model === `gpt-6-${level.suffix}`);
    return {
      model,
      effort: typeof parsed?.effort === "string" ? parsed.effort : fallback?.effort || "",
    };
  } catch {
    return DEFAULT_STANDALONE_CHAT_SETTINGS;
  }
}

export function saveStandaloneChatSettings(owner: string, settings: StandaloneChatSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(owner), JSON.stringify(settings));
}

export function chatSettingsFromChoice(family: string, level: string): StandaloneChatSettings | null {
  const choice = chatChoice(family, level);
  return choice ? { model: choice.model, effort: choice.effort } : null;
}
