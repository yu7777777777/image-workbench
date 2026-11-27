"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { FishLogo } from "@/components/fish-logo";
import { HeaderActions } from "@/components/header-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import webConfig from "@/constants/common-env";
import { fetchThirdPartyApps, updateSelfProfile, type ThirdPartyAppsSettings } from "@/lib/api";
import { getValidatedAuthSession } from "@/lib/auth-session";
import { maskSecretKey } from "@/lib/mask-secret";
import { clearStoredAuthSession, setStoredAuthSession, type StoredAuthSession } from "@/store/auth";
import { BookOpen, Bug, Check, Copy, Database, Eye, EyeOff, GalleryHorizontal, Images, KeyRound, LayoutGrid, Library, List, LoaderCircle, LogOut, MessageCircle, Settings, ShieldCheck, Sparkles, User } from "lucide-react";
import { toast } from "sonner";

const workspaceItems = [
  { href: "/image?mode=gallery", label: "画廊", icon: Images },
  { href: "/image?mode=agent", label: "Agent", icon: Sparkles },
  { href: "/image?mode=canvas", label: "画布", icon: LayoutGrid },
  { href: "/chat", label: "对话", icon: MessageCircle },
];

const adminItems = [
  { href: "/creative", label: "创意广场", icon: Library },
  { href: "/accounts", label: "号池管理", icon: Database },
  { href: "/image-manager", label: "图片管理", icon: GalleryHorizontal },
  { href: "/logs", label: "日志管理", icon: List },
  { href: "/debug", label: "调试", icon: Bug },
];

const settingsItem = { href: "/settings", label: "设置", icon: Settings };

function buildThirdPartyHref(appUrl: string, baseUrl: string, apiKey: string) {
  const url = appUrl.trim();
  try {
    const target = new URL(url);
    target.searchParams.set("apiKey", apiKey);
    target.searchParams.set("baseUrl", baseUrl);
    return target.toString();
  } catch {
    return `${url}${url.includes("?") ? "&" : "?"}apiKey=${encodeURIComponent(apiKey)}&baseUrl=${encodeURIComponent(baseUrl)}`;
  }
}

function TopNavInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode");
  const route = pathname?.replace(/\/$/, "");
  const router = useRouter();
  const [session, setSession] = useState<StoredAuthSession | null | undefined>(undefined);
  const [thirdPartyApps, setThirdPartyApps] = useState<ThirdPartyAppsSettings | null>(null);
  const [isCanvasDialogOpen, setIsCanvasDialogOpen] = useState(false);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [isKeyDialogOpen, setIsKeyDialogOpen] = useState(false);
  const [isApiDocsDialogOpen, setIsApiDocsDialogOpen] = useState(false);

  const [oldKey, setOldKey] = useState("");
  const [newKey, setNewKey] = useState("");
  const [confirmKey, setConfirmKey] = useState("");
  const [isSubmittingKey, setIsSubmittingKey] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showDialogApiKey, setShowDialogApiKey] = useState(false);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (route === "/login") {
        if (!active) {
          return;
        }
        setSession(null);
        return;
      }

      const storedSession = await getValidatedAuthSession();
      if (!active) {
        return;
      }
      setSession(storedSession);
    };

    void load();
    return () => {
      active = false;
    };
  }, [route]);

  useEffect(() => {
    if (!session) {
      setThirdPartyApps(null);
      return;
    }
    let active = true;
    const load = async () => {
      try {
        const data = await fetchThirdPartyApps();
        if (active) {
          setThirdPartyApps(data.third_party_apps);
        }
      } catch {
        if (active) {
          setThirdPartyApps(null);
        }
      }
    };
    const reload = () => void load();

    void load();
    window.addEventListener("third-party-apps-updated", reload);
    return () => {
      active = false;
      window.removeEventListener("third-party-apps-updated", reload);
    };
  }, [session]);

  const handleLogout = async () => {
    await clearStoredAuthSession();
    router.replace("/login");
  };

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      toast.success("已复制到剪贴板");
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast.error("复制失败，请手动复制");
    }
  };

  const handleKeyChangeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oldKey.trim()) {
      toast.error("请输入当前旧密钥");
      return;
    }
    if (!newKey.trim()) {
      toast.error("请输入新密钥");
      return;
    }
    if (newKey.trim().length < 6) {
      toast.error("新密钥长度至少 6 位");
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

    setIsSubmittingKey(true);
    try {
      const res = await updateSelfProfile({
        old_key: oldKey.trim(),
        new_key: newKey.trim(),
      });
      if (res.success && session) {
        const nextKey = res.new_key || newKey.trim();
        const updatedSession: StoredAuthSession = { ...session, key: nextKey };
        await setStoredAuthSession(updatedSession);
        setSession(updatedSession);
        toast.success("密钥修改成功，已自动生效！");
        setIsKeyDialogOpen(false);
        setOldKey("");
        setNewKey("");
        setConfirmKey("");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "修改密钥失败");
    } finally {
      setIsSubmittingKey(false);
    }
  };

  if (route === "/login" || !session) {
    return null;
  }

  const managementItems = session.role === "admin" ? [...adminItems, settingsItem] : [settingsItem];
  const roleLabel = session.role === "admin" ? "管理员" : "普通用户";
  const displayName = session.name.trim() || roleLabel;
  const baseUrl = webConfig.apiUrl.replace(/\/$/, "") || window.location.origin;
  const canvas = thirdPartyApps?.infinite_canvas;
  const canvasHref = canvas?.enabled && canvas.url.trim() ? buildThirdPartyHref(canvas.url, baseUrl, session.key) : "";
  const canvasDisplayHref = canvasHref ? decodeURIComponent(canvasHref) : "";

  const handleCanvasOpen = () => {
    if (!canvasHref) {
      return;
    }
    setIsCanvasDialogOpen(true);
  };

  const confirmCanvasOpen = () => {
    if (canvasHref) {
      window.open(canvasHref, "_blank", "noopener,noreferrer");
    }
    setIsCanvasDialogOpen(false);
  };

  const isItemActive = (itemHref: string) => {
    if (itemHref.startsWith("/image?mode=")) {
      if (route !== "/image") return false;
      const targetMode = itemHref.split("mode=")[1];
      const currentMode = mode === "agent" ? "agent" : mode === "canvas" ? "canvas" : "gallery";
      return targetMode === currentMode;
    }
    return route === itemHref;
  };

  return (
    <>
      <header className="workspace-nav-rail">
        <Sheet>
          <SheetTrigger className="workspace-nav-trigger fish-logo-trigger" aria-label="打开详细导航">
            <FishLogo className="w-9" />
          </SheetTrigger>
          <SheetContent side="left" overlayClassName="bg-black/20" className="workspace-nav-sheet w-[min(252px,calc(100vw-1.5rem))] gap-0 p-4 data-[state=closed]:duration-150 data-[state=open]:duration-200 sm:max-w-none">
            <SheetHeader className="flex-row items-center gap-2 p-0 pr-6 pb-5">
              <FishLogo className="w-11 shrink-0" animated />
              <div className="min-w-0">
                <SheetTitle className="text-sm">AI 创作平台</SheetTitle>
                <SheetDescription className="truncate text-xs">{displayName === roleLabel ? roleLabel : `${displayName} · ${roleLabel}`}</SheetDescription>
              </div>
            </SheetHeader>
            <nav aria-label="工作台导航" className="min-h-0 space-y-4 overflow-y-auto">
              {[{ label: "工作模式", items: workspaceItems }, { label: "管理", items: managementItems }].map((group) => (
                <div role="group" aria-label={group.label} key={group.label}>
                  <p aria-hidden="true" className="px-2.5 pb-1.5 text-xs text-muted-foreground">{group.label}</p>
                  {group.items.map(({ href, icon: Icon, label }) => (
                    <SheetClose asChild key={href}>
                      <Link href={href} aria-current={isItemActive(href) ? "page" : undefined} className="workspace-nav-link">
                        <Icon aria-hidden="true" className="size-4 shrink-0" />
                        {label}
                      </Link>
                    </SheetClose>
                  ))}
                  {group.items === workspaceItems && canvasHref ? (
                    <SheetClose asChild>
                      <button type="button" className="workspace-nav-link" onClick={handleCanvasOpen}>
                        <LayoutGrid aria-hidden="true" className="size-4 shrink-0" />
                        无限画布
                      </button>
                    </SheetClose>
                  ) : null}
                </div>
              ))}
            </nav>
          </SheetContent>
        </Sheet>
        <nav aria-label="快速切换" className="workspace-rail-links">
          {workspaceItems.map(({ href, icon: Icon, label }) => (
            <Link
              key={href}
              href={href}
              aria-label={label}
              aria-current={isItemActive(href) ? "page" : undefined}
              title={label}
              className="workspace-rail-link"
            >
              <Icon aria-hidden="true" className="size-4" />
            </Link>
          ))}
          <span className="workspace-rail-divider" aria-hidden="true" />
          {managementItems.map(({ href, icon: Icon, label }) => (
            <Link
              key={href}
              href={href}
              aria-label={label}
              aria-current={isItemActive(href) ? "page" : undefined}
              title={label}
              className="workspace-rail-link"
            >
              <Icon aria-hidden="true" className="size-4" />
            </Link>
          ))}
        </nav>
        <div className="workspace-rail-utility">
          <HeaderActions compact canUpgrade={session.role === "admin"} />
          <span className="workspace-rail-divider" aria-hidden="true" />
          <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
            <PopoverTrigger asChild>
              <button type="button" aria-label="用户菜单" className="workspace-user-trigger">
                <User className="size-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" side="right" sideOffset={10} collisionPadding={8} className="w-56 rounded-2xl p-2 shadow-xl">
              <div className="border-b border-stone-100 px-2.5 py-2 dark:border-white/10">
                <p className="text-xs font-semibold text-stone-900 dark:text-stone-100 truncate">{displayName}</p>
                <p className="mt-0.5 text-[11px] text-stone-400">{roleLabel} 账户</p>
              </div>
              <div className="py-1 space-y-0.5">
                <Link
                  href="/settings"
                  onClick={() => setIsPopoverOpen(false)}
                  className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-white/10 transition-colors"
                >
                  <Settings className="size-3.5 text-stone-500" />
                  设置
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setIsPopoverOpen(false);
                    setIsKeyDialogOpen(true);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-white/10 transition-colors"
                >
                  <KeyRound className="size-3.5 text-stone-500" />
                  修改个人密钥
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsPopoverOpen(false);
                    setIsApiDocsDialogOpen(true);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-white/10 transition-colors"
                >
                  <BookOpen className="size-3.5 text-stone-500" />
                  接口接入说明
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsPopoverOpen(false);
                    window.dispatchEvent(new CustomEvent("open-version-release"));
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-white/10 transition-colors"
                >
                  <Sparkles className="size-3.5 text-stone-500" />
                  版本更新说明
                </button>
              </div>
              <div className="border-t border-stone-100 pt-1 dark:border-white/10">
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40 transition-colors"
                >
                  <LogOut className="size-3.5" />
                  退出登录
                </button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </header>
      <Dialog open={isCanvasDialogOpen} onOpenChange={setIsCanvasDialogOpen}>
        <DialogContent showCloseButton={false} className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>跳转到三方应用</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              该入口仅供个人测试使用，建议自行本机部署后再长期使用。跳转地址会默认带上本项目地址和当前密钥，用于自动填充连接信息；如果不放心，可以取消后手动前往应用并自行输入。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-xs font-medium text-stone-500">完整跳转地址</div>
            <div className="max-h-28 overflow-auto break-all rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 font-mono text-xs leading-5 text-stone-700">
              {canvasDisplayHref}
            </div>
          </div>
          <DialogFooter className="pt-2">
            <DialogClose asChild>
              <Button type="button" variant="outline" className="rounded-xl border-stone-200 bg-white text-stone-700">
                取消
              </Button>
            </DialogClose>
            <Button type="button" className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" onClick={confirmCanvasOpen}>
              继续跳转
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 修改个人密钥弹窗 */}
      <Dialog open={isKeyDialogOpen} onOpenChange={setIsKeyDialogOpen}>
        <DialogContent showCloseButton={false} className="rounded-2xl p-6 sm:max-w-md">
          <DialogHeader className="gap-2">
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-5 text-amber-500" />
              修改个人密钥
            </DialogTitle>
            <DialogDescription className="text-sm leading-6">
              更新您的登录与 API 调用密钥。修改成功后将自动使用新密钥保持登录。
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleKeyChangeSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-stone-600 dark:text-stone-400">当前旧密钥</label>
              <Input
                type="password"
                value={oldKey}
                onChange={(e) => setOldKey(e.target.value)}
                placeholder="请输入当前正在使用的旧密钥"
                className="h-10 rounded-xl"
                autoComplete="current-password"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-stone-600 dark:text-stone-400">新密钥</label>
              <Input
                type="password"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="至少 6 位的新密钥"
                className="h-10 rounded-xl"
                autoComplete="new-password"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-stone-600 dark:text-stone-400">确认新密钥</label>
              <Input
                type="password"
                value={confirmKey}
                onChange={(e) => setConfirmKey(e.target.value)}
                placeholder="请再次输入新密钥"
                className="h-10 rounded-xl"
                autoComplete="new-password"
                required
              />
            </div>
            <DialogFooter className="pt-3">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl border-stone-200"
                onClick={() => {
                  setIsKeyDialogOpen(false);
                  setOldKey("");
                  setNewKey("");
                  setConfirmKey("");
                }}
                disabled={isSubmittingKey}
              >
                取消
              </Button>
              <Button
                type="submit"
                className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
                disabled={isSubmittingKey}
              >
                {isSubmittingKey ? <LoaderCircle className="mr-1.5 size-4 animate-spin" /> : null}
                确认修改
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 接口接入说明弹窗 */}
      <Dialog
        open={isApiDocsDialogOpen}
        onOpenChange={(open) => {
          setIsApiDocsDialogOpen(open);
          if (!open) setShowDialogApiKey(false);
        }}
      >
        <DialogContent showCloseButton={false} className="rounded-2xl p-6 sm:max-w-lg">
          <DialogHeader className="gap-2">
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="size-5 text-indigo-500" />
              接口接入说明
            </DialogTitle>
            <DialogDescription className="text-sm leading-6">
              您可以使用兼容 OpenAI 标准的客户端（如 NextChat、ChatBox 等）直接调用本站的 AI 服务。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-medium text-stone-600 dark:text-stone-400">
                <span>API 接口地址 (Base URL)</span>
                <button
                  type="button"
                  onClick={() => void copyToClipboard(`${baseUrl}/v1`, "base-url")}
                  className="flex items-center gap-1 text-[11px] text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
                >
                  {copiedField === "base-url" ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                  复制地址
                </button>
              </div>
              <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 font-mono text-xs text-stone-800 dark:border-white/10 dark:bg-stone-900/50 dark:text-stone-200">
                {baseUrl}/v1
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-xs font-medium text-stone-600 dark:text-stone-400">
                <span>您的专属 API 密钥 (API Key)</span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setShowDialogApiKey((visible) => !visible)}
                    aria-label={showDialogApiKey ? "隐藏密钥" : "显示密钥"}
                    aria-pressed={showDialogApiKey}
                    className="flex items-center gap-1 text-[11px] text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
                  >
                    {showDialogApiKey ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                    {showDialogApiKey ? "隐藏密钥" : "显示密钥"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyToClipboard(session?.key || "", "api-key")}
                    className="flex items-center gap-1 text-[11px] text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
                  >
                    {copiedField === "api-key" ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                    复制密钥
                  </button>
                </div>
              </div>
              <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 font-mono text-xs text-stone-800 dark:border-white/10 dark:bg-stone-900/50 dark:text-stone-200 truncate">
                {showDialogApiKey ? session?.key : maskSecretKey(session?.key || "")}
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="text-xs font-medium text-stone-600 dark:text-stone-400">支持模型</span>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl border border-stone-200/80 p-2.5 dark:border-white/10">
                  <div className="font-semibold text-stone-800 dark:text-stone-200">gpt-image-2</div>
                  <div className="mt-0.5 text-[11px] text-stone-400">文生图 / 图像编辑</div>
                </div>
                <div className="rounded-xl border border-stone-200/80 p-2.5 dark:border-white/10">
                  <div className="font-semibold text-stone-800 dark:text-stone-200">auto / gpt-4o</div>
                  <div className="mt-0.5 text-[11px] text-stone-400">智能对话 / 联网搜索</div>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="pt-3">
            <Button
              type="button"
              className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => setIsApiDocsDialogOpen(false)}
            >
              我知道了
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function TopNav() {
  return (
    <Suspense fallback={null}>
      <TopNavInner />
    </Suspense>
  );
}
