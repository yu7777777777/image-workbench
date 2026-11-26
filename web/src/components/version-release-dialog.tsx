"use client";

import { useEffect, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import webConfig from "@/constants/common-env";
import { useVersionCheck } from "@/hooks/use-version-check";
import { cn } from "@/lib/utils";

function typeVariant(type: string): "success" | "danger" | "info" | "violet" | "outline" {
  if (type === "新增") return "success";
  if (type === "修复") return "danger";
  if (type === "调整" || type === "优化") return "info";
  if (type === "文档") return "violet";
  return "outline";
}

export function VersionReleaseDialog({ className, compact = false, canUpgrade = false }: { className?: string; compact?: boolean; canUpgrade?: boolean }) {
  const {
    open,
    setOpen,
    openReleaseModal,
    latestVersion,
    releases,
    checking,
    hasNewVersion,
    checkLatestRelease,
    upgrading,
    upgradeResult,
    startUpgrade,
  } = useVersionCheck(canUpgrade);
  const hasPendingRelease = Boolean(
    hasNewVersion && latestVersion && upgradeResult?.version !== latestVersion,
  );

  useEffect(() => {
    const handleOpen = () => openReleaseModal();
    window.addEventListener("open-version-release", handleOpen);
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === "open-version-release") {
        openReleaseModal();
      }
    };
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("open-version-release", handleOpen);
      window.removeEventListener("message", handleMessage);
    };
  }, [openReleaseModal]);

  return (
    <>
      <button
        type="button"
        className={cn(
          "relative inline-flex cursor-pointer select-none items-center",
          compact ? "workspace-version-trigger" : "rounded-full border border-stone-200/90 bg-stone-50/90 px-2 py-0.5 text-[11px] font-semibold text-stone-600 transition hover:border-stone-300 hover:bg-stone-100 hover:text-stone-900 dark:border-white/10 dark:bg-white/[0.05] dark:text-stone-300 dark:hover:bg-white/[0.1] dark:hover:text-white",
          className,
        )}
        onClick={openReleaseModal}
        title="点击查看版本更新说明"
      >
        v{webConfig.appVersion}
        {hasNewVersion ? (
          <span className={cn("absolute rounded-full bg-emerald-500", compact ? "top-1 right-0 size-1" : "-top-0.5 -right-0.5 size-2 ring-2 ring-white dark:ring-stone-900")} />
        ) : null}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[min(94vw,680px)] rounded-2xl">
          <DialogHeader>
            <DialogTitle>版本更新</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <VersionCard label="当前版本" value={webConfig.appVersion} />
            <VersionCard
              label="最新版本"
              value={latestVersion ?? "检查中..."}
              action={
                <button
                  type="button"
                  className="text-[11px] text-stone-400 underline-offset-2 hover:text-stone-700 hover:underline dark:hover:text-stone-200"
                  onClick={() => void checkLatestRelease(true)}
                >
                  {checking ? "检查中..." : "检查更新"}
                </button>
              }
            />
          </div>
          {canUpgrade && (
            <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-3 dark:border-white/10 dark:bg-white/[0.04]">
              {upgrading ? (
                <div className="text-sm text-stone-700 dark:text-stone-300">
                  升级执行中（校验 → 快照 → 派生镜像 → 自检 → 切换），通常需要 1-2 分钟，完成后会提示刷新页面……
                </div>
              ) : hasPendingRelease && latestVersion ? (
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => void startUpgrade(latestVersion)}
                >
                  立即升级到 {latestVersion}
                </Button>
              ) : upgradeResult?.status === "success" ? (
                <div className="text-sm text-emerald-600 dark:text-emerald-400">
                  已成功升级到 {upgradeResult.version}（耗时 {upgradeResult.elapsed_secs ?? "-"} 秒），请刷新页面使用新版本。
                </div>
              ) : upgradeResult?.status === "failed" ? (
                <div className="space-y-2.5">
                  <div className="text-sm text-red-600 dark:text-red-400">
                    升级到 {upgradeResult.version} 失败：{upgradeResult.error ?? "未知原因"}（服务器已自动回滚）
                  </div>
                  {hasNewVersion && latestVersion ? (
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => void startUpgrade(latestVersion)}
                    >
                      重试升级到 {latestVersion}
                    </Button>
                  ) : null}
                </div>
              ) : (
                <div className="text-xs text-stone-400 dark:text-gray-500">当前已是最新版本。</div>
              )}
            </div>
          )}
          <div className="max-h-[56vh] space-y-5 overflow-y-auto pr-1">
            {releases.map((release) => (
              <div key={release.version} className="border-l border-stone-200 pl-4 dark:border-white/10">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-stone-950 dark:text-stone-100">
                    {release.version === "Unreleased" ? "未发布" : release.version}
                  </span>
                  <span className="text-xs text-stone-500 dark:text-stone-400">{release.date}</span>
                  {release.version === latestVersion ? <Badge variant="success">最新</Badge> : null}
                  {release.version === webConfig.appVersion ? <Badge variant="outline">当前</Badge> : null}
                </div>
                <div className="mt-2 space-y-1.5">
                  {release.items.map((item, index) => (
                    <div key={index} className="flex items-start gap-2 text-sm leading-6 text-stone-700 dark:text-stone-300">
                      <Badge variant={typeVariant(item.type)} className="mt-0.5 shrink-0">
                        {item.type}
                      </Badge>
                      <span className="min-w-0 flex-1">{item.content}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            关闭
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

function VersionCard({
  label,
  value,
  action,
}: {
  label: string;
  value: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white/55 p-3 dark:border-white/10 dark:bg-white/5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-stone-500 dark:text-stone-400">{label}</div>
        {action}
      </div>
      <div className="mt-1 text-base font-semibold text-stone-950 dark:text-stone-100">{value}</div>
    </div>
  );
}
