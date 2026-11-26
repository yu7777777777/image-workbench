"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { fetchUpgradeStatus, triggerUpgrade } from "@/lib/api";
import webConfig from "@/constants/common-env";
import { parseChangelog, type ReleaseInfo } from "@/lib/release";

const GITHUB_LATEST_URL = "https://api.github.com/repos/yu7777777777/image-workbench/releases/latest";

function readLocalReleases(): ReleaseInfo[] {
  return JSON.parse(process.env.NEXT_PUBLIC_APP_RELEASES || "[]");
}

function toVersionParts(version: string) {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

function isNewerVersion(latestVersion: string, currentVersion: string) {
  const latest = toVersionParts(latestVersion);
  const current = toVersionParts(currentVersion);
  if (!latest || !current) return false;
  return latest.some(
    (value, index) =>
      value > current[index] &&
      latest.slice(0, index).every((part, prevIndex) => part === current[prevIndex]),
  );
}

export interface UpgradeRunResult {
  status: "success" | "failed";
  version: string;
  error?: string;
  elapsed_secs?: number;
}

export function useVersionCheck(canUpgrade: boolean) {
  const currentVersion = webConfig.appVersion;
  const localReleases = useMemo(readLocalReleases, []);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [releases, setReleases] = useState<ReleaseInfo[]>(localReleases);
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeResult, setUpgradeResult] = useState<UpgradeRunResult | null>(null);
  const hasNewVersion = latestVersion ? isNewerVersion(latestVersion, currentVersion) : false;

  const checkLatestRelease = useCallback(async (showMessage = false) => {
    setChecking(true);
    try {
      // GitHub API 支持跨域，公开仓库的 latest 版本可直接从浏览器查询。
      const response = await fetch(GITHUB_LATEST_URL, {
        headers: { Accept: "application/vnd.github+json" },
        cache: "no-store",
      });
      let fetched: string | null = null;
      if (response.ok) {
        const data = await response.json();
        const tag = String(data.tag_name || "").replace(/^v/, "");
        if (tag) {
          fetched = tag;
          setLatestVersion(tag);
        }
      }
      if (canUpgrade) {
        // 同步一次服务器端升级状态（管理员）：上次升级结果/待处理请求
        try {
          const status = await fetchUpgradeStatus();
          if (status.last_result) {
            setUpgradeResult({
              status: status.last_result.status === "success" ? "success" : "failed",
              version: status.last_result.version,
              error: status.last_result.error,
              elapsed_secs: status.last_result.elapsed_secs,
            });
          }
          if (status.request_pending) setUpgrading(true);
          else if (status.last_result?.status === "success") setUpgrading(false);
        } catch {
          // 暂时无法读取升级状态时仍保留版本信息。
        }
      }
      if (showMessage) {
        toast.success(
          fetched && isNewerVersion(fetched, currentVersion)
            ? `检测到新版本 ${fetched}`
            : "当前已是最新版本",
        );
      }
    } finally {
      setChecking(false);
    }
  }, [canUpgrade, currentVersion]);

  const startUpgrade = useCallback(
    async (version: string) => {
      if (!canUpgrade) return false;
      setUpgrading(true);
      try {
        await triggerUpgrade(version);
        toast.success(`升级请求已受理（${version}），宿主机升级器将在一分钟内执行`);
        // 轮询升级结果（最长 ~8 分钟：镜像派生 + 自检 + 切换）
        for (let attempt = 0; attempt < 60; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 8000));
          const status = await fetchUpgradeStatus();
          if (status.last_result && status.last_result.version === version) {
            const ok = status.last_result.status === "success";
            setUpgrading(false);
            setUpgradeResult({
              status: ok ? "success" : "failed",
              version,
              error: status.last_result.error,
              elapsed_secs: status.last_result.elapsed_secs,
            });
            if (ok) toast.success(`服务器已升级到 ${version}，请刷新页面`);
            else toast.error(`升级失败：${status.last_result.error ?? "未知原因"}`);
            return ok;
          }
          if (!status.request_pending) {
            // 触发文件已被消费但结果尚未落盘，继续等待一次
          }
        }
        setUpgrading(false);
        toast.error("升级超时，请稍后刷新页面查看结果或检查服务器日志");
        return false;
      } catch (error) {
        setUpgrading(false);
        const message = error instanceof Error ? error.message : "触发升级失败";
        toast.error(message);
        return false;
      }
    },
    [canUpgrade],
  );

  const openReleaseModal = () => {
    setOpen(true);
    void checkLatestRelease();
  };

  return {
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
  };
}
