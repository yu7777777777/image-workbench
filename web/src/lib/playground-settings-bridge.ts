"use client";

export interface GallerySettings {
  enterSubmit: boolean;
  clearInputAfterSubmit: boolean;
  persistInputOnRestart: boolean;
  reuseTaskApiProfileTemporarily: boolean;
  alwaysShowRetryButton: boolean;
  allowPromptRewrite: boolean;
  taskCompletionNotification: boolean;
  agentWebSearch: boolean;
  agentApiConfigMode: "off" | "native" | "hybrid";
  agentMaxToolRounds: number;
}

export const DEFAULT_GALLERY_SETTINGS: GallerySettings = {
  enterSubmit: false,
  clearInputAfterSubmit: false,
  persistInputOnRestart: true,
  reuseTaskApiProfileTemporarily: false,
  alwaysShowRetryButton: false,
  allowPromptRewrite: false,
  taskCompletionNotification: false,
  agentWebSearch: false,
  agentApiConfigMode: "hybrid",
  agentMaxToolRounds: 15,
};

const BASE_STORAGE_KEY = "gpt-image-playground";
const LEGACY_OWNER_CLAIM_KEY = "gpt-image-playground-legacy-owner-v1";

function extractGallerySettings(source: Record<string, unknown> | null | undefined): GallerySettings {
  const s = source ?? {};
  return {
    enterSubmit: typeof s.enterSubmit === "boolean" ? s.enterSubmit : DEFAULT_GALLERY_SETTINGS.enterSubmit,
    clearInputAfterSubmit:
      typeof s.clearInputAfterSubmit === "boolean"
        ? s.clearInputAfterSubmit
        : DEFAULT_GALLERY_SETTINGS.clearInputAfterSubmit,
    persistInputOnRestart:
      typeof s.persistInputOnRestart === "boolean"
        ? s.persistInputOnRestart
        : DEFAULT_GALLERY_SETTINGS.persistInputOnRestart,
    reuseTaskApiProfileTemporarily:
      typeof s.reuseTaskApiProfileTemporarily === "boolean"
        ? s.reuseTaskApiProfileTemporarily
        : DEFAULT_GALLERY_SETTINGS.reuseTaskApiProfileTemporarily,
    alwaysShowRetryButton:
      typeof s.alwaysShowRetryButton === "boolean"
        ? s.alwaysShowRetryButton
        : DEFAULT_GALLERY_SETTINGS.alwaysShowRetryButton,
    allowPromptRewrite:
      typeof s.allowPromptRewrite === "boolean"
        ? s.allowPromptRewrite
        : DEFAULT_GALLERY_SETTINGS.allowPromptRewrite,
    taskCompletionNotification:
      typeof s.taskCompletionNotification === "boolean"
        ? s.taskCompletionNotification
        : DEFAULT_GALLERY_SETTINGS.taskCompletionNotification,
    agentWebSearch:
      typeof s.agentWebSearch === "boolean"
        ? s.agentWebSearch
        : DEFAULT_GALLERY_SETTINGS.agentWebSearch,
    agentApiConfigMode:
      s.agentApiConfigMode === "off" || s.agentApiConfigMode === "native" || s.agentApiConfigMode === "hybrid"
        ? s.agentApiConfigMode
        : DEFAULT_GALLERY_SETTINGS.agentApiConfigMode,
    agentMaxToolRounds:
      typeof s.agentMaxToolRounds === "number" && Number.isFinite(s.agentMaxToolRounds)
        ? s.agentMaxToolRounds
        : DEFAULT_GALLERY_SETTINGS.agentMaxToolRounds,
  };
}

export function getPlaygroundStorageKey(owner?: string): string {
  const normalized = (owner || "").trim();
  return normalized ? BASE_STORAGE_KEY + ":" + normalized : BASE_STORAGE_KEY;
}

export function readPlaygroundSettingsSnapshot(owner?: string): {
  settings: GallerySettings;
  chatProfileNames: string[];
} {
  if (typeof window === "undefined") {
    return { settings: DEFAULT_GALLERY_SETTINGS, chatProfileNames: [] };
  }
  try {
    const key = getPlaygroundStorageKey(owner);
    const legacy = owner && window.localStorage.getItem(LEGACY_OWNER_CLAIM_KEY) === owner
      ? window.localStorage.getItem(BASE_STORAGE_KEY)
      : null;
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? legacy ?? "{}") as { state?: { settings?: Record<string, unknown> } };
    const rawSettings = { ...parsed?.state?.settings };
    for (const field of Object.keys(DEFAULT_GALLERY_SETTINGS)) {
      const override = window.localStorage.getItem(key + ":settings-patch:" + field)
        ?? window.localStorage.getItem(key + ":settings-field:" + field);
      if (override != null) rawSettings[field] = JSON.parse(override).value;
    }
    const profiles = Array.isArray(rawSettings?.profiles) ? rawSettings.profiles : [];
    const chatProfileNames = profiles
      .filter(
        (item): item is { provider?: unknown; apiMode?: unknown; name?: unknown; id?: unknown } =>
          Boolean(item) && typeof item === "object",
      )
      .filter((p) => p.provider === "openai" && p.apiMode === "responses")
      .map((p) => String(p.name || p.id || ""));
    return {
      settings: extractGallerySettings(rawSettings),
      chatProfileNames,
    };
  } catch {
    return { settings: DEFAULT_GALLERY_SETTINGS, chatProfileNames: [] };
  }
}

export function patchPlaygroundSettingsFields(owner: string | undefined, patch: Partial<GallerySettings>): void {
  const key = getPlaygroundStorageKey(owner);
  for (const [field, value] of Object.entries(patch)) {
    window.localStorage.setItem(key + ":settings-patch:" + field, JSON.stringify({ value, id: crypto.randomUUID?.() ?? Math.random() }));
  }
}

export function updatePlaygroundSettings(owner: string | undefined, patch: Partial<GallerySettings>): void {
  patchPlaygroundSettingsFields(owner, patch);
  document.querySelector<HTMLIFrameElement>('iframe[src*="playground"]')?.contentWindow?.postMessage(
    { type: "apply-playground-settings", owner: owner || "" },
    window.location.origin,
  );
}
