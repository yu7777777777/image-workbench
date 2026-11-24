"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageCircle } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CHAT_FAMILIES, CHAT_LEVELS, chatSelection } from "@/lib/chat-models";
import {
  chatSettingsFromChoice,
  DEFAULT_STANDALONE_CHAT_SETTINGS,
  readStandaloneChatSettings,
  saveStandaloneChatSettings,
} from "@/lib/standalone-chat-settings";

export function StandaloneChatSettingsCard({ owner }: { owner: string }) {
  const [settings, setSettings] = useState(DEFAULT_STANDALONE_CHAT_SETTINGS);

  useEffect(() => {
    setSettings(readStandaloneChatSettings(owner));
  }, [owner]);

  const selection = useMemo(
    () => chatSelection(settings.model, settings.effort) || { family: "gpt-6", level: "instant" },
    [settings],
  );

  const update = (family: string, level: string) => {
    const next = chatSettingsFromChoice(family, level);
    if (!next) return;
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
          <Select value={selection.family} onValueChange={(family) => update(family, selection.level)}>
            <SelectTrigger className="h-10 rounded-[10px] border-border bg-card shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHAT_FAMILIES.map((family) => (
                <SelectItem key={family.id} value={family.id}>{family.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-2">
          <span className="text-sm text-stone-700">默认思考程度</span>
          <Select value={selection.level} onValueChange={(level) => update(selection.family, level)}>
            <SelectTrigger className="h-10 rounded-[10px] border-border bg-card shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHAT_LEVELS.map((level) => (
                <SelectItem key={level.id} value={level.id}>{level.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </CardContent>
    </Card>
  );
}
