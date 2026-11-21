"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ImageLegacyPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/image");
  }, [router]);

  return (
    <div className="flex flex-1 items-center justify-center p-8 text-sm text-zinc-500">
      正在跳转至生图画廊...
    </div>
  );
}
