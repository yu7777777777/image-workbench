"use client";

import { useEffect, useState } from "react";
import { Check, Copy, KeyRound, LoaderCircle, User } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import webConfig from "@/constants/common-env";
import { updateSelfProfile } from "@/lib/api";
import { setStoredAuthSession, type StoredAuthSession } from "@/store/auth";

type AccountSettingsCardProps = {
  session: StoredAuthSession;
  onSessionChange: (session: StoredAuthSession) => void;
};

export function AccountSettingsCard({ session, onSessionChange }: AccountSettingsCardProps) {
  const [name, setName] = useState(session.name);
  const [oldKey, setOldKey] = useState("");
  const [newKey, setNewKey] = useState("");
  const [confirmKey, setConfirmKey] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState("");

  useEffect(() => {
    setName(session.name);
  }, [session.name]);

  useEffect(() => {
    const origin = webConfig.apiUrl.replace(/\/$/, "") || window.location.origin;
    setBaseUrl(`${origin}/v1`);
  }, []);

  const roleLabel = session.role === "admin" ? "管理员" : "普通用户";

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      toast.success("已复制到剪贴板");
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast.error("复制失败，请手动选择文本");
    }
  };

  const handleNameSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName) {
      toast.error("账号名称不能为空");
      return;
    }
    if (nextName === session.name) {
      return;
    }
    setIsSavingName(true);
    try {
      await updateSelfProfile({ name: nextName });
      const updated: StoredAuthSession = { ...session, name: nextName };
      await setStoredAuthSession(updated);
      onSessionChange(updated);
      toast.success("账号名称已更新");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新账号名称失败");
    } finally {
      setIsSavingName(false);
    }
  };

  const handleKeySubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!oldKey.trim()) {
      toast.error("请输入当前密钥");
      return;
    }
    if (newKey.trim().length < 6) {
      toast.error("新密钥至少需要 6 位");
      return;
    }
    if (newKey.trim() !== confirmKey.trim()) {
      toast.error("两次输入的新密钥不一致");
      return;
    }
    if (oldKey.trim() === newKey.trim()) {
      toast.error("新密钥不能与旧密钥相同");
      return;
    }

    setIsSavingKey(true);
    try {
      const res = await updateSelfProfile({ old_key: oldKey.trim(), new_key: newKey.trim() });
      const nextKey = res.new_key || newKey.trim();
      const updated: StoredAuthSession = { ...session, key: nextKey };
      await setStoredAuthSession(updated);
      onSessionChange(updated);
      setOldKey("");
      setNewKey("");
      setConfirmKey("");
      toast.success("密钥修改成功，已自动生效");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "修改密钥失败");
    } finally {
      setIsSavingKey(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="size-5 text-stone-700" />
            <CardTitle className="text-base font-semibold">账号信息</CardTitle>
          </div>
          <CardDescription className="text-xs text-stone-500">
            当前登录角色：{roleLabel}。修改名称后立即生效。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleNameSubmit} className="max-w-md space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-stone-700">账号名称</Label>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="请输入账号名称"
                className="h-10 rounded-xl"
              />
            </div>
            <Button
              type="submit"
              disabled={isSavingName}
              className="rounded-xl bg-stone-950 text-white hover:bg-stone-800"
            >
              {isSavingName ? <LoaderCircle className="mr-1.5 size-4 animate-spin" /> : null}
              保存名称
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <KeyRound className="size-5 text-amber-500" />
            <CardTitle className="text-base font-semibold">修改个人密钥</CardTitle>
          </div>
          <CardDescription className="text-xs text-stone-500">
            该密钥同时用于登录和调用 API，修改成功后会自动使用新密钥。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleKeySubmit} className="max-w-md space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-stone-700">当前密钥</Label>
              <Input
                type="password"
                value={oldKey}
                onChange={(event) => setOldKey(event.target.value)}
                placeholder="请输入当前使用的密钥"
                autoComplete="current-password"
                className="h-10 rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-stone-700">新密钥</Label>
              <Input
                type="password"
                value={newKey}
                onChange={(event) => setNewKey(event.target.value)}
                placeholder="至少 6 位新密钥"
                autoComplete="new-password"
                className="h-10 rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-stone-700">确认新密钥</Label>
              <Input
                type="password"
                value={confirmKey}
                onChange={(event) => setConfirmKey(event.target.value)}
                placeholder="请再次输入新密钥"
                autoComplete="new-password"
                className="h-10 rounded-xl"
              />
            </div>
            <Button
              type="submit"
              disabled={isSavingKey}
              className="rounded-xl bg-stone-950 text-white hover:bg-stone-800"
            >
              {isSavingKey ? <LoaderCircle className="mr-1.5 size-4 animate-spin" /> : null}
              确认修改
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <KeyRound className="size-5 text-indigo-500" />
            <CardTitle className="text-base font-semibold">接口接入信息</CardTitle>
          </div>
          <CardDescription className="text-xs text-stone-500">
            可在任意兼容 OpenAI 的客户端中填入以下地址和密钥。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-medium text-stone-600">
              <span>Base URL</span>
              <button
                type="button"
                onClick={() => void copyToClipboard(baseUrl, "base-url")}
                className="flex items-center gap-1 text-[11px] text-stone-500 hover:text-stone-800"
              >
                {copiedField === "base-url" ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                复制地址
              </button>
            </div>
            <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 font-mono text-xs text-stone-800">
              {baseUrl}
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-medium text-stone-600">
              <span>API Key</span>
              <button
                type="button"
                onClick={() => void copyToClipboard(session.key, "api-key")}
                className="flex items-center gap-1 text-[11px] text-stone-500 hover:text-stone-800"
              >
                {copiedField === "api-key" ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                复制密钥
              </button>
            </div>
            <div className="truncate rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 font-mono text-xs text-stone-800">
              {session.key}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
