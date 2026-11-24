"use client";

import { LoaderCircle } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuthGuard } from "@/lib/use-auth-guard";

import { PsdPanel } from "./components/psd-panel";
import { SkillPanel } from "./components/skill-panel";

const tabs = [
  { value: "skills", title: "搜索Skills" },
  { value: "psd", title: "PSD生成" },
];

export default function DebugPage() {
  const { isCheckingAuth, session } = useAuthGuard(["admin"]);

  if (isCheckingAuth || !session || session.role !== "admin") {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Tabs defaultValue="skills" className="flex w-full min-w-0 flex-col gap-5 pt-5">
      <div className="overflow-x-auto rounded-xl border border-border bg-card p-2">
        <TabsList variant="line" aria-label="调试分类" className="min-w-max justify-start">
          {tabs.map(({ value, title }) => (
            <TabsTrigger key={value} value={value} className="rounded-md px-3.5 data-[state=active]:font-semibold after:!bottom-0">
              {title}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent value="skills">
        <SkillPanel />
      </TabsContent>
      <TabsContent value="psd" className="min-h-0">
        <PsdPanel />
      </TabsContent>
    </Tabs>
  );
}
