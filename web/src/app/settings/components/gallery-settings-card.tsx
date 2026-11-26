"use client";

import { useEffect, useState } from "react";
import { Bot, Check, Edit2, Globe, Image as ImageIcon, Layers, Loader2, Palette, Plus, RefreshCw, Search, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fetchExternalModels, testExternalModel, type SharedProfile } from "@/lib/api";
import {
  DEFAULT_GALLERY_SETTINGS,
  readPlaygroundSettingsSnapshot,
  updatePlaygroundSettings,
  type GallerySettings,
} from "@/lib/playground-settings-bridge";
import { useSettingsStore } from "../store";

export function GallerySettingsCard({ showSharedProfiles = true, owner = "" }: { showSharedProfiles?: boolean; owner?: string } = {}) {
  const [settings, setSettings] = useState<GallerySettings>(DEFAULT_GALLERY_SETTINGS);
  const [isSaved, setIsSaved] = useState(false);
  // 对话模型候选：本站账号池 (Agent) 直接用登录身份，是最省事的默认项；第三方 Responses 配置其次。
  const [chatProfileNames, setChatProfileNames] = useState<string[]>([]);

  useEffect(() => {
    const refresh = () => {
      const snapshot = readPlaygroundSettingsSnapshot(owner);
      setSettings(snapshot.settings);
      setChatProfileNames(snapshot.chatProfileNames);
    };
    refresh();
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, [owner]);

  const updateSetting = <K extends keyof GallerySettings>(key: K, value: GallerySettings[K]) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    try {
      updatePlaygroundSettings(owner, { [key]: value });
      setIsSaved(true);
    } catch (error) {
      setSettings(readPlaygroundSettingsSnapshot(owner).settings);
      console.warn("保存工作台设置失败", error);
      return;
    }
    setTimeout(() => setIsSaved(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* 习惯配置 */}
      <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Palette className="size-5 text-stone-700" />
              <CardTitle className="text-base font-semibold">画廊生图习惯配置</CardTitle>
            </div>
            {isSaved && (
              <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium animate-fade-in">
                <Check className="size-3.5" />
                已实时保存
              </span>
            )}
          </div>
          <CardDescription className="text-xs text-stone-500">
            自定义画廊与 Agent 工作台的按键交互、输入框行为、重试及优化策略。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-start gap-3 rounded-xl border border-stone-200 bg-stone-50/50 p-3.5 cursor-pointer transition hover:bg-stone-50">
              <Checkbox
                checked={settings.enterSubmit}
                onCheckedChange={(v) => updateSetting("enterSubmit", Boolean(v))}
                className="mt-0.5"
              />
              <div className="space-y-1">
                <span className="text-sm font-medium text-stone-800">按 Enter 发送提示词</span>
                <p className="text-xs text-stone-500">
                  开启后按 Enter 直接提交生成，Shift + Enter 换行；关闭后按 Ctrl/Cmd + Enter 提交。
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 rounded-xl border border-stone-200 bg-stone-50/50 p-3.5 cursor-pointer transition hover:bg-stone-50">
              <Checkbox
                checked={settings.clearInputAfterSubmit}
                onCheckedChange={(v) => updateSetting("clearInputAfterSubmit", Boolean(v))}
                className="mt-0.5"
              />
              <div className="space-y-1">
                <span className="text-sm font-medium text-stone-800">提交任务后清空输入框</span>
                <p className="text-xs text-stone-500">
                  开启后，提交成功创建任务时会自动清空提示词和参考图。
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 rounded-xl border border-stone-200 bg-stone-50/50 p-3.5 cursor-pointer transition hover:bg-stone-50">
              <Checkbox
                checked={settings.persistInputOnRestart}
                onCheckedChange={(v) => updateSetting("persistInputOnRestart", Boolean(v))}
                className="mt-0.5"
              />
              <div className="space-y-1">
                <span className="text-sm font-medium text-stone-800">重启后加载上次的输入框</span>
                <p className="text-xs text-stone-500">
                  关闭后不再持久化提示词与参考图，下次启动页面时将使用空输入框。
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 rounded-xl border border-stone-200 bg-stone-50/50 p-3.5 cursor-pointer transition hover:bg-stone-50">
              <Checkbox
                checked={settings.reuseTaskApiProfileTemporarily}
                onCheckedChange={(v) => updateSetting("reuseTaskApiProfileTemporarily", Boolean(v))}
                className="mt-0.5"
              />
              <div className="space-y-1">
                <span className="text-sm font-medium text-stone-800">复用配置时临时复用该任务的 API 配置</span>
                <p className="text-xs text-stone-500">
                  开启后复用历史任务时会临时使用该任务的 API 配置；关闭后继续使用当前的 API 配置。
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 rounded-xl border border-stone-200 bg-stone-50/50 p-3.5 cursor-pointer transition hover:bg-stone-50">
              <Checkbox
                checked={settings.alwaysShowRetryButton}
                onCheckedChange={(v) => updateSetting("alwaysShowRetryButton", Boolean(v))}
                className="mt-0.5"
              />
              <div className="space-y-1">
                <span className="text-sm font-medium text-stone-800">成功任务仍然展示重试按钮</span>
                <p className="text-xs text-stone-500">
                  开启后，即使任务成功生成，也会在任务卡片和详情页显示重试按钮。
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 rounded-xl border border-stone-200 bg-stone-50/50 p-3.5 cursor-pointer transition hover:bg-stone-50">
              <Checkbox
                checked={settings.allowPromptRewrite}
                onCheckedChange={(v) => updateSetting("allowPromptRewrite", Boolean(v))}
                className="mt-0.5"
              />
              <div className="space-y-1">
                <span className="text-sm font-medium text-stone-800">允许模型改写优化提示词</span>
                <p className="text-xs text-stone-500">
                  开启后，不再附加防改写提示词，允许模型按服务商策略优化提示词生成效果。
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 rounded-xl border border-stone-200 bg-stone-50/50 p-3.5 cursor-pointer transition hover:bg-stone-50">
              <Checkbox
                checked={settings.taskCompletionNotification}
                onCheckedChange={(v) => updateSetting("taskCompletionNotification", Boolean(v))}
                className="mt-0.5"
              />
              <div className="space-y-1">
                <span className="text-sm font-medium text-stone-800">任务完成后发送系统通知</span>
                <p className="text-xs text-stone-500">
                  开启后，图像生成完成或 Agent 回复结束时发送浏览器系统级通知提醒。
                </p>
              </div>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Agent 配置 */}
      <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-indigo-600" />
            <CardTitle className="text-base font-semibold">Agent 配置</CardTitle>
          </div>
          <CardDescription className="text-xs text-stone-500">
            配置 Agent 对话模式的接口方式、联网搜索与生图助手的执行轮次。具体使用哪个对话 / 生图模型，请在 Agent 输入栏选择。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2 max-w-md">
            <Label className="text-xs font-medium text-stone-700">Agent API 模式</Label>
            <Select
              value={settings.agentApiConfigMode}
              onValueChange={(val: "off" | "native" | "hybrid") => updateSetting("agentApiConfigMode", val)}
            >
              <SelectTrigger className="h-9 rounded-xl border-stone-200 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="hybrid">混合模式（默认：本站账号对话 + 本站账号生图）</SelectItem>
                <SelectItem value="native">原生（使用 Responses 内置生图工具）</SelectItem>
                <SelectItem value="off">关闭 Agent 独立接口</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-stone-500">
              默认混合模式：在 Agent 输入栏选择对话与生图模型，默认即「本站账号池 (Agent)」与「本站账号池」，直接用登录账号，无需填写 API Key。
            </p>
          </div>

          <div className="space-y-1.5 max-w-md rounded-xl border border-stone-200 bg-stone-50/50 p-3.5">
            <Label className="text-xs font-medium text-stone-700">可用对话模型</Label>
            {chatProfileNames.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {chatProfileNames.map((name) => (
                  <Badge key={name} variant="secondary" className="rounded-md text-[11px]">
                    {name}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-amber-700">
                尚未加载到对话模型。Agent 模式默认使用「本站账号池 (Agent)」直接调本站账号，无需配置 API Key；
                若列表仍为空，请在工作台「对话」模式刷新页面后重新查看。
              </p>
            )}
          </div>

          <label className="flex items-start gap-3 rounded-xl border border-stone-200 bg-stone-50/50 p-3.5 cursor-pointer transition hover:bg-stone-50 max-w-md">
            <Checkbox
              checked={settings.agentWebSearch}
              onCheckedChange={(v) => updateSetting("agentWebSearch", Boolean(v))}
              className="mt-0.5"
            />
            <div className="space-y-1">
              <span className="text-sm font-medium text-stone-800">Agent 联网搜索增强</span>
              <p className="text-xs text-stone-500">
                开启后，Agent 可在对话中联网检索最新画风、流行词及上下文参考资料。
              </p>
            </div>
          </label>

          <div className="space-y-2 max-w-md">
            <Label className="text-xs font-medium text-stone-700">最大工具调用轮次</Label>
            <Input
              type="number"
              min={1}
              max={30}
              value={settings.agentMaxToolRounds}
              onChange={(e) => updateSetting("agentMaxToolRounds", Number(e.target.value) || 10)}
              className="h-9 rounded-xl border-stone-200 bg-white"
            />
            <p className="text-xs text-stone-500">
              单次任务中 Agent 连续调用工具（如修改提示词、二次出图）的最大次数，默认 10。
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 全站共享模型库（仅管理员可见，依赖 /api/settings） */}
      {showSharedProfiles ? <SharedProfilesSection /> : null}
    </div>
  );
}

function SharedProfilesSection() {
  const config = useSettingsStore((state) => state.config);
  const saveSharedProfiles = useSettingsStore((state) => state.saveSharedProfiles);
  const profiles: SharedProfile[] = config?.shared_profiles || [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const [name, setName] = useState("");
  const [role, setRole] = useState<"chat" | "image">("chat");
  const [provider, setProvider] = useState<"openai" | "fal" | "custom">("openai");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-4o");
  const [description, setDescription] = useState("");
  const [group, setGroup] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [listFilter, setListFilter] = useState<"all" | "chat" | "image" | "disabled">("all");
  const [groupFilter, setGroupFilter] = useState("all");

  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [isTestingVisible, setIsTestingVisible] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [customModelInput, setCustomModelInput] = useState(false);

  // Multi-select state: modelId -> { checked, role, displayName }
  type ModelEntry = { checked: boolean; role: "chat" | "image"; displayName: string };
  const [multiSelect, setMultiSelect] = useState<Record<string, ModelEntry>>({});

  const chatPresetModels = ["gpt-4o", "gpt-4o-mini", "claude-3-5-sonnet", "deepseek-chat", "gemini-1.5-pro"];
  const imagePresetModels = provider === "fal"
    ? ["fal-ai/flux/schnell", "fal-ai/flux/dev", "fal-ai/flux-pro", "fal-ai/stable-diffusion-v35-large"]
    : ["dall-e-3", "dall-e-2", "gpt-image-2"];

  const isAddMode = editingIndex === null;
  const showMultiSelect = isAddMode && fetchedModels.length > 0 && !customModelInput;

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredProfiles = profiles
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      const matchesFilter = listFilter === "all"
        || (listFilter === "disabled" ? item.enabled === false : item.role === listFilter);
      const matchesGroup = groupFilter === "all" || (item.group || "未分组") === groupFilter;
      const matchesSearch = !normalizedSearch
        || [item.name, item.model, item.description, item.base_url]
          .some((value) => value.toLowerCase().includes(normalizedSearch));
      return matchesFilter && matchesGroup && matchesSearch;
    });

  const groups = Array.from(new Set(profiles.map((item) => item.group?.trim() || "未分组"))).sort((a, b) => a.localeCompare(b, "zh-CN"));
  const groupedProfiles = filteredProfiles.reduce<Record<string, typeof filteredProfiles>>((result, entry) => {
    const groupName = entry.item.group?.trim() || "未分组";
    (result[groupName] ||= []).push(entry);
    return result;
  }, {});

  const enabledCount = profiles.filter((item) => item.enabled !== false).length;
  const chatCount = profiles.filter((item) => item.role === "chat").length;
  const imageCount = profiles.filter((item) => item.role === "image").length;

  function guessRole(m: string): "chat" | "image" {
    return /image|dall|flux|sd[_\- ]|stable.diff|midjourney|sora|video|wan/i.test(m) ? "image" : "chat";
  }

  function initMultiSelect(models: string[]) {
    const initial: Record<string, ModelEntry> = {};
    models.forEach((m) => {
      const clean = m.split("/").pop() || m;
      const r = guessRole(m);
      initial[m] = {
        checked: false,
        role: r,
        displayName: r === "chat" ? `${clean} 对话` : `${clean} 生图`,
      };
    });
    setMultiSelect(initial);
  }

  const allChecked = fetchedModels.length > 0 && fetchedModels.every((m) => multiSelect[m]?.checked);
  const anyChecked = fetchedModels.some((m) => multiSelect[m]?.checked);

  const handleToggleAll = () => {
    const next = { ...multiSelect };
    const val = !allChecked;
    fetchedModels.forEach((m) => { if (next[m]) next[m] = { ...next[m], checked: val }; });
    setMultiSelect(next);
  };

  const handleToggleModel = (m: string) => {
    setMultiSelect((prev) => ({ ...prev, [m]: { ...prev[m], checked: !prev[m].checked } }));
  };

  const handleMultiRole = (m: string, r: "chat" | "image") => {
    const clean = m.split("/").pop() || m;
    setMultiSelect((prev) => ({
      ...prev,
      [m]: { ...prev[m], role: r, displayName: r === "chat" ? `${clean} 对话` : `${clean} 生图` },
    }));
  };

  const handleMultiName = (m: string, val: string) => {
    setMultiSelect((prev) => ({ ...prev, [m]: { ...prev[m], displayName: val } }));
  };

  const handleOpenAdd = () => {
    setEditingIndex(null);
    setName("");
    setRole("chat");
    setProvider("openai");
    setBaseUrl("https://api.openai.com/v1");
    setApiKey("");
    setModel("gpt-4o");
    setDescription("");
    setGroup("");
    setEnabled(true);
    setFetchedModels([]);
    setMultiSelect({});
    setCustomModelInput(false);
    setDialogOpen(true);
  };

  const handleOpenEdit = (index: number) => {
    const p = profiles[index];
    if (!p) return;
    setEditingIndex(index);
    setName(p.name);
    setRole(p.role);
    setProvider(p.provider);
    setBaseUrl(p.base_url);
    setApiKey(p.api_key);
    setModel(p.model);
    setDescription(p.description || "");
    setGroup(p.group || "");
    setEnabled(p.enabled !== false);
    setFetchedModels([]);
    setMultiSelect({});
    setCustomModelInput(true);
    setDialogOpen(true);
  };

  const handleFetchModels = async () => {
    if (provider !== "fal" && !baseUrl.trim()) {
      toast.error("请先输入接口地址 (Base URL)");
      return;
    }
    setIsFetchingModels(true);
    try {
      const res = await fetchExternalModels({
        base_url: baseUrl.trim(),
        api_key: apiKey.trim(),
        provider,
      });
      const list = res.models || [];
      if (list.length === 0) {
        toast.warning("未从接口获取到模型，请检查地址或密钥，或手动输入模型标识。");
      } else {
        setFetchedModels(list);
        setCustomModelInput(false);
        initMultiSelect(list);
        toast.success(`成功拉取到 ${list.length} 个可用模型！`);
        if (!list.includes(model)) {
          handleSelectModel(list[0]);
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "拉取模型列表失败，请检查网络、Base URL 或 API Key");
    } finally {
      setIsFetchingModels(false);
    }
  };

  const handleSelectModel = (val: string) => {
    setModel(val);
    const clean = val.split("/").pop() || val;
    if (!name.trim() || name.includes("对话") || name.includes("生图")) {
      setName(role === "chat" ? `${clean} 对话` : `${clean} 生图`);
    }
  };

  const handleToggleEnabled = async (index: number) => {
    const next = [...profiles];
    next[index] = { ...next[index], enabled: !next[index].enabled };
    await saveSharedProfiles(next);
  };

  const testProfile = async (profile: SharedProfile) => {
    setTestingId(profile.id);
    try {
      const result = await testExternalModel({ base_url: profile.base_url, api_key: profile.api_key, provider: profile.provider, model: profile.model });
      const message = result.ok ? `可用 · 已发现 ${result.models_count} 个模型` : (result.error || "测试失败");
      setTestResults((previous) => ({ ...previous, [profile.id]: { ok: result.ok, message } }));
      result.ok ? toast.success(`${profile.name} 测试通过`) : toast.error(`${profile.name}：${message}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "测试请求失败";
      setTestResults((previous) => ({ ...previous, [profile.id]: { ok: false, message } }));
      toast.error(message);
    } finally {
      setTestingId(null);
    }
  };

  const testDraft = async () => {
    if (!model.trim()) {
      toast.error("请先填写模型 ID");
      return;
    }
    setTestingId("draft");
    try {
      const result = await testExternalModel({ base_url: baseUrl, api_key: apiKey, provider, model });
      result.ok ? toast.success("当前配置测试通过") : toast.error(result.error || "当前模型不可用");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "测试请求失败");
    } finally {
      setTestingId(null);
    }
  };

  const testVisibleProfiles = async () => {
    if (filteredProfiles.length === 0) return;
    setIsTestingVisible(true);
    let passed = 0;
    for (const { item } of filteredProfiles) {
      try {
        const result = await testExternalModel({ base_url: item.base_url, api_key: item.api_key, provider: item.provider, model: item.model });
        const message = result.ok ? `可用 · 已发现 ${result.models_count} 个模型` : (result.error || "测试失败");
        setTestResults((previous) => ({ ...previous, [item.id]: { ok: result.ok, message } }));
        if (result.ok) passed += 1;
      } catch (error) {
        setTestResults((previous) => ({ ...previous, [item.id]: { ok: false, message: error instanceof Error ? error.message : "测试请求失败" } }));
      }
    }
    setIsTestingVisible(false);
    toast.success(`批量测试完成：${passed}/${filteredProfiles.length} 个模型可用`);
  };

  const handleDelete = async (index: number) => {
    if (!window.confirm(`确定要删除共享模型「${profiles[index]?.name}」吗？`)) return;
    const next = profiles.filter((_, i) => i !== index);
    await saveSharedProfiles(next);
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();

    // Multi-select batch add
    if (showMultiSelect && anyChecked) {
      const selected = fetchedModels.filter((m) => multiSelect[m]?.checked);
      setIsSubmitting(true);
      try {
        const newProfiles: SharedProfile[] = selected.map((m) => ({
          id: `shared_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: multiSelect[m].displayName || m,
          role: multiSelect[m].role,
          provider,
          base_url: baseUrl.trim(),
          api_key: apiKey.trim(),
          model: m,
          description: description.trim(),
          group: group.trim(),
          enabled,
        }));
        const next = [...profiles, ...newProfiles];
        const ok = await saveSharedProfiles(next);
        if (ok) {
          toast.success(`已批量添加 ${newProfiles.length} 个共享模型`);
          setDialogOpen(false);
        }
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // Single model save (add or edit)
    const trimmedName = name.trim();
    const trimmedModel = model.trim();
    if (!trimmedName) {
      toast.error("请输入模型显示名称");
      return;
    }
    if (!trimmedModel) {
      toast.error("请输入或选取模型标识");
      return;
    }

    setIsSubmitting(true);
    try {
      const next = [...profiles];
      const payload: SharedProfile = {
        id: editingIndex !== null && profiles[editingIndex] ? profiles[editingIndex].id : `shared_${Date.now()}`,
        name: trimmedName,
        role,
        provider,
        base_url: baseUrl.trim(),
        api_key: apiKey.trim(),
        model: trimmedModel,
        description: description.trim(),
        group: group.trim(),
        enabled,
      };

      if (editingIndex !== null) {
        next[editingIndex] = payload;
      } else {
        next.push(payload);
      }

      const ok = await saveSharedProfiles(next);
      if (ok) {
        setDialogOpen(false);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Layers className="size-5 text-indigo-600" />
              <CardTitle className="text-base font-semibold">全站共享模型库</CardTitle>
              <Badge variant="secondary" className="text-[11px] font-normal">
                {profiles.length} 个配置
              </Badge>
            </div>
            <CardDescription className="text-xs text-stone-500">
              管理员可在此配置供全站所有普通用户共用的外部对话或生图模型（支持 OpenAI 规范模型、Fal.ai FLUX / SD、三方中转等）。开启后普通用户免配置直接可选使用。
            </CardDescription>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={handleOpenAdd}
            className="h-8 gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white self-start sm:self-auto"
          >
            <Plus className="size-4" />
            添加共享模型
          </Button>
        </div>
        {profiles.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "已启用", value: enabledCount, tone: "text-emerald-600" },
              { label: "对话", value: chatCount, tone: "text-blue-600" },
              { label: "生图", value: imageCount, tone: "text-purple-600" },
              { label: "已停用", value: profiles.length - enabledCount, tone: "text-stone-500" },
            ].map((stat) => (
              <div key={stat.label} className="rounded-lg border border-stone-100 bg-stone-50/70 px-3 py-2">
                <p className="text-[10px] text-stone-400">{stat.label}</p>
                <p className={`mt-0.5 text-lg font-semibold ${stat.tone}`}>{stat.value}</p>
              </div>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {profiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-stone-200 p-8 text-center bg-stone-50/50">
            <Globe className="size-8 text-stone-300 mb-2" />
            <p className="text-sm font-medium text-stone-600">暂未配置全站共享模型</p>
            <p className="text-xs text-stone-400 mt-1 max-w-sm">
              添加后，所有普通用户登录系统后即可在画廊及 Agent 下拉菜单中直接选择使用。
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleOpenAdd}
              className="mt-4 rounded-xl text-xs gap-1.5"
            >
              <Plus className="size-3.5" />
              立即添加
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-stone-400" />
                <Input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="搜索名称、模型 ID 或接口地址"
                  className="h-8 rounded-lg pl-8 text-xs"
                />
              </div>
              <Select value={listFilter} onValueChange={(value: typeof listFilter) => setListFilter(value)}>
                <SelectTrigger className="h-8 w-full rounded-lg text-xs sm:w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部配置</SelectItem>
                  <SelectItem value="chat">仅对话</SelectItem>
                  <SelectItem value="image">仅生图</SelectItem>
                  <SelectItem value="disabled">仅已停用</SelectItem>
                </SelectContent>
              </Select>
              <Select value={groupFilter} onValueChange={setGroupFilter}>
                <SelectTrigger className="h-8 w-full rounded-lg text-xs sm:w-32">
                  <SelectValue placeholder="按分组" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部分组</SelectItem>
                  {groups.map((groupName) => <SelectItem key={groupName} value={groupName}>{groupName}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void testVisibleProfiles()}
                disabled={isTestingVisible || filteredProfiles.length === 0}
                className="h-8 shrink-0 rounded-lg border-indigo-200 px-2.5 text-xs text-indigo-600 hover:bg-indigo-50"
                title="测试当前筛选结果"
              >
                {isTestingVisible ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Check className="mr-1 size-3.5" />}
                {isTestingVisible ? "测试中" : "测试当前列表"}
              </Button>
            </div>
            <p className="mb-3 text-[11px] text-stone-400">
              测试会检查接口连通性和模型目录，不会实际发起对话或生图请求，也不会消耗额度。
            </p>
            <div className="divide-y divide-stone-100 rounded-xl border border-stone-200 overflow-hidden bg-white">
            {Object.entries(groupedProfiles).map(([groupName, entries]) => (
              <div key={groupName}>
                <div className="flex items-center justify-between border-b border-stone-100 bg-stone-50/80 px-4 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-stone-700">{groupName}</span>
                    <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{entries.length}</Badge>
                  </div>
                  <span className="text-[10px] text-stone-400">
                    {entries.filter(({ item }) => item.enabled !== false).length} 个启用
                  </span>
                </div>
                {entries.map(({ item, index: idx }) => (
              <div
                key={item.id || idx}
                className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 gap-3 hover:bg-stone-50/70 transition"
              >
                <div className="flex items-start sm:items-center gap-3 min-w-0">
                  <div
                    className={`mt-0.5 sm:mt-0 flex size-8 shrink-0 items-center justify-center rounded-lg ${
                      item.role === "chat" ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"
                    }`}
                  >
                    {item.role === "chat" ? <Bot className="size-4" /> : <ImageIcon className="size-4" />}
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-stone-800 truncate">{item.name}</span>
                      <Badge
                        variant="outline"
                        className={
                          item.role === "chat"
                            ? "border-blue-200 bg-blue-50/50 text-blue-700 text-[10px] px-1.5 py-0"
                            : "border-purple-200 bg-purple-50/50 text-purple-700 text-[10px] px-1.5 py-0"
                        }
                      >
                        {item.role === "chat" ? "对话模型" : "生图模型"}
                      </Badge>
                      <Badge variant="outline" className="text-stone-500 border-stone-200 text-[10px] px-1.5 py-0">
                        {item.provider === "fal" ? "Fal.ai" : item.provider === "custom" ? "自定义" : "OpenAI 兼容"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-stone-400 truncate">
                      <span className="font-mono text-stone-500">{item.model}</span>
                      {item.base_url && <span className="truncate max-w-[200px]">{item.base_url}</span>}
                      {item.description && <span className="text-stone-400">· {item.description}</span>}
                    </div>
                    {testResults[item.id] && (
                      <p className={`text-[11px] ${testResults[item.id].ok ? "text-emerald-600" : "text-rose-500"}`}>
                        {testResults[item.id].ok ? "✓" : "!"} {testResults[item.id].message}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 self-end sm:self-auto shrink-0">
                  <label className="flex items-center gap-1.5 text-xs text-stone-600 cursor-pointer select-none">
                    <Checkbox
                      checked={item.enabled !== false}
                      onCheckedChange={() => handleToggleEnabled(idx)}
                    />
                    <span>{item.enabled !== false ? "已启用" : "已禁用"}</span>
                  </label>

                  <div className="h-4 w-px bg-stone-200" />

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void testProfile(item)}
                    disabled={testingId === item.id}
                    className="h-7 px-2 text-xs text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700"
                    title="测试连接和模型"
                  >
                    {testingId === item.id ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                    <span className="hidden lg:inline">测试</span>
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleOpenEdit(idx)}
                    className="h-7 w-7 p-0 text-stone-500 hover:text-stone-800"
                    title="编辑"
                  >
                    <Edit2 className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(idx)}
                    className="h-7 w-7 p-0 text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                    title="删除"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
                ))}
              </div>
            ))}
            {filteredProfiles.length === 0 && (
              <div className="px-4 py-8 text-center">
                <Search className="mx-auto size-5 text-stone-300" />
                <p className="mt-2 text-xs font-medium text-stone-600">没有匹配的共享模型</p>
                <p className="mt-1 text-[11px] text-stone-400">试试清空搜索词或切换筛选条件。</p>
              </div>
            )}
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingIndex !== null ? "编辑共享模型" : "添加全站共享模型"}</DialogTitle>
            <DialogDescription>
              配置后，所有登录本站的用户可在画廊生图或 Agent 对话下拉列表中直接使用此配置。
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveForm} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">模型用途 (Role)</Label>
                <Select
                  value={role}
                  onValueChange={(val: "chat" | "image") => {
                    setRole(val);
                    if (val === "chat" && model === "dall-e-3") setModel("gpt-4o");
                    if (val === "image" && model === "gpt-4o") setModel("dall-e-3");
                  }}
                >
                  <SelectTrigger className="h-8 rounded-lg text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="chat">对话 / Agent 文本理解</SelectItem>
                    <SelectItem value="image">生图模型 (Image)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">服务提供商 (Provider)</Label>
                <Select
                  value={provider}
                  onValueChange={(val: "openai" | "fal" | "custom") => {
                    setProvider(val);
                    if (val === "fal") {
                      setBaseUrl("https://fal.run");
                      if (role === "image") setModel("fal-ai/flux/schnell");
                    } else if (val === "openai" && baseUrl === "https://fal.run") {
                      setBaseUrl("https://api.openai.com/v1");
                    }
                  }}
                >
                  <SelectTrigger className="h-8 rounded-lg text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI 兼容规范</SelectItem>
                    <SelectItem value="fal">Fal.ai (FLUX/SD 等)</SelectItem>
                    <SelectItem value="custom">自定义 HTTP 接口</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">接口地址 (Base URL)</Label>
              <Input
                placeholder="https://api.openai.com/v1"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="h-8 rounded-lg font-mono text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">接口密钥 (API Key)</Label>
              <Input
                type="password"
                placeholder="sk-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="h-8 rounded-lg font-mono text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium text-stone-700">
                  {showMultiSelect ? `模型列表（勾选要添加的，共 ${fetchedModels.length} 个）` : "模型名称 / ID (Model)"}
                </Label>
                <div className="flex items-center gap-2">
                  {fetchedModels.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setCustomModelInput(!customModelInput)}
                      className="text-[11px] text-stone-500 hover:text-stone-800 underline"
                    >
                      {customModelInput ? "回到多选列表" : "手动输入单个"}
                    </button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleFetchModels}
                    disabled={isFetchingModels}
                    className="h-6 text-[11px] px-2 gap-1 rounded-md text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                  >
                    {isFetchingModels ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3" />
                    )}
                    {isFetchingModels ? "拉取中..." : "拉取模型列表"}
                  </Button>
                </div>
              </div>

              {showMultiSelect ? (
                <div className="rounded-lg border border-stone-200 overflow-hidden">
                  {/* 全选 bar */}
                  <div className="flex items-center justify-between px-3 py-2 bg-stone-50 border-b border-stone-100">
                    <label className="flex items-center gap-2 cursor-pointer text-xs text-stone-600 select-none">
                      <Checkbox
                        checked={allChecked}
                        onCheckedChange={handleToggleAll}
                      />
                      <span>{allChecked ? "取消全选" : "全选"}</span>
                      {anyChecked && (
                        <span className="text-indigo-600 font-medium">
                          · 已选 {fetchedModels.filter((m) => multiSelect[m]?.checked).length} 个
                        </span>
                      )}
                    </label>
                    <span className="text-[10px] text-stone-400">勾选 → 设置角色 → 保存</span>
                  </div>
                  {/* 模型列表 */}
                  <div className="max-h-52 overflow-y-auto divide-y divide-stone-100">
                    {fetchedModels.map((m) => {
                      const entry = multiSelect[m];
                      if (!entry) return null;
                      return (
                        <div
                          key={m}
                          className={`flex items-center gap-2 px-3 py-2 transition ${entry.checked ? "bg-indigo-50/60" : "hover:bg-stone-50"}`}
                        >
                          <Checkbox
                            checked={entry.checked}
                            onCheckedChange={() => handleToggleModel(m)}
                          />
                          <span className="font-mono text-[11px] text-stone-700 flex-1 min-w-0 truncate" title={m}>{m}</span>
                          {entry.checked && (
                            <>
                              <select
                                value={entry.role}
                                onChange={(e) => handleMultiRole(m, e.target.value as "chat" | "image")}
                                className="text-[10px] rounded border border-stone-200 px-1 py-0.5 bg-white text-stone-600 focus:outline-none focus:border-indigo-300 shrink-0"
                              >
                                <option value="chat">对话</option>
                                <option value="image">生图</option>
                              </select>
                              <input
                                value={entry.displayName}
                                onChange={(e) => handleMultiName(m, e.target.value)}
                                placeholder="显示名称"
                                className="text-[10px] rounded border border-stone-200 px-1.5 py-0.5 bg-white text-stone-700 w-28 shrink-0 focus:outline-none focus:border-indigo-300"
                              />
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <>
                  {fetchedModels.length > 0 && !customModelInput ? (
                    <Select value={model} onValueChange={handleSelectModel}>
                      <SelectTrigger className="h-8 rounded-lg font-mono text-xs bg-white">
                        <SelectValue placeholder="点击下拉选取模型..." />
                      </SelectTrigger>
                      <SelectContent className="max-h-60 rounded-xl">
                        {fetchedModels.map((m) => (
                          <SelectItem key={m} value={m} className="font-mono text-xs">
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <>
                      <Input
                        list="fetched-models-datalist"
                        placeholder={role === "chat" ? "如：gpt-4o, claude-3-5-sonnet, deepseek-chat" : "如：dall-e-3, fal-ai/flux/schnell"}
                        value={model}
                        onChange={(e) => handleSelectModel(e.target.value)}
                        className="h-8 rounded-lg font-mono text-xs"
                        required
                      />
                      <datalist id="fetched-models-datalist">
                        {fetchedModels.map((m) => (
                          <option key={m} value={m} />
                        ))}
                      </datalist>
                    </>
                  )}

                  <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                    <span className="text-[10px] text-stone-400">常用推荐:</span>
                    {(role === "chat" ? chatPresetModels : imagePresetModels).map((pm) => (
                      <button
                        key={pm}
                        type="button"
                        onClick={() => handleSelectModel(pm)}
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 hover:bg-indigo-50 hover:text-indigo-600 transition"
                      >
                        {pm}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* 多选模式下隐藏单独的 Name 字段 */}
            {!showMultiSelect && (
              <div className="space-y-1.5">
                <Label className="text-xs">显示名称 (Name)</Label>
                <Input
                  placeholder="如：全站 GPT-4o 极速对话、FLUX.1 Schnell 生图"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-8 rounded-lg text-xs"
                  required={!showMultiSelect}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">分组（可选）</Label>
              <Input
                list="shared-model-groups"
                placeholder="如：CPA 中转、官方线路、备用模型"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                className="h-8 rounded-lg text-xs"
              />
              <datalist id="shared-model-groups">
                {groups.map((groupName) => <option key={groupName} value={groupName === "未分组" ? "" : groupName} />)}
              </datalist>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">描述说明 (可选)</Label>
              <Input
                placeholder="如：管理员提供的极速模型，免配自用 key"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="h-8 rounded-lg text-xs"
              />
            </div>

            <label className="flex items-center gap-2 pt-1 cursor-pointer">
              <Checkbox
                checked={enabled}
                onCheckedChange={(v) => setEnabled(Boolean(v))}
              />
              <span className="text-xs font-medium text-stone-700">立即启用该共享模型给全站用户</span>
            </label>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void testDraft()}
                disabled={testingId === "draft"}
                className="mr-auto rounded-xl border-indigo-200 text-xs text-indigo-600 hover:bg-indigo-50"
              >
                {testingId === "draft" ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Check className="mr-1 size-3.5" />}
                测试当前配置
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDialogOpen(false)}
                className="rounded-xl text-xs"
              >
                取消
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSubmitting || (showMultiSelect && !anyChecked)}
                className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs"
              >
                {isSubmitting
                  ? "保存中..."
                  : showMultiSelect && anyChecked
                  ? `添加已选 ${fetchedModels.filter((m) => multiSelect[m]?.checked).length} 个模型`
                  : "保存模型"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
