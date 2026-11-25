"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps } from "react";
import {
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleOff,
  Copy,
  Download,
  Link2,
  LoaderCircle,
  LogIn,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deleteAccounts,
  fetchAccounts,
  fetchModels,
  fetchRefreshProgress,
  fetchReLoginProgress,
  reLoginAccounts,
  refreshAccounts,
  testProxy,
  updateAccount,
  type Account,
  type AccountRefreshResponse,
  type AccountStatus,
  type Model,
  type RefreshProgressResponse,
} from "@/lib/api";
import { useAuthGuard } from "@/lib/use-auth-guard";
import { cn } from "@/lib/utils";

import { AccountImportDialog } from "./components/account-import-dialog";

const accountStatusOptions: { label: string; value: AccountStatus | "all" }[] = [
  { label: "全部状态", value: "all" },
  { label: "正常", value: "正常" },
  { label: "限流", value: "限流" },
  { label: "异常", value: "异常" },
  { label: "禁用", value: "禁用" },
];

const statusMeta: Record<
  AccountStatus,
  {
    icon: typeof CheckCircle2;
    badge: ComponentProps<typeof Badge>["variant"];
  }
> = {
  正常: { icon: CheckCircle2, badge: "success" },
  限流: { icon: CircleAlert, badge: "warning" },
  异常: { icon: CircleOff, badge: "danger" },
  禁用: { icon: Ban, badge: "secondary" },
};

const metricCards = [
  { key: "total", label: "账户总数", color: "text-stone-900", icon: UserRound },
  { key: "active", label: "正常账户", color: "text-emerald-600", icon: CheckCircle2 },
  { key: "limited", label: "限流账户", color: "text-orange-500", icon: CircleAlert },
  { key: "abnormal", label: "异常账户", color: "text-rose-500", icon: CircleOff },
  { key: "disabled", label: "禁用账户", color: "text-stone-500", icon: Ban },
  { key: "quota", label: "剩余额度", color: "text-blue-500", icon: RefreshCw },
] as const;

function formatCompact(value: number) {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return String(value);
}

function formatQuota(account: Account) {
  return String(Math.max(0, account.quota));
}

function formatRestoreAt(value?: string | null) {
  if (!value) {
    return { absolute: "—", relative: "" };
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { absolute: value, relative: "" };
  }

  const diffMs = Math.max(0, date.getTime() - Date.now());
  const totalHours = Math.ceil(diffMs / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const relative = diffMs > 0 ? `剩余 ${days}d ${hours}h` : "已到恢复时间";

  const pad = (num: number) => String(num).padStart(2, "0");
  // 不带秒：列宽有限，带上秒会在窄屏折行
  const absolute = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;

  return { absolute, relative };
}

function formatQuotaSummary(accounts: Account[]) {
  const availableAccounts = accounts.filter((account) => account.status === "正常");
  return formatCompact(availableAccounts.reduce((sum, account) => sum + Math.max(0, account.quota), 0));
}

function formatLastUsedAt(value?: string | null) {
  if (!value) {
    return { absolute: "", relative: "", fresh: false };
  }
  // last_used_at 由服务端按北京时间写入且无时区后缀，必须显式按 +08:00 解析成绝对时刻
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const suffix = /(?:[Zz]|[+-]\d{2}:?\d{2})$/.test(normalized) ? "" : "+08:00";
  const date = new Date(normalized + suffix);
  // 绝对时间直接截取服务端原串，避免浏览器时区差异导致显示偏移
  const absolute = value.slice(5, 16);
  if (Number.isNaN(date.getTime())) {
    return { absolute, relative: "", fresh: false };
  }
  const ageMs = Date.now() - date.getTime();
  let relative: string;
  if (ageMs < 60 * 1000) relative = "刚刚";
  else if (ageMs < 60 * 60 * 1000) relative = `${Math.floor(ageMs / (60 * 1000))} 分钟前`;
  else if (ageMs < 24 * 60 * 60 * 1000) relative = `${Math.floor(ageMs / (60 * 60 * 1000))} 小时前`;
  else relative = `${Math.floor(ageMs / (24 * 60 * 60 * 1000))} 天前`;
  return { absolute, relative, fresh: ageMs < 10 * 60 * 1000 };
}

function maskToken(token?: string) {
  if (!token) return "—";
  if (token.length <= 18) return token;
  // 10+6 位掩码：完整 16+8 掩码会把 token 列撑到 220px+，固定布局下放不下
  return `${token.slice(0, 10)}...${token.slice(-6)}`;
}

function downloadTokens(accounts: Account[]) {
  const content = `${accounts.map((account) => account.access_token).join("\n")}\n`;
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `accounts-${Date.now()}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

function displayAccountType(account: Account) {
  return account.type || "Free";
}

function displayAccountSource(account: Account) {
  const source = String(account.source_type || "").trim().toLowerCase();
  if (!source) {
    return "web";
  }
  if (source === "web") {
    return "web";
  }
  if (source === "oauth_login" || source === "oauth") {
    return "OAuth";
  }
  return source;
}

function AccountsPageContent() {
  const didLoadRef = useRef(false);
  const pollTimersRef = useRef(new Set<ReturnType<typeof setInterval>>());
  const mountedRef = useRef(true);
  const loadInFlightRef = useRef(false);
  const stopPoll = (timer: ReturnType<typeof setInterval>) => {
    clearInterval(timer);
    pollTimersRef.current.delete(timer);
  };
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [availableModels, setAvailableModels] = useState<Model[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<AccountStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState("20");
  const [totalFilteredAccounts, setTotalFilteredAccounts] = useState(0);
  const [statusCounts, setStatusCounts] = useState<{ 正常: number; 限流: number; 异常: number; 禁用: number }>({
    正常: 0,
    限流: 0,
    异常: 0,
    禁用: 0,
  });
  const [totalQuota, setTotalQuota] = useState(0);
  const [isExportingAll, setIsExportingAll] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [editStatus, setEditStatus] = useState<AccountStatus>("正常");
  const [editProxy, setEditProxy] = useState("");
  const [isTestingProxy, setIsTestingProxy] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshingTokens, setRefreshingTokens] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isRelogining, setIsRelogining] = useState(false);
  const [progress, setProgress] = useState<{
    visible: boolean;
    current: number;
    total: number;
    message: string;
    email: string;
  }>({
    visible: false,
    current: 0,
    total: 0,
    message: "",
    email: "",
  });
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [refreshSummary, setRefreshSummary] = useState<Record<string, number | string> | null>(null);

  const loadAccounts = useCallback(
    async (pageToLoad = page, silent = false) => {
      if (loadInFlightRef.current) return;
      loadInFlightRef.current = true;
      if (!silent) {
        setIsLoading(true);
      }
      try {
        const data = await fetchAccounts({
          page: pageToLoad,
          pageSize: Number(pageSize),
          search: query.trim(),
          status: statusFilter,
          type: typeFilter,
        });
        setAccounts(data.items || []);
        setTotalFilteredAccounts(data.total ?? (data.items || []).length);
        if (data.status_counts) {
          setStatusCounts(data.status_counts);
        }
        if (typeof data.total_quota === "number") {
          setTotalQuota(data.total_quota);
        }
        setSelectedIds((prev) => {
          const tokens = new Set((data.items || []).map((item) => item.access_token));
          return prev.filter((id) => tokens.has(id));
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "加载账户失败";
        toast.error(message);
      } finally {
        loadInFlightRef.current = false;
        if (!silent) {
          setIsLoading(false);
        }
      }
    },
    [page, pageSize, query, statusFilter, typeFilter],
  );

  const loadModels = async () => {
    setIsLoadingModels(true);
    setModelLoadError(null);
    try {
      const data = await fetchModels();
      setAvailableModels(Array.isArray(data.data) ? data.data : []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载模型列表失败";
      setModelLoadError(message);
      toast.error(message);
    } finally {
      setIsLoadingModels(false);
    }
  };

  // 初始加载模型
  useEffect(() => {
    mountedRef.current = true;
    void loadModels();
    return () => {
      mountedRef.current = false;
      pollTimersRef.current.forEach(clearInterval);
      pollTimersRef.current.clear();
      if (progressRef.current) clearInterval(progressRef.current);
    };
  }, []);

  // 分页、筛选变化时加载数据
  useEffect(() => {
    void loadAccounts(page);
  }, [page, pageSize, statusFilter, typeFilter]);

  // 搜索关键字防抖 (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      void loadAccounts(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const currentRows = accounts;
  const pageCount = Math.max(1, Math.ceil(totalFilteredAccounts / Number(pageSize)));
  const safePage = Math.min(page, pageCount);
  const startIndex = (safePage - 1) * Number(pageSize);
  const allCurrentSelected =
    currentRows.length > 0 && currentRows.every((row) => selectedIds.includes(row.access_token));

  const summary = useMemo(() => {
    const total =
      (statusCounts["正常"] || 0) +
      (statusCounts["限流"] || 0) +
      (statusCounts["异常"] || 0) +
      (statusCounts["禁用"] || 0);
    const active = statusCounts["正常"] || 0;
    const limited = statusCounts["限流"] || 0;
    const abnormal = statusCounts["异常"] || 0;
    const disabled = statusCounts["禁用"] || 0;
    const quota = formatCompact(totalQuota || 0);

    return { total, active, limited, abnormal, disabled, quota };
  }, [statusCounts, totalQuota]);

  const accountTypeOptions = useMemo(
    () => [
      { label: "全部类型", value: "all" },
      { label: "free", value: "free" },
      { label: "plus", value: "plus" },
      { label: "team", value: "team" },
      { label: "prolite", value: "prolite" },
    ],
    [],
  );

  const selectedTokens = useMemo(() => {
    return selectedIds;
  }, [selectedIds]);

  const paginationItems = useMemo(() => {
    const items: (number | "...")[] = [];
    const start = Math.max(1, safePage - 1);
    const end = Math.min(pageCount, safePage + 1);

    if (start > 1) items.push(1);
    if (start > 2) items.push("...");
    for (let current = start; current <= end; current += 1) items.push(current);
    if (end < pageCount - 1) items.push("...");
    if (end < pageCount) items.push(pageCount);

    return items;
  }, [pageCount, safePage]);

  const handleExportAll = async () => {
    setIsExportingAll(true);
    try {
      toast.info("正在从服务器拉取全部 Token，请稍候...");
      const data = await fetchAccounts();
      downloadTokens(data.items);
      toast.success(`成功导出全部 ${data.items.length} 个账号 Token`);
    } catch {
      toast.error("导出失败，请重试");
    } finally {
      setIsExportingAll(false);
    }
  };

  const handleDeleteTokens = async (tokens: string[]) => {
    if (tokens.length === 0) {
      toast.error("请先选择要删除的账户");
      return;
    }

    setIsDeleting(true);
    try {
      const data = await deleteAccounts(tokens);
      void loadAccounts(page, true);
      setSelectedIds((prev) => prev.filter((id) => !tokens.includes(id)));
      toast.success(`删除 ${data.removed ?? 0} 个账户`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除账户失败";
      toast.error(message);
    } finally {
      setIsDeleting(false);
    }
  };

  /** 一键移除全部异常账号：不受分页限制，一次拉取全量异常账号后批量删除。 */
  const handleRemoveAllAbnormal = async () => {
    const total = statusCounts["异常"] || 0;
    if (total === 0) {
      toast.success("没有异常账号");
      return;
    }
    if (!window.confirm(`确定移除全部 ${total} 个异常账号吗？此操作不可恢复。`)) return;

    setIsDeleting(true);
    try {
      const result = await fetchAccounts({
        page: 1,
        pageSize: 100000,
        search: query.trim(),
        status: "异常",
        type: typeFilter,
      });
      const tokens = (result.items || []).map((item) => item.access_token).filter(Boolean);
      if (tokens.length === 0) {
        toast.success("没有异常账号");
        void loadAccounts(page, true);
        return;
      }
      const data = await deleteAccounts(tokens);
      void loadAccounts(page, true);
      setSelectedIds((prev) => prev.filter((id) => !tokens.includes(id)));
      toast.success(`已移除 ${data.removed ?? tokens.length} 个异常账号`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "移除异常账号失败";
      toast.error(message);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRefreshAccounts = async (accessTokens: string[], allAccounts = false) => {
    if (accessTokens.length === 0) {
      toast.error("没有需要刷新的账户");
      return;
    }

    if (accessTokens.length === 1) {
      setRefreshingTokens((prev) => new Set([...prev, accessTokens[0]]));
      try {
        const { progress_id } = await refreshAccounts(allAccounts ? [] : accessTokens);
        // 单账号：轮询等待完成
        await pollRefreshProgress(progress_id, (progress) => {
          if (progress.done) {
            void loadAccounts(page, true);
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "刷新账户失败";
        toast.error(message);
      } finally {
        setRefreshingTokens((prev) => {
          const next = new Set(prev);
          next.delete(accessTokens[0]);
          return next;
        });
      }
      return;
    }

    setIsRefreshing(true);

    // 计算非选中账号的基数（统计卡片联动用）
    const selectedTokenSet = new Set(accessTokens);
    const baseAccountsList = accounts.filter((a) => !selectedTokenSet.has(a.access_token));
    const baseActive = baseAccountsList.filter((a) => a.status === "正常").length;
    const baseLimited = baseAccountsList.filter((a) => a.status === "限流").length;
    const baseAbnormal = baseAccountsList.filter((a) => a.status === "异常").length;
    const baseDisabled = baseAccountsList.filter((a) => a.status === "禁用").length;
    const baseNormalAccounts = baseAccountsList.filter((a) => a.status === "正常");
    const baseQuotaNum = baseNormalAccounts.reduce((s, a) => s + Math.max(0, a.quota), 0);

    // 显示进度条（只显示当前任务，不含分类统计）
    const total = accessTokens.length;
    setProgress({
      visible: true,
      current: 0,
      total,
      message: "正在刷新账号信息...",
      email: "",
    });

    try {
      const { progress_id } = await refreshAccounts(allAccounts ? [] : accessTokens);

      // 轮询进度到完成
      const data = await new Promise<AccountRefreshResponse>((resolve, reject) => {
        let pollInFlight = false;
        const pollTimer = setInterval(async () => {
          if (pollInFlight) return;
          pollInFlight = true;
          try {
            const p = await fetchRefreshProgress(progress_id);
            if (!mountedRef.current) return;
            if (p.done) {
              stopPoll(pollTimer);
              if (p.error) {
                reject(new Error(p.error));
                return;
              }
              if (!p.result) {
                reject(new Error("刷新结果为空"));
                return;
              }
              // 更新最终进度显示
              setProgress((prev) => ({
                ...prev,
                current: prev.total,
                message: "刷新完成",
              }));
              // 清除联动统计
              setRefreshSummary(null);
              resolve(p.result);
            } else {
              // 实时更新进度
              setProgress((prev) => ({
                ...prev,
                current: p.processed,
                message: p.accounts_per_second ? `正在刷新账号信息 · ${p.accounts_per_second.toFixed(1)} 个/秒 · 预计剩余 ${Math.ceil((p.estimated_remaining_seconds ?? 0) / 60)} 分钟` : "正在刷新账号信息...",
              }));
              // 实时更新统计卡片：基数 + 已刷新的累加结果
              const runningActive = baseActive + ((p.status_counts?.["正常"]) ?? 0);
              const runningLimited = baseLimited + ((p.status_counts?.["限流"]) ?? 0);
              const runningAbnormal = baseAbnormal + ((p.status_counts?.["异常"]) ?? 0);
              const runningDisabled = baseDisabled + ((p.status_counts?.["禁用"]) ?? 0);
              setRefreshSummary({
                total: accounts.length,
                active: runningActive,
                limited: runningLimited,
                abnormal: runningAbnormal,
                disabled: runningDisabled,
                quota: formatCompact(baseQuotaNum + (p.total_quota ?? 0)),
              });
            }
          } catch (err) {
            stopPoll(pollTimer);
            reject(err);
          } finally {
            pollInFlight = false;
          }
        }, 1000);
        pollTimersRef.current.add(pollTimer);
      });

      // 刷新完成，更新数据
      void loadAccounts(page, true);

      const relogined = data.relogined ?? 0;

      // 显示重新登录进度
      if (relogined > 0) {
        setProgress({
          visible: true,
          current: 0,
          total: relogined,
          message: `正在尝试对 ${relogined} 个账号进行移除异常状态`,
          email: "",
        });
        // 模拟重新登录进度
        let reCount = 0;
        await new Promise<void>((resolve) => {
          const timer = setInterval(() => {
            reCount += 1;
            if (reCount >= relogined) {
              clearInterval(timer);
              setProgress({
                visible: true,
                current: relogined,
                total: relogined,
                message: "移除异常状态完成",
                email: "",
              });
              setTimeout(() => setProgress({ visible: false, current: 0, total: 0, message: "", email: "" }), 800);
              resolve();
            } else {
              setProgress((prev) => ({ ...prev, current: reCount }));
            }
          }, 150);
          setTimeout(resolve, 2000);
        });
      } else {
        setProgress({
          visible: true,
          current: total,
          total,
          message: "刷新完成",
          email: "",
        });
        setTimeout(() => setProgress({ visible: false, current: 0, total: 0, message: "", email: "" }), 800);
      }

      if ((data.errors ?? []).length > 0) {
        const firstError = data.errors?.[0]?.error;
        toast.error(
          `刷新成功 ${data.refreshed} 个，失败 ${(data.errors ?? []).length} 个${firstError ? `，首个错误：${firstError}` : ""}`,
        );
      } else {
        toast.success(`刷新成功 ${data.refreshed} 个账户${data.reused ? `（复用 ${data.reused} 个近期或进行中的结果）` : ""}${relogined > 0 ? `，已触发 ${relogined} 个账号重新登录` : ""}`);
      }
    } catch (error) {
      setProgress({ visible: false, current: 0, total: 0, message: "", email: "" });
      setRefreshSummary(null);
      const message = error instanceof Error ? error.message : "刷新账户失败";
      toast.error(message);
    } finally {
      setIsRefreshing(false);
    }
  };

  const pollRefreshProgress = async (
    progressId: string,
    onUpdate: (p: RefreshProgressResponse) => void,
  ): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      let pollInFlight = false;
      const timer = setInterval(async () => {
        if (pollInFlight) return;
        pollInFlight = true;
        try {
          const p = await fetchRefreshProgress(progressId);
          if (!mountedRef.current) return;
          if (p.done) {
            stopPoll(timer);
            if (p.error) {
              reject(new Error(p.error));
            } else {
              onUpdate(p);
              resolve();
            }
          }
        } catch (err) {
          stopPoll(timer);
          reject(err);
        } finally {
          pollInFlight = false;
        }
      }, 1000);
      pollTimersRef.current.add(timer);
    });
  };

  const handleReLogin = async (accessTokens: string[]) => {
    if (accessTokens.length === 0) {
      toast.error("请先选择要恢复的账户");
      return;
    }

    // 只处理异常账号，过滤非异常账号
    const abnormalTokens = accessTokens.filter((token) => {
      const account = accounts.find((a) => a.access_token === token);
      return account?.status === "异常";
    });

    if (abnormalTokens.length === 0) {
      toast.error("选中账号中没有异常账号");
      return;
    }

    if (abnormalTokens.length < accessTokens.length) {
      toast.info(`已过滤 ${accessTokens.length - abnormalTokens.length} 个非异常账号`);
    }

    setIsRelogining(true);

    // 计算非选中账号的基数（统计卡片联动用）
    const selectedTokenSet = new Set(abnormalTokens);
    const baseAccountsList = accounts.filter((a) => !selectedTokenSet.has(a.access_token));
    const baseActive = baseAccountsList.filter((a) => a.status === "正常").length;
    const baseLimited = baseAccountsList.filter((a) => a.status === "限流").length;
    const baseAbnormal = baseAccountsList.filter((a) => a.status === "异常").length;
    const baseDisabled = baseAccountsList.filter((a) => a.status === "禁用").length;

    // 显示进度条（真实进度）
    const total = abnormalTokens.length;
    setProgress({ visible: true, current: 0, total, message: "正在尝试恢复异常账号...", email: "" });

    try {
      const { progress_id } = await reLoginAccounts(abnormalTokens);

      // 轮询进度到完成
      await new Promise<void>((resolve, reject) => {
        let pollInFlight = false;
        const pollTimer = setInterval(async () => {
          if (pollInFlight) return;
          pollInFlight = true;
          try {
            const p = await fetchReLoginProgress(progress_id);
            if (!mountedRef.current) return;
            if (p.done) {
              stopPoll(pollTimer);
              if (p.error) {
                reject(new Error(p.error));
                return;
              }
              setProgress((prev) => ({ ...prev, current: prev.total, message: "恢复流程已完成" }));
              setRefreshSummary(null);
              resolve();
            } else {
              // 实时更新进度
              const results = p.results ?? [];
              // 找到最新一条有错误的结果
              const lastErrorResult = [...results].reverse().find((r) => r.error);
              const emailHint = lastErrorResult
                ? `失败: ${lastErrorResult.token} ${lastErrorResult.error ?? ""}`
                : `已处理 ${p.processed}/${p.total}`;
              setProgress((prev) => ({
                ...prev,
                current: p.processed,
                email: emailHint,
                message: "正在尝试恢复异常账号...",
              }));

              // 实时更新统计卡片：基数 + 已处理的恢复结果
              let runningActive = baseActive;
              let runningAbnormal = baseAbnormal;
              let runningDisabled = baseDisabled;
              for (const r of results) {
                if (r.status === "成功") {
                  runningActive += 1;
                  runningAbnormal -= 1;
                } else if (r.status === "禁用") {
                  runningDisabled += 1;
                  runningAbnormal -= 1;
                }
                // "异常"或"跳过"：保持异常状态不变
              }
              setRefreshSummary({
                total: accounts.length,
                active: runningActive,
                limited: baseLimited,
                abnormal: runningAbnormal,
                disabled: runningDisabled,
                quota: summary.quota,
              });
            }
          } catch (err) {
            stopPoll(pollTimer);
            reject(err);
          } finally {
            pollInFlight = false;
          }
        }, 1000);
        pollTimersRef.current.add(pollTimer);
      });

      // 等待后台线程完成，再拉取最新数据
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      try {
        void loadAccounts(page, true);
      } catch { /* 静默失败 */ }

      setProgress({
        visible: true,
        current: total,
        total,
        message: "恢复完成",
        email: "",
      });
      setTimeout(() => setProgress({ visible: false, current: 0, total: 0, message: "", email: "" }), 800);

      toast.success(`恢复流程已全部完成`);
    } catch (error) {
      setProgress({ visible: false, current: 0, total: 0, message: "", email: "" });
      setRefreshSummary(null);
      const message = error instanceof Error ? error.message : "重新登录失败";
      toast.error(message);
    } finally {
      setIsRelogining(false);
    }
  };

  const openEditDialog = (account: Account) => {
    setEditingAccount(account);
    setEditStatus(account.status);
    setEditProxy(account.proxy ?? "");
  };

  const handleTestAccountProxy = async () => {
    const candidate = editProxy.trim();
    if (!candidate) {
      toast.error("请先填写代理地址");
      return;
    }
    setIsTestingProxy(true);
    try {
      const data = await testProxy(candidate);
      data.result.ok
        ? toast.success(`代理可用（${data.result.latency_ms} ms，HTTP ${data.result.status}）`)
        : toast.error(`代理不可用：${data.result.error ?? "未知错误"}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "测试代理失败");
    } finally {
      setIsTestingProxy(false);
    }
  };

  const handleUpdateAccount = async () => {
    if (!editingAccount) {
      return;
    }

    setIsUpdating(true);
    try {
      const data = await updateAccount(editingAccount.access_token, {
        status: editStatus,
        proxy: editProxy.trim(),
      });
      if (data.item) {
        setAccounts((prev) => prev.map((a) => (a.access_token === data.item.access_token ? { ...a, ...data.item } : a)));
      } else {
        void loadAccounts(page, true);
      }
      setEditingAccount(null);
      toast.success("账号信息已更新");
    } catch (error) {
      const message = error instanceof Error ? error.message : "更新账号失败";
      toast.error(message);
    } finally {
      setIsUpdating(false);
    }
  };

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...currentRows.map((item) => item.access_token)])));
      return;
    }
    setSelectedIds((prev) => prev.filter((id) => !currentRows.some((row) => row.access_token === id)));
  };

  return (
    <div className="space-y-5 pt-5">
      <h1 className="sr-only">号池管理</h1>
      <section aria-label="号池操作" className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          className="page-toolbar-control rounded-[10px] border-border bg-card px-4 text-foreground shadow-none"
          onClick={() => void loadAccounts()}
          disabled={isLoading || isRefreshing || isDeleting}
        >
          <RefreshCw className={cn("size-4", isLoading ? "animate-spin" : "")} />
          刷新
        </Button>
        <Button
          variant="outline"
          className="page-toolbar-control rounded-[10px] border-border bg-card px-4 text-foreground shadow-none"
          onClick={() => void handleRefreshAccounts([], true)}
          disabled={isLoading || isRefreshing || isDeleting || totalFilteredAccounts === 0}
          title="刷新所有账号信息和额度"
        >
          <RefreshCw className={cn("size-4", isRefreshing ? "animate-spin" : "")} />
          刷新全部账号
        </Button>
        <AccountImportDialog
          disabled={isLoading || isRefreshing || isDeleting}
          onImported={() => {
            void loadAccounts(1);
            setSelectedIds([]);
            setPage(1);
          }}
        />
        <Button
          variant="outline"
          className="page-toolbar-control rounded-[10px] border-border bg-card px-4 text-foreground shadow-none"
          onClick={() => void handleExportAll()}
          disabled={isExportingAll || totalFilteredAccounts === 0}
        >
          <Download className={cn("size-4", isExportingAll ? "animate-spin" : "")} />
          {isExportingAll ? "正在导出..." : "导出全部 Token"}
        </Button>
      </section>

      {/* 进度条 */}
      {progress.visible && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="px-4 py-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-stone-600">
                {progress.message}
                {progress.email && <span className="ml-1 font-medium text-stone-700">{progress.email}</span>}
              </span>
              <span className="font-medium text-stone-700">
                {progress.current}/{progress.total}
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-stone-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-300 ease-out"
                style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>
      )}

      <Dialog open={Boolean(editingAccount)} onOpenChange={(open) => (!open ? setEditingAccount(null) : null)}>
        <DialogContent showCloseButton={false} className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>编辑账户</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              手动修改账号状态和专属代理。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">状态</label>
              <Select value={editStatus} onValueChange={(value) => setEditStatus(value as AccountStatus)}>
                <SelectTrigger className="h-11 rounded-xl border-stone-200 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accountStatusOptions
                    .filter((option) => option.value !== "all")
                    .map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">账号代理</label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={editProxy}
                  onChange={(event) => setEditProxy(event.target.value)}
                  placeholder="留空走全局代理，例如 http://127.0.0.1:7890"
                  className="h-11 rounded-xl border-stone-200 bg-white"
                />
                <Button
                  variant="outline"
                  className="h-11 rounded-xl border-stone-200 bg-white px-4 text-stone-700 sm:w-24"
                  onClick={() => void handleTestAccountProxy()}
                  disabled={isTestingProxy}
                >
                  {isTestingProxy ? <LoaderCircle className="size-4 animate-spin" /> : <Link2 className="size-4" />}
                  测试
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button
              variant="secondary"
              className="h-10 rounded-xl bg-stone-100 px-5 text-stone-700 hover:bg-stone-200"
              onClick={() => setEditingAccount(null)}
              disabled={isUpdating}
            >
              取消
            </Button>
            <Button
              className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800"
              onClick={() => void handleUpdateAccount()}
              disabled={isUpdating}
            >
              {isUpdating ? <LoaderCircle className="size-4 animate-spin" /> : null}
              保存修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <section className="space-y-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {metricCards.map((item) => {
            const Icon = item.icon;
            const value = (refreshSummary ?? summary)[item.key];
            return (
              <Card key={item.key} className="rounded-xl border-border bg-card shadow-none">
                <CardContent className="p-3 sm:p-4">
                  <div className="mb-2 flex items-start justify-between gap-1 sm:mb-4">
                    <span className="text-xs font-medium text-stone-400">{item.label}</span>
                    <Icon className="size-4 shrink-0 text-stone-400" />
                  </div>
                  <div className={cn("text-[1.75rem] font-semibold tracking-tight", item.color)}>
                    <span className={typeof value === "number" ? "" : "text-[1.1rem]"}>
                      {typeof value === "number" ? formatCompact(value) : value}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
        <Card className="rounded-xl border-border bg-card shadow-none">
          <CardContent className="p-4">
            <div className="mb-3 text-sm font-medium text-stone-700">
              系统可用模型
              <span className="ml-1 text-stone-400">({availableModels.length})</span>
            </div>
            <p className="mb-3 text-xs leading-5 text-stone-500">
              这里显示当前账号池模型目录中的模型标识。能看到模型不代表每个账号都有额度，实际请求仍会按账号状态和上游可用性执行。
            </p>
            <div className="flex flex-wrap gap-2">
              {availableModels.length > 0 ? (
                availableModels.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    className="inline-flex cursor-pointer items-center rounded-full border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 transition hover:border-stone-300 hover:bg-stone-50"
                    onClick={() => {
                      void navigator.clipboard.writeText(model.id);
                      toast.success("模型名已复制");
                    }}
                    title={`点击复制 ${model.id}`}
                  >
                    <img
                      src="/openai.svg"
                      alt=""
                      aria-hidden="true"
                      className="mr-1.5 size-3.5 shrink-0"
                    />
                    {model.id}
                  </button>
                ))
              ) : isLoadingModels ? (
                <span className="text-sm text-stone-400">正在加载模型列表...</span>
              ) : modelLoadError ? (
                <div className="flex items-center gap-2 text-sm text-stone-400">
                  <span>模型列表加载失败，请重试</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => void loadModels()}>
                    重试
                  </Button>
                </div>
              ) : (
                <span className="text-sm text-stone-400">当前暂无可用模型</span>
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold tracking-tight">账户列表</h2>
            <Badge variant="secondary" className="rounded-lg bg-stone-200 px-2 py-0.5 text-stone-700">
              {totalFilteredAccounts}
            </Badge>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-[240px]">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                aria-label="搜索邮箱"
                placeholder="搜索邮箱"
                className="page-toolbar-control rounded-[10px] border-border bg-card pl-10 shadow-none"
              />
            </div>
            <Select
              value={typeFilter}
              onValueChange={(value) => {
                setTypeFilter(value);
                setPage(1);
              }}
            >
              <SelectTrigger className="page-toolbar-control w-full rounded-[10px] border-border bg-card shadow-none sm:w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {accountTypeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(value as AccountStatus | "all");
                setPage(1);
              }}
            >
              <SelectTrigger className="page-toolbar-control w-full rounded-[10px] border-border bg-card shadow-none sm:w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {accountStatusOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading && accounts.length === 0 ? (
          <Card className="rounded-xl border-border bg-card shadow-none">
            <CardContent className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
              <div className="rounded-xl bg-stone-100 p-3 text-stone-500">
                <LoaderCircle className="size-5 animate-spin" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-stone-700">正在加载账户</p>
                <p className="text-sm text-stone-500">从后端同步账号列表和状态。</p>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card
          className={cn(
            "overflow-hidden rounded-xl border-border bg-card shadow-none",
            isLoading && accounts.length === 0 ? "hidden" : "",
          )}
        >
          <CardContent className="space-y-0 p-0">
            <div className="flex flex-col gap-3 border-b border-stone-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2 text-sm text-stone-500">
                <Button
                  variant="ghost"
                  className="h-8 rounded-lg px-3 text-stone-500 hover:bg-stone-100"
                  onClick={() => void handleRefreshAccounts(selectedTokens)}
                  disabled={selectedTokens.length === 0 || isRefreshing}
                >
                  {isRefreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  刷新选中账号信息和额度
                </Button>
                <Button
                  variant="ghost"
                  className="h-8 rounded-lg px-3 text-amber-600 hover:bg-amber-50 hover:text-amber-700"
                  onClick={() => void handleReLogin(selectedTokens)}
                  disabled={selectedTokens.length === 0 || isRelogining}
                  title="尝试密码登录恢复账号"
                >
                  {isRelogining ? <LoaderCircle className="size-4 animate-spin" /> : <LogIn className="size-4" />}
                  尝试恢复异常账号
                </Button>
                <Button
                  variant="ghost"
                  className="h-8 rounded-lg px-3 text-rose-500 hover:bg-rose-50 hover:text-rose-600"
                  onClick={() => void handleRemoveAllAbnormal()}
                  disabled={(statusCounts["异常"] || 0) === 0 || isDeleting}
                >
                  {isDeleting ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  移除全部异常账号{(statusCounts["异常"] || 0) > 0 ? `(${statusCounts["异常"]})` : ""}
                </Button>
                <Button
                  variant="ghost"
                  className="h-8 rounded-lg px-3 text-rose-500 hover:bg-rose-50 hover:text-rose-600"
                  onClick={() => void handleDeleteTokens(selectedTokens)}
                  disabled={selectedTokens.length === 0 || isDeleting}
                >
                  {isDeleting ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  删除所选
                </Button>
                {selectedIds.length > 0 ? (
                  <span className="rounded-lg bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-600">
                    已选择 {selectedIds.length} 项
                  </span>
                ) : null}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1280px] table-fixed text-left">
                <thead className="whitespace-nowrap border-b border-stone-100 text-[11px] text-stone-400 uppercase tracking-[0.18em]">
                  <tr>
                    <th className="w-10 px-3 py-3">
                      <Checkbox
                        checked={allCurrentSelected}
                        onCheckedChange={(checked) => toggleSelectAll(Boolean(checked))}
                      />
                    </th>
                    <th className="w-48 px-3 py-3">token</th>
                    <th className="w-[68px] px-3 py-3">类型</th>
                    <th className="w-20 px-3 py-3">来源</th>
                    <th className="w-20 px-3 py-3">状态</th>
                    <th className="w-36 px-3 py-3">账号信息</th>
                    <th className="w-[100px] px-3 py-3">创建时间</th>
                    <th className="w-16 px-3 py-3">额度</th>
                    <th className="w-[124px] px-3 py-3">恢复时间</th>
                    <th className="w-14 px-3 py-3">在途</th>
                    <th className="w-14 px-3 py-3">成功</th>
                    <th className="w-14 px-3 py-3">失败</th>
                    <th className="w-[104px] px-3 py-3">最近调用</th>
                    <th className="w-[116px] px-3 py-3">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {currentRows.map((account) => {
                    const status = (account && statusMeta[account.status]) || {
                      icon: CircleAlert,
                      badge: "secondary" as const,
                    };
                    const StatusIcon = status.icon;

                    return (
                      <tr
                        key={account.access_token}
                        className="border-b border-stone-100/80 text-sm text-stone-600 transition-colors hover:bg-stone-50/70"
                      >
                        <td className="px-3 py-3">
                          <Checkbox
                            checked={selectedIds.includes(account.access_token)}
                            onCheckedChange={(checked) => {
                              setSelectedIds((prev) =>
                                checked
                                  ? Array.from(new Set([...prev, account.access_token]))
                                  : prev.filter((item) => item !== account.access_token),
                              );
                            }}
                          />
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <span
                              className="truncate font-medium tracking-tight text-stone-700"
                              title={maskToken(account.access_token)}
                            >
                              {maskToken(account.access_token)}
                            </span>
                            <button
                              type="button"
                              className="rounded-lg p-1 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
                              onClick={() => {
                                void navigator.clipboard.writeText(account.access_token);
                                toast.success("token 已复制");
                              }}
                            >
                              <Copy className="size-4" />
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <Badge variant="secondary" className="rounded-md bg-stone-100 text-stone-700">
                            {displayAccountType(account)}
                          </Badge>
                        </td>
                        <td className="px-3 py-3">
                          <Badge variant="outline" className="rounded-md border-stone-200 text-stone-600">
                            {displayAccountSource(account)}
                          </Badge>
                        </td>
                        <td className="px-3 py-3">
                          <Badge
                            variant={status.badge}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1"
                          >
                            <StatusIcon className="size-3.5" />
                            {account.status}
                          </Badge>
                        </td>
                        <td className="px-3 py-3">
                          <div className="truncate text-xs leading-5 text-stone-500" title={account.email ?? undefined}>
                            {account.email ?? "—"}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-xs leading-5 text-stone-500">
                          {(() => {
                            const raw = (account as any).created_at;
                            if (!raw) return "—";
                            try {
                              const d = new Date(raw + "Z");
                              if (isNaN(d.getTime())) return String(raw).slice(0, 10);
                              return d.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
                            } catch { return String(raw).slice(0, 10); }
                          })()}
                        </td>
                        <td className="px-3 py-3">
                          <Badge variant="info" className="rounded-md">
                            {formatQuota(account)}
                          </Badge>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-xs leading-5 text-stone-500">
                          {(() => {
                            const restore = formatRestoreAt(account.restore_at);
                            return (
                              <div className="space-y-0.5">
                                {restore.relative ? <div className="font-medium text-stone-700">{restore.relative}</div> : null}
                                <div className="text-stone-400">{restore.absolute}</div>
                              </div>
                            );
                          })()}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          {(() => {
                            const inflight = account.image_inflight ?? 0;
                            return (
                              <span
                                className={
                                  inflight > 0
                                    ? "font-semibold text-amber-600"
                                    : "text-stone-400"
                                }
                                title={
                                  inflight > 0
                                    ? "当前正在生成的图片数。号池空闲时此值持续 > 0，说明并发槽位泄漏、该账号已被静默排除出调度"
                                    : "当前无在途生图任务"
                                }
                              >
                                {inflight}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-stone-500">{account.success}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-stone-500">{account.fail}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-xs leading-5 text-stone-500">
                          {(() => {
                            const used = formatLastUsedAt(account.last_used_at);
                            if (!used.relative) {
                              return (
                                <span className="whitespace-nowrap text-stone-300" title="该账号还没有被调用过">
                                  未调用
                                </span>
                              );
                            }
                            return (
                              <div className="space-y-0.5" title={`最近一次调用：${account.last_used_at}`}>
                                <div className={used.fresh ? "font-medium text-emerald-600" : "font-medium text-stone-700"}>
                                  {used.relative}
                                </div>
                                <div className="text-stone-400">{used.absolute}</div>
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1 text-stone-400">
                            <button
                              type="button"
                              className="rounded-lg p-1.5 transition hover:bg-stone-100 hover:text-stone-700"
                              onClick={() => openEditDialog(account)}
                              disabled={isUpdating}
                            >
                              <Pencil className="size-4" />
                            </button>
                            <button
                              type="button"
                              className="rounded-lg p-1.5 transition hover:bg-stone-100 hover:text-stone-700"
                              onClick={() => void handleRefreshAccounts([account.access_token])}
                              disabled={isRefreshing || refreshingTokens.has(account.access_token)}
                            >
                              <RefreshCw className={cn("size-4", (isRefreshing || refreshingTokens.has(account.access_token)) ? "animate-spin" : "")} />
                            </button>
                            <button
                              type="button"
                              className="rounded-lg p-1.5 transition hover:bg-rose-50 hover:text-rose-500"
                              onClick={() => void handleDeleteTokens([account.access_token])}
                              disabled={isDeleting}
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {!isLoading && currentRows.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
                  <div className="rounded-xl bg-stone-100 p-3 text-stone-500">
                    <Search className="size-5" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-stone-700">没有匹配的账户</p>
                    <p className="text-sm text-stone-500">调整筛选条件或搜索关键字后重试。</p>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="border-t border-stone-100 px-4 py-4">
              <div className="flex items-center justify-center gap-3 overflow-x-auto whitespace-nowrap">
                <div className="shrink-0 text-sm text-stone-500">
                显示第 {totalFilteredAccounts === 0 ? 0 : startIndex + 1} -{" "}
                {Math.min(startIndex + Number(pageSize), totalFilteredAccounts)} 条，共{" "}
                {totalFilteredAccounts} 条
                </div>

                <span className="shrink-0 text-sm leading-none text-stone-500">
                  {safePage} / {pageCount} 页
                </span>
                <Select
                  value={pageSize}
                  onValueChange={(value) => {
                    setPageSize(value);
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="h-10 w-[108px] shrink-0 rounded-lg border-stone-200 bg-white text-sm leading-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10 / 页</SelectItem>
                    <SelectItem value="20">20 / 页</SelectItem>
                    <SelectItem value="50">50 / 页</SelectItem>
                    <SelectItem value="100">100 / 页</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-10 shrink-0 rounded-lg border-stone-200 bg-white"
                  disabled={safePage <= 1}
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                {paginationItems.map((item, index) =>
                  item === "..." ? (
                    <span key={`ellipsis-${index}`} className="px-1 text-sm text-stone-400">
                      ...
                    </span>
                  ) : (
                    <Button
                      key={item}
                      variant={item === safePage ? "default" : "outline"}
                      className={cn(
                        "h-10 min-w-10 shrink-0 rounded-lg px-3",
                        item === safePage
                          ? "bg-stone-950 text-white hover:bg-stone-800"
                          : "border-stone-200 bg-white text-stone-700",
                      )}
                      onClick={() => setPage(item)}
                    >
                      {item}
                    </Button>
                  ),
                )}
                <Button
                  variant="outline"
                  size="icon"
                  className="size-10 shrink-0 rounded-lg border-stone-200 bg-white"
                  disabled={safePage >= pageCount}
                  onClick={() => setPage((prev) => Math.min(pageCount, prev + 1))}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

export default function AccountsPage() {
  const { isCheckingAuth, session } = useAuthGuard(["admin"]);

  if (isCheckingAuth || !session || session.role !== "admin") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return <AccountsPageContent />;
}
