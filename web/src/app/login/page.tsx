"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { HeaderActions } from "@/components/header-actions";
import { login } from "@/lib/api";
import { useRedirectIfAuthenticated } from "@/lib/use-auth-guard";
import { getDefaultRouteForRole, setStoredAuthSession } from "@/store/auth";
import { FishLogo } from "@/components/fish-logo";

export default function LoginPage() {
  const router = useRouter();
  const [authKey, setAuthKey] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { isCheckingAuth } = useRedirectIfAuthenticated();

  const handleLogin = async () => {
    const normalizedAuthKey = authKey.trim();
    if (!normalizedAuthKey) {
      toast.error("请输入 密钥");
      return;
    }

    setIsSubmitting(true);
    try {
      const data = await login(normalizedAuthKey);
      await setStoredAuthSession({
        key: normalizedAuthKey,
        role: data.role,
        subjectId: data.subject_id,
        name: data.name,
      });
      router.replace(getDefaultRouteForRole(data.role));
    } catch (error) {
      const message = error instanceof Error ? error.message : "登录失败";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isCheckingAuth) {
    return (
      <div className="grid min-h-[calc(100vh-1rem)] w-full place-items-center px-4 py-6">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="grid min-h-[calc(100vh-1rem)] w-full place-items-center px-4 py-6">
      <HeaderActions className="fixed top-4 right-4 z-10" />
      <Card className="w-full max-w-[505px] rounded-[30px] border-border bg-card shadow-[0_28px_90px_rgba(38,49,58,0.10)]">
        <CardContent className="space-y-7 p-6 sm:p-8">
          <div className="space-y-4 text-center">
            <FishLogo className="mx-auto h-16 w-24" animated />
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">欢迎回来</h1>
              <p className="text-sm leading-6 text-muted-foreground">输入密钥后继续使用账号管理和图片生成功能。</p>
            </div>
          </div>

          <div className="space-y-3">
            <label htmlFor="auth-key" className="block text-sm font-medium text-stone-700">
              密钥
            </label>
            <Input
              id="auth-key"
              type="password"
              value={authKey}
              onChange={(event) => setAuthKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleLogin();
                }
              }}
              placeholder="请输入密钥"
              className="h-13 rounded-2xl border-border bg-background px-4"
            />
          </div>

          <Button
            className="h-13 w-full rounded-2xl bg-[var(--brand-gold)] text-[var(--brand-on-gold)] hover:bg-[var(--brand-gold-hover)]"
            onClick={() => void handleLogin()}
            disabled={isSubmitting}
          >
            {isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
            登录
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
