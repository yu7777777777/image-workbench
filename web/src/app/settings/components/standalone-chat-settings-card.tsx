"use client";

import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useChatModels } from "@/hooks/use-chat-models";
import { CHAT_LEVELS, chatChoice, chatFamilies, chatLevelAvailable, chatSelection } from "@/lib/chat-models";
import {
  DEFAULT_STANDALONE_CHAT_SETTINGS,
  readStandaloneChatSettings,
  saveStandaloneChatSettings,
} from "@/lib/standalone-chat-settings";

export function StandaloneChatSettingsCard({ owner }: { owner: string }) {
  const [settings, setSettings] = useState(DEFAULT_STANDALONE_CHAT_SETTINGS);

  useEffect(() => {
    setSettings(readStandaloneChatSettings(owner));
  }, [owner]);

  const { models, isLoadingModels, modelError, retry } = useChatModels(owner);
  const selection = chatSelection(settings.model, settings.effort);
  const families = chatFamilies(models);
  const family = families.find(({ id }) => id === selection?.family)?.id ?? "";
  const levels = CHAT_LEVELS.filter((level) => chatLevelAvailable(family, level.id, models));

  const update = (family: string, level: string) => {
    const next = chatChoice(family, level, models);
    if (!next || !models.includes(next.model)) return;
    setSettings(next);
    saveStandaloneChatSettings(owner, next);
  };

  return (
    <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
      <CardHeader>
        <div className="flex items-center gap-2">
          <MessageCircle className="size-5 text-stone-700" />
          <CardTitle className="text-base font-semibold">独立对话模型</CardTitle>
        </div>
        <CardDescription className="text-xs text-stone-500">
          这里仅控制纯文本对话页。它与 Agent 的对话模型、图像模型和 API 配置分开保存。
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2">
          <span className="text-sm text-stone-700">默认模型</span>
          <Select value={family} disabled={!families.length} onValueChange={(id) => {
            const choices = CHAT_LEVELS.filter((level) => chatLevelAvailable(id, level.id, models));
            const level = choices.find((item) => item.id === selection?.level) ?? choices[0];
            if (level) update(id, level.id);
          }}>
            <SelectTrigger className="h-10 rounded-[10px] border-border bg-card shadow-none">
              <SelectValue placeholder={isLoadingModels ? "正在加载模型…" : families.length ? "选择模型" : "暂无可用模型"} />
            </SelectTrigger>
            <SelectContent>
              {families.map((family) => (
                <SelectItem key={family.id} value={family.id}>{family.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-2">
          <span className="text-sm text-stone-700">默认思考程度</span>
          <Select value={levels.find(({ id }) => id === selection?.level)?.id ?? ""} disabled={!levels.length}
            onValueChange={(level) => update(family, level)}>
            <SelectTrigger className="h-10 rounded-[10px] border-border bg-card shadow-none">
              <SelectValue placeholder="选择思考程度" />
            </SelectTrigger>
            <SelectContent>
              {levels.map((level) => (
                <SelectItem key={level.id} value={level.id}>{level.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        {modelError && <button type="button" className="text-left text-xs underline" onClick={retry}>{modelError}</button>}
      </CardContent>
    </Card>
  );
}
