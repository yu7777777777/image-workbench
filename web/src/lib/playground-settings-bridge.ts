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
  agentApiConfigMode: "off" | "single" | "hybrid";
  agentMaxToolRounds: number;
}

export const DEFAULT_GALLERY_SETTINGS: GallerySettings = {
  enterSubmit: false,
  clearInputAfterSubmit: true,
  persistInputOnRestart: true,
  reuseTaskApiProfileTemporarily: false,
  alwaysShowRetryButton: false,
  allowPromptRewrite: true,
  taskCompletionNotification: false,
  agentWebSearch: true,
  agentApiConfigMode: "hybrid",
  agentMaxToolRounds: 10,
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
      s.agentApiConfigMode === "off" || s.agentApiConfigMode === "single" || s.agentApiConfigMode === "hybrid"
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
  if (!normalized) return BASE_STORAGE_KEY;
  if (typeof window !== "undefined") {
    try {
      const claimedBy = window.localStorage.getItem(LEGACY_OWNER_CLAIM_KEY);
      if (!claimedBy) {
        window.localStorage.setItem(LEGACY_OWNER_CLAIM_KEY, normalized);
        const legacy = window.localStorage.getItem(BASE_STORAGE_KEY);
        const scopedKey = `${BASE_STORAGE_KEY}:${normalized}`;
        if (legacy != null && window.localStorage.getItem(scopedKey) == null) {
          window.localStorage.setItem(scopedKey, legacy);
        }
      }
    } catch {
      // 忽略受限存储异常
    }
  }
  return `${BASE_STORAGE_KEY}:${normalized}`;
}

export function readPlaygroundSettingsSnapshot(owner?: string): {
  settings: GallerySettings;
  chatProfileNames: string[];
} {
  if (typeof window === "undefined") {
    return { settings: DEFAULT_GALLERY_SETTINGS, chatProfileNames: [] };
  }
  try {
    const raw = window.localStorage.getItem(getPlaygroundStorageKey(owner));
    if (!raw) return { settings: DEFAULT_GALLERY_SETTINGS, chatProfileNames: [] };
    const parsed = JSON.parse(raw) as { state?: { settings?: Record<string, unknown> } };
    const rawSettings = parsed?.state?.settings;
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

export function patchPlaygroundSettingsFields(
  owner: string | undefined,
  patch: Partial<GallerySettings>,
): void {
  if (typeof window === "undefined") return;
  try {
    const storageKey = getPlaygroundStorageKey(owner);
    const raw = window.localStorage.getItem(storageKey);
    let parsed: Record<string, unknown> = {};
    if (raw) {
      try {
        const candidate = JSON.parse(raw);
        if (candidate && typeof candidate === "object") parsed = candidate as Record<string, unknown>;
      } catch {
        parsed = {};
      }
    }
    const prevState =
      parsed.state && typeof parsed.state === "object"
        ? (parsed.state as Record<string, unknown>)
        : {};
    const prevSettings =
      prevState.settings && typeof prevState.settings === "object"
        ? (prevState.settings as Record<string, unknown>)
        : {};
    parsed.state = {
      ...prevState,
      settings: {
        ...prevSettings,
        ...patch,
      },
    };
    if (typeof parsed.version !== "number") parsed.version = 2;
    window.localStorage.setItem(storageKey, JSON.stringify(parsed));
  } catch (err) {
    console.error("Failed to patch gallery settings in localStorage", err);
  }
}

/**
 * 单写入口：优先通过 postMessage 让常驻 playground iframe 内的 Zustand store 写入设置；
 * 仅当工作台尚未挂载（用户直达设置页未打开过工作台）时，才按 owner 定向补丁 localStorage。
 */
export async function updatePlaygroundSettings(
  owner: string | undefined,
  patch: Partial<GallerySettings>,
): Promise<"iframe" | "storage"> {
  if (typeof window === "undefined") return "storage";
  const iframe = document.querySelector('iframe[src*="playground"]') as HTMLIFrameElement | null;
  const targetWindow = iframe?.contentWindow;
  if (targetWindow) {
    const requestId = `pg-patch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const acked = await new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve(ok);
      };
      const onMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin || event.source !== targetWindow) return;
        if (event.data?.type === "patch-playground-settings-ack" && event.data?.requestId === requestId) {
          done(true);
        }
      };
      const timer = window.setTimeout(() => done(false), 180);
      window.addEventListener("message", onMessage);
      targetWindow.postMessage(
        { type: "patch-playground-settings", owner: owner || "", patch, requestId },
        window.location.origin,
      );
    });
    if (acked) return "iframe";
  }

  patchPlaygroundSettingsFields(owner, patch);
  return "storage";
}
