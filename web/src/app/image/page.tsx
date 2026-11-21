"use client";

import { useAuthGuard } from "@/lib/use-auth-guard";

export default function ImagePage() {
  const { isCheckingAuth, session } = useAuthGuard();

  if (isCheckingAuth || !session) {
    return <p className="p-8 text-sm text-zinc-500">正在验证登录…</p>;
  }

  return null;
}
