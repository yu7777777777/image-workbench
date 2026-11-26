"use client";

import { lazy, Suspense, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuthGuard } from "@/lib/use-auth-guard";
import type { StoredAuthSession } from "@/store/auth";
import { AccountSettingsCard } from "./components/account-settings-card";
import { ApiDocsCard } from "./components/api-docs-card";
import { GallerySettingsCard } from "./components/gallery-settings-card";
import { SettingsHeader } from "./components/settings-header";
import { StandaloneChatSettingsCard } from "./components/standalone-chat-settings-card";

const AdminSettingsPageContent = lazy(() => import("./components/admin-settings-page"));

const userSettingsTabs = [
  { value: "account", title: "账号与密钥" },
  { value: "workspace", title: "工作台" },
  { value: "chat", title: "独立对话" },
  { value: "api-docs", title: "接口接入" },
];

function UserSettingsPageContent({ initialSession }: { initialSession: StoredAuthSession }) {
  const [session, setSession] = useState(initialSession);
  return (
    <div className="min-w-0 pt-5">
      <SettingsHeader />
      <Tabs defaultValue="account" className="gap-5">
        <div className="hide-scrollbar sticky top-[calc(48px+env(safe-area-inset-top))] z-20 overflow-x-auto rounded-xl border border-border bg-card p-1.5 sm:top-0 sm:p-2">
          <TabsList variant="line" aria-label="设置分类" className="grid w-full grid-cols-4 gap-1 sm:flex sm:w-auto sm:min-w-max sm:justify-start">
            {userSettingsTabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="rounded-md px-1.5 text-xs data-[state=active]:font-semibold after:!bottom-0 sm:px-3.5 sm:text-sm">
                {tab.title}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="account">
          <AccountSettingsCard session={session} onSessionChange={setSession} />
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

function SettingsLoading() {
  return (
    <div role="status" className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-muted-foreground">
      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
      正在加载设置…
    </div>
  );
}

export default function SettingsPage() {
  const { session } = useAuthGuard();

  if (!session) return <SettingsLoading />;

  if (session.role === "admin") {
    return (
      <Suspense fallback={<SettingsLoading />}>
        <AdminSettingsPageContent owner={`${session.role}:${session.subjectId}`} />
      </Suspense>
    );
  }

  return <UserSettingsPageContent key={session.subjectId} initialSession={session} />;
}
