import { beforeEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_GALLERY_SETTINGS,
  getPlaygroundStorageKey,
  patchPlaygroundSettingsFields,
  readPlaygroundSettingsSnapshot,
} from "../src/lib/playground-settings-bridge";

function installMockLocalStorage() {
  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
  };
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: storage },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
  return map;
}

describe("playground settings bridge", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = installMockLocalStorage();
  });

  test("only the owner recorded by workbench can read legacy settings", () => {
    store.set(
      "gpt-image-playground",
      JSON.stringify({
        state: {
          appMode: "agent",
          settings: {
            enterSubmit: true,
            profiles: [{ id: "p1", name: "自定义对话", provider: "openai", apiMode: "responses" }],
          },
        },
        version: 2,
      }),
    );

    expect(readPlaygroundSettingsSnapshot("user:alice").settings).toEqual(DEFAULT_GALLERY_SETTINGS);
    store.set("gpt-image-playground-legacy-owner-v1", "user:alice");
    const firstSnap = readPlaygroundSettingsSnapshot("user:alice");
    expect(firstSnap.settings.enterSubmit).toBe(true);
    expect(firstSnap.chatProfileNames).toEqual(["自定义对话"]);
    expect(getPlaygroundStorageKey("user:alice")).toBe("gpt-image-playground:user:alice");

    // 第二个用户不会继承首个用户认领的旧配置
    const secondSnap = readPlaygroundSettingsSnapshot("user:bob");
    expect(secondSnap.settings).toEqual(DEFAULT_GALLERY_SETTINGS);
    expect(secondSnap.chatProfileNames).toEqual([]);
    expect(getPlaygroundStorageKey("user:bob")).toBe("gpt-image-playground:user:bob");
  });

  test("patchPlaygroundSettingsFields only updates target fields and preserves profiles and appMode", () => {
    store.set(
      "gpt-image-playground:user:alice",
      JSON.stringify({
        state: {
          appMode: "canvas",
          params: { size: "1254x1254" },
          settings: {
            enterSubmit: false,
            agentWebSearch: true,
            profiles: [{ id: "custom-1", name: "保留配置", provider: "openai", apiMode: "responses" }],
          },
        },
        version: 2,
      }),
    );
    store.set("gpt-image-playground-legacy-owner-v1", "user:alice");

    patchPlaygroundSettingsFields("user:alice", { enterSubmit: true, agentMaxToolRounds: 15 });

    const saved = JSON.parse(store.get("gpt-image-playground:user:alice")!);
    expect(saved.version).toBe(2);
    expect(saved.state.appMode).toBe("canvas");
    expect(saved.state.params).toEqual({ size: "1254x1254" });
    expect(saved.state.settings.enterSubmit).toBe(false);
    expect(saved.state.settings.agentWebSearch).toBe(true);
    expect(saved.state.settings.profiles).toHaveLength(1);
    const pending = readPlaygroundSettingsSnapshot("user:alice").settings;
    expect(pending.enterSubmit).toBe(true);
    expect(pending.agentMaxToolRounds).toBe(15);
    expect(readPlaygroundSettingsSnapshot("user:bob").settings).toEqual(DEFAULT_GALLERY_SETTINGS);
    expect(store.has("gpt-image-playground:user:bob")).toBe(false);
  });
});
