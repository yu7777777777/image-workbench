"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchModels } from "@/lib/api";
import { isChatModel } from "@/lib/chat-stream";

type ChatModelCatalog = { owner: string; models: string[]; error: string };
let lastCatalog: ChatModelCatalog | undefined;

export function useChatModels(owner: string) {
  const [revision, setRevision] = useState(0);
  const [catalog, setCatalog] = useState<ChatModelCatalog>();
  const retry = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!owner) return;
    let active = true;
    let pending = false;
    const refresh = async () => {
      if (document.hidden || pending) return;
      pending = true;
      try {
        const { data } = await fetchModels({ force: true });
        if (!active) return;
        const models = data.filter(({ id, kind }) => kind ? kind === "text" : isChatModel(id)).map(({ id }) => id);
        const next = { owner, models, error: "" };
        lastCatalog = models.length ? next : undefined;
        setCatalog(next);
      } catch {
        if (active && lastCatalog?.owner !== owner) {
          setCatalog({ owner, models: [], error: "模型列表加载失败，请点击重试。" });
        }
      } finally {
        pending = false;
      }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, [owner, revision]);

  const current = catalog?.owner === owner
    ? catalog
    : lastCatalog?.owner === owner ? lastCatalog : undefined;
  return { models: current?.models ?? EMPTY_MODELS, modelError: current?.error ?? "", isLoadingModels: !current, retry };
}

const EMPTY_MODELS: string[] = [];
