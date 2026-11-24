"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuthGuard } from "@/lib/use-auth-guard";
import type { StoredAuthSession } from "@/store/auth";

import { AccountSettingsCard } from "./components/account-settings-card";
import { BackupSettingsCard } from "./components/backup-settings-card";
import { ApiDocsCard } from "./components/api-docs-card";
import { ConfigCard } from "./components/config-card";
import { CPAPoolDialog } from "./components/cpa-pool-dialog";
import { CPAPoolsCard } from "./components/cpa-pools-card";
import { GallerySettingsCard } from "./components/gallery-settings-card";
import { ImportBrowserDialog } from "./components/import-browser-dialog";
import { ProxyRuntimeCard } from "./components/proxy-runtime-card";
import { SettingsHeader } from "./components/settings-header";
import { StandaloneChatSettingsCard } from "./components/standalone-chat-settings-card";
import { Sub2APIConnections } from "./components/sub2api-connections";
import { ThirdPartyAppsCard } from "./components/third-party-apps-card";
import { UserKeysCard } from "./components/user-keys-card";
import { useSettingsStore } from "./store";

const settingsTabs = [
  { value: "basic", title: "基础与模型" },
  { value: "workspace", title: "工作台" },
  { value: "chat", title: "独立对话" },
  { value: "keys", title: "用户与密钥" },
  { value: "api-docs", title: "接口接入" },
  { value: "system", title: "系统维护" },
  { value: "network", title: "网络与代理" },
  { value: "canvas", title: "扩展入口" },
];

const userSettingsTabs = [
  { value: "account", title: "账号与密钥" },
  { value: "workspace", title: "工作台" },
  { value: "chat", title: "独立对话" },
  { value: "api-docs", title: "接口接入" },
];

function SettingsDataController({ loadAccountSources }: { loadAccountSources: boolean }) {
  const didLoadRef = useRef(false);
  const initialize = useSettingsStore((state) => state.initialize);
  const loadPools = useSettingsStore((state) => state.loadPools);
  const loadBackups = useSettingsStore((state) => state.loadBackups);
  const pools = useSettingsStore((state) => state.pools);
  const backupState = useSettingsStore((state) => state.backupState);

  useEffect(() => {
    if (didLoadRef.current) {
      return;
    }
    didLoadRef.current = true;
    void initialize();
  }, [initialize]);

  useEffect(() => {
    if (!loadAccountSources) {
      return;
    }
    void loadPools();
  }, [loadAccountSources, loadPools]);

  useEffect(() => {
    const hasRunningJobs = pools.some((pool) => {
      const status = pool.import_job?.status;
      return status === "pending" || status === "running";
    });
    if (!hasRunningJobs) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadPools(true);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [loadAccountSources, loadPools, pools]);

  useEffect(() => {
    if (!backupState?.running) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadBackups(true);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [backupState?.running, loadBackups]);

  return null;
}

function AdminSettingsPageContent({ owner }: { owner: string }) {
  const [advancedSourcesOpen, setAdvancedSourcesOpen] = useState(false);
  return (
    <div className="min-w-0 pt-5">
      <SettingsDataController loadAccountSources={advancedSourcesOpen} />
      <SettingsHeader />
      <Tabs defaultValue="basic" className="gap-5">
        <div className="sticky top-0 z-20 overflow-x-auto rounded-xl border border-border bg-card p-2">
          <TabsList variant="line" aria-label="设置分类" className="min-w-max justify-start">
            {settingsTabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="rounded-md px-3.5 data-[state=active]:font-semibold after:!bottom-0">
                {tab.title}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="basic">
          <ConfigCard />
        </TabsContent>
        <TabsContent value="workspace">
          <GallerySettingsCard />
        </TabsContent>
        <TabsContent value="chat">
          <StandaloneChatSettingsCard owner={owner} />
        </TabsContent>
        <TabsContent value="system">
          <div className="space-y-5">
            <BackupSettingsCard />
            <details className="rounded-2xl border border-border bg-card px-5 py-4">
              <summary className="cursor-pointer text-sm font-semibold text-stone-800">
                高级账号来源
              </summary>
              <p className="mt-2 text-xs leading-6 text-stone-500">
                CPA 和 Sub2API 只在需要从外部账号服务导入账号时使用，默认收起。
              </p>
              <div className="mt-4">
                <button
                  type="button"
                  className="mb-4 rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs text-stone-700"
                  onClick={() => setAdvancedSourcesOpen((value) => !value)}
                >
                  {advancedSourcesOpen ? "收起账号来源" : "打开账号来源配置"}
                </button>
                {advancedSourcesOpen ? (
                  <div className="space-y-5">
                    <CPAPoolsCard />
                    <Sub2APIConnections />
                  </div>
                ) : null}
              </div>
            </details>
          </div>
        </TabsContent>
        <TabsContent value="keys">
          <UserKeysCard />
        </TabsContent>
        <TabsContent value="canvas">
          <ThirdPartyAppsCard />
        </TabsContent>
        <TabsContent value="api-docs">
          <ApiDocsCard />
        </TabsContent>
        <TabsContent value="network">
          <ProxyRuntimeCard />
        </TabsContent>
      </Tabs>
      <CPAPoolDialog />
      <ImportBrowserDialog />
    </div>
  );
}

function UserSettingsPageContent({
  session,
  onSessionChange,
}: {
  session: StoredAuthSession;
  onSessionChange: (session: StoredAuthSession) => void;
}) {
  return (
    <div className="min-w-0 pt-5">
      <SettingsHeader />
      <Tabs defaultValue="account" className="gap-5">
        <div className="sticky top-0 z-20 overflow-x-auto rounded-xl border border-border bg-card p-2">
          <TabsList variant="line" aria-label="设置分类" className="min-w-max justify-start">
            {userSettingsTabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="rounded-md px-3.5 data-[state=active]:font-semibold after:!bottom-0">
                {tab.title}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="account" className="max-w-6xl">
          <AccountSettingsCard session={session} onSessionChange={onSessionChange} />
        </TabsContent>
        <TabsContent value="workspace">
          <GallerySettingsCard showSharedProfiles={false} />
        </TabsContent>
        <TabsContent value="chat">
          <StandaloneChatSettingsCard owner={`${session.role}:${session.subjectId}`} />
        </TabsContent>
        <TabsContent value="api-docs">
          <ApiDocsCard />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function SettingsPage() {
  const { isCheckingAuth, session } = useAuthGuard();
  const [activeSession, setActiveSession] = useState<StoredAuthSession | null>(null);

  useEffect(() => {
    setActiveSession(session);
  }, [session]);

  if (isCheckingAuth || !activeSession) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  if (activeSession.role === "admin") {
    return <AdminSettingsPageContent owner={`${activeSession.role}:${activeSession.subjectId}`} />;
  }

  return <UserSettingsPageContent session={activeSession} onSessionChange={setActiveSession} />;
}
