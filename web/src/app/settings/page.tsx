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
import { Sub2APIConnections } from "./components/sub2api-connections";
import { ThirdPartyAppsCard } from "./components/third-party-apps-card";
import { UserKeysCard } from "./components/user-keys-card";
import { useSettingsStore } from "./store";

const settingsTabs = [
  { value: "basic", title: "基础配置" },
  { value: "gallery", title: "画廊与Agent" },
  { value: "backup", title: "备份" },
  { value: "keys", title: "用户密钥" },
  { value: "api-docs", title: "接口接入" },
  { value: "canvas", title: "画布入口" },
  { value: "proxy", title: "FlareSolverr" },
  { value: "cpa", title: "CPA" },
  { value: "sub2api", title: "Sub2API" },
];

const userSettingsTabs = [
  { value: "account", title: "账号与密钥" },
  { value: "gallery", title: "画廊与Agent" },
  { value: "api-docs", title: "接口接入" },
];

function SettingsDataController() {
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
  }, [loadPools, pools]);

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

function AdminSettingsPageContent() {
  return (
    <>
      <SettingsDataController />
      <SettingsHeader />
      <Tabs defaultValue="basic" className="space-y-4">
        <div className="sticky top-3 z-20 overflow-x-auto rounded-xl border border-white/80 bg-white/90 px-3 py-2 shadow-sm backdrop-blur">
          <TabsList variant="line" className="min-w-max justify-start">
            {settingsTabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="px-4">
                {tab.title}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="basic">
          <ConfigCard />
        </TabsContent>
        <TabsContent value="gallery">
          <GallerySettingsCard />
        </TabsContent>
        <TabsContent value="proxy">
          <ProxyRuntimeCard />
        </TabsContent>
        <TabsContent value="backup">
          <BackupSettingsCard />
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
        <TabsContent value="cpa">
          <CPAPoolsCard />
        </TabsContent>
        <TabsContent value="sub2api">
          <Sub2APIConnections />
        </TabsContent>
      </Tabs>
      <CPAPoolDialog />
      <ImportBrowserDialog />
    </>
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
    <>
      <SettingsHeader />
      <Tabs defaultValue="account" className="space-y-4">
        <div className="sticky top-3 z-20 overflow-x-auto rounded-xl border border-white/80 bg-white/90 px-3 py-2 shadow-sm backdrop-blur">
          <TabsList variant="line" className="min-w-max justify-start">
            {userSettingsTabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="px-4">
                {tab.title}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="account">
          <AccountSettingsCard session={session} onSessionChange={onSessionChange} />
        </TabsContent>
        <TabsContent value="gallery">
          <GallerySettingsCard showSharedProfiles={false} />
        </TabsContent>
        <TabsContent value="api-docs">
          <ApiDocsCard />
        </TabsContent>
      </Tabs>
    </>
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
        <LoaderCircle className="size-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (activeSession.role === "admin") {
    return <AdminSettingsPageContent />;
  }

  return <UserSettingsPageContent session={activeSession} onSessionChange={setActiveSession} />;
}
