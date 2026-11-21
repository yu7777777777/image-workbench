"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { HeaderActions } from "@/components/header-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetClose, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import webConfig from "@/constants/common-env";
import { fetchThirdPartyApps, updateSelfProfile, type ThirdPartyAppsSettings } from "@/lib/api";
import { getValidatedAuthSession } from "@/lib/auth-session";
import { cn } from "@/lib/utils";
import { clearStoredAuthSession, setStoredAuthSession, type StoredAuthSession } from "@/store/auth";
import { BookOpen, Check, Copy, KeyRound, LoaderCircle, LogOut, Settings, ShieldCheck, Sparkles, User } from "lucide-react";
import { toast } from "sonner";

const adminNavItems = [
  { href: "/image?mode=gallery", label: "画廊" },
  { href: "/image?mode=canvas", label: "画布" },
  { href: "/image?mode=agent", label: "Agent" },
  { href: "/chat", label: "对话" },
  { href: "/accounts", label: "号池管理" },
  { href: "/image-manager", label: "图片管理" },
  { href: "/logs", label: "日志管理" },
  { href: "/debug", label: "调试" },
  { href: "/settings", label: "设置" },
];

const userNavItems = [
  { href: "/image?mode=gallery", label: "画廊" },
  { href: "/image?mode=canvas", label: "画布" },
  { href: "/image?mode=agent", label: "Agent" },
  { href: "/chat", label: "对话" },
  { href: "/settings", label: "设置" },
];

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

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (pathname === "/login") {
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
  }, [pathname]);

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

  if (pathname === "/login" || session === undefined || !session) {
    return null;
  }

  const navItems = session.role === "admin" ? adminNavItems : userNavItems;
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
      if (pathname !== "/image") return false;
      const targetMode = itemHref.split("mode=")[1];
      const currentMode = mode === "agent" ? "agent" : mode === "canvas" ? "canvas" : "gallery";
      return targetMode === currentMode;
    }
    return pathname?.replace(/\/$/, "") === itemHref;
  };

  return (
    <>
      <header className="border-b border-zinc-100/50 dark:border-white/10">
        <div className="relative flex min-h-12 flex-col gap-1 px-3 py-2 sm:h-12 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-0">
          <div className="flex w-full items-center justify-between gap-2 xl:w-auto xl:justify-start xl:gap-3">
            <Sheet>
              <SheetTrigger className="inline-flex size-8 items-center justify-center text-zinc-700 transition hover:text-zinc-950 xl:hidden dark:text-zinc-200 dark:hover:text-white">
                <Menu className="size-4" />
                <span className="sr-only">打开导航</span>
              </SheetTrigger>
              <SheetContent side="left">
                <SheetHeader>
                  <SheetTitle className="text-base font-semibold">控制台</SheetTitle>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">{roleLabel} · {displayName}</span>
                </SheetHeader>
                <nav className="mt-8 flex flex-col gap-1">
                  {canvasHref ? (
                    <SheetClose asChild>
                      <button
                        type="button"
                        className="flex items-center rounded-xl px-3 py-2.5 text-left text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
                        onClick={handleCanvasOpen}
                      >
                        无限画布
                      </button>
                    </SheetClose>
                  ) : null}
                  {navItems.map((item) => {
                    const active = isItemActive(item.href);
                    const className = cn(
                      "flex items-center rounded-xl px-3 py-2.5 text-sm font-medium transition",
                      active ? "bg-zinc-950 text-white dark:bg-white dark:text-zinc-950" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white",
                    );
                    return (
                      <SheetClose asChild key={item.href}>
                        <Link href={item.href} className={className}>{item.label}</Link>
                      </SheetClose>
                    );
                  })}
                </nav>
                <SheetFooter className="mt-4 flex flex-col gap-2 border-t border-zinc-100 pt-4 dark:border-white/10">
                  <button
                    type="button"
                    className="flex items-center gap-2.5 rounded-xl border border-zinc-200 px-3 py-2.5 text-left text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-white/10 dark:text-zinc-200 dark:hover:bg-white/10"
                    onClick={() => setIsKeyDialogOpen(true)}
                  >
                    <KeyRound className="size-4 text-zinc-500" />
                    修改个人密钥
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-2.5 rounded-xl border border-zinc-200 px-3 py-2.5 text-left text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-white/10 dark:text-zinc-200 dark:hover:bg-white/10"
                    onClick={() => setIsApiDocsDialogOpen(true)}
                  >
                    <BookOpen className="size-4 text-zinc-500" />
                    接口接入说明
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-2.5 rounded-xl border border-zinc-200 px-3 py-2.5 text-left text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-white/10 dark:text-zinc-200 dark:hover:bg-white/10"
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent("open-version-release"));
                    }}
                  >
                    <Sparkles className="size-4 text-zinc-500" />
                    版本更新说明
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-2.5 rounded-xl border border-rose-200 px-3 py-2.5 text-left text-sm font-medium text-rose-600 transition hover:bg-rose-50 dark:border-rose-900/40 dark:text-rose-400 dark:hover:bg-rose-950/30"
                    onClick={() => void handleLogout()}
                  >
                    <LogOut className="size-4" />
                    退出登录
                  </button>
                </SheetFooter>
              </SheetContent>
            </Sheet>
            <HeaderActions className="ml-auto xl:hidden" showGithubText={false} />
          </div>
          <nav className="hide-scrollbar -mx-1 hidden min-w-0 gap-1 overflow-x-auto px-1 xl:mx-0 xl:flex xl:items-center xl:justify-center xl:gap-5 2xl:gap-8 xl:overflow-visible xl:px-0 xl:absolute xl:left-1/2 xl:top-1/2 xl:-translate-x-1/2 xl:-translate-y-1/2">
            {canvasHref ? (
              <button
                type="button"
                onClick={handleCanvasOpen}
                className="relative shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-medium text-zinc-500 transition hover:text-zinc-900 sm:rounded-none sm:px-0 sm:text-[15px] dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                无限画布
              </button>
            ) : null}
            {navItems.map((item) => {
              const active = isItemActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "relative shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-medium transition sm:rounded-none sm:px-0 sm:text-[15px]",
                    active
                      ? "bg-zinc-950 text-white sm:bg-transparent sm:font-semibold sm:text-zinc-950 dark:bg-white dark:text-zinc-950 dark:sm:bg-transparent dark:sm:text-white"
                      : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
                  )}
                >
                  {item.label}
                  {active ? <span className="absolute inset-x-0 -bottom-[1px] hidden h-0.5 bg-zinc-950 dark:bg-white sm:block" /> : null}
                </Link>
              );
            })}
          </nav>
          <div className="hidden items-center justify-end gap-2 xl:flex xl:gap-3">
            <HeaderActions />
            <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="group flex items-center gap-2 rounded-full border border-zinc-200/80 bg-white/70 py-1 pl-2.5 pr-3 text-xs font-medium text-zinc-700 shadow-sm backdrop-blur-sm transition-all hover:border-zinc-300 hover:bg-white dark:border-white/10 dark:bg-zinc-900/70 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <div className="flex size-5 items-center justify-center rounded-full bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
                    <User className="size-3" />
                  </div>
                  <span className="max-w-[120px] truncate">{displayName}</span>
                  <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-white/10 dark:text-zinc-400">
                    {roleLabel}
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={8} className="w-56 p-2 rounded-2xl shadow-xl">
                <div className="border-b border-zinc-100 px-2.5 py-2 dark:border-white/10">
                  <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">{displayName}</p>
                  <p className="mt-0.5 text-[11px] text-zinc-400">{roleLabel} 账户</p>
                </div>
                <div className="py-1 space-y-0.5">
                  <Link
                    href="/settings"
                    onClick={() => setIsPopoverOpen(false)}
                    className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-white/10 transition-colors"
                  >
                    <Settings className="size-3.5 text-zinc-500" />
                    设置
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setIsPopoverOpen(false);
                      setIsKeyDialogOpen(true);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-white/10 transition-colors"
                  >
                    <KeyRound className="size-3.5 text-zinc-500" />
                    修改个人密钥
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsPopoverOpen(false);
                      setIsApiDocsDialogOpen(true);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-white/10 transition-colors"
                  >
                    <BookOpen className="size-3.5 text-zinc-500" />
                    接口接入说明
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsPopoverOpen(false);
                      window.dispatchEvent(new CustomEvent("open-version-release"));
                    }}
                    className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-white/10 transition-colors"
                  >
                    <Sparkles className="size-3.5 text-zinc-500" />
                    版本更新说明
                  </button>
                </div>
                <div className="border-t border-zinc-100 pt-1 dark:border-white/10">
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
            <div className="text-xs font-medium text-zinc-500">完整跳转地址</div>
            <div className="max-h-28 overflow-auto break-all rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-xs leading-5 text-zinc-700">
              {canvasDisplayHref}
            </div>
          </div>
          <DialogFooter className="pt-2">
            <DialogClose asChild>
              <Button type="button" variant="outline" className="rounded-xl border-zinc-200 bg-white text-zinc-700">
                取消
              </Button>
            </DialogClose>
            <Button type="button" className="rounded-xl bg-zinc-950 text-white hover:bg-zinc-800" onClick={confirmCanvasOpen}>
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
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">当前旧密钥</label>
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
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">新密钥</label>
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
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">确认新密钥</label>
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
                className="rounded-xl border-zinc-200"
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
                className="rounded-xl bg-zinc-950 text-white hover:bg-zinc-800"
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
      <Dialog open={isApiDocsDialogOpen} onOpenChange={setIsApiDocsDialogOpen}>
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
              <div className="flex items-center justify-between text-xs font-medium text-zinc-600 dark:text-zinc-400">
                <span>API 接口地址 (Base URL)</span>
                <button
                  type="button"
                  onClick={() => void copyToClipboard(`${baseUrl}/v1`, "base-url")}
                  className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                >
                  {copiedField === "base-url" ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                  复制地址
                </button>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-800 dark:border-white/10 dark:bg-zinc-900/50 dark:text-zinc-200">
                {baseUrl}/v1
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-medium text-zinc-600 dark:text-zinc-400">
                <span>您的专属 API 密钥 (API Key)</span>
                <button
                  type="button"
                  onClick={() => void copyToClipboard(session?.key || "", "api-key")}
                  className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                >
                  {copiedField === "api-key" ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                  复制密钥
                </button>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-800 dark:border-white/10 dark:bg-zinc-900/50 dark:text-zinc-200 truncate">
                {session?.key}
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">支持模型</span>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl border border-zinc-200/80 p-2.5 dark:border-white/10">
                  <div className="font-semibold text-zinc-800 dark:text-zinc-200">gpt-image-2</div>
                  <div className="mt-0.5 text-[11px] text-zinc-400">文生图 / 图像编辑</div>
                </div>
                <div className="rounded-xl border border-zinc-200/80 p-2.5 dark:border-white/10">
                  <div className="font-semibold text-zinc-800 dark:text-zinc-200">auto / gpt-4o</div>
                  <div className="mt-0.5 text-[11px] text-zinc-400">智能对话 / 联网搜索</div>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="pt-3">
            <Button
              type="button"
              className="rounded-xl bg-zinc-950 text-white hover:bg-zinc-800"
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
    <Suspense fallback={<header className="border-b border-zinc-100/50 dark:border-white/10 min-h-12" />}>
      <TopNavInner />
    </Suspense>
  );
}
