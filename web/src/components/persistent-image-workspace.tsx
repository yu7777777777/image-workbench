"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getValidatedAuthSession } from "@/lib/auth-session";
import type { StoredAuthSession } from "@/store/auth";

function PersistentImageWorkspaceInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const normalizedPath = (pathname || "").replace(/\/$/, "");
  const isImageRoute = normalizedPath === "/image";
  const rawMode = searchParams.get("mode");
  const currentMode = rawMode === "agent" ? "agent" : rawMode === "canvas" ? "canvas" : "gallery";
  const creativeItemId = searchParams.get("creative");

  const [session, setSession] = useState<StoredAuthSession | null>(null);
  const [hasVisitedImage, setHasVisitedImage] = useState(isImageRoute);
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Sync session
  useEffect(() => {
    let active = true;
    const checkSession = async () => {
      if (normalizedPath === "/login") {
        if (active) {
          setSession(null);
          setHasVisitedImage(false);
          setReady(false);
        }
        return;
      }
      const stored = await getValidatedAuthSession();
      if (!active) return;
      setSession(stored);
      if (!stored) {
        setHasVisitedImage(false);
        setReady(false);
      }
    };
    void checkSession();
    return () => {
      active = false;
    };
  }, [normalizedPath]);

  useEffect(() => {
    if (isImageRoute) {
      setHasVisitedImage(true);
    }
  }, [isImageRoute]);

  // Sync mode to iframe whenever ready and mode changes
  useEffect(() => {
    if (ready && isImageRoute && frame.current?.contentWindow) {
      frame.current.contentWindow.postMessage(
        { type: "set-app-mode", mode: currentMode },
        window.location.origin
      );
    }
  }, [ready, isImageRoute, currentMode]);

  useEffect(() => {
    const target = frame.current?.contentWindow;
    if (!ready || !isImageRoute || !creativeItemId || session?.role !== "admin" || !target) return;
    const requestId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== target) return;
      if (event.data?.type !== "creative-item-finished" || event.data.requestId !== requestId) return;
      router.replace(`/image/?mode=${currentMode}`);
    };
    window.addEventListener("message", receive);
    target.postMessage({ type: "apply-creative-item", requestId, id: creativeItemId, mode: currentMode }, window.location.origin);
    return () => {
      window.removeEventListener("message", receive);
      target.postMessage({ type: "cancel-creative-item", requestId }, window.location.origin);
    };
  }, [ready, isImageRoute, creativeItemId, currentMode, session?.role, session?.subjectId, router]);

  // Sync theme (dark/light) to iframe
  useEffect(() => {
    const sendTheme = () => {
      if (!ready || !frame.current?.contentWindow) return;
      const isDark = document.documentElement.classList.contains("dark");
      frame.current.contentWindow.postMessage(
        { type: "theme-sync", theme: isDark ? "dark" : "light" },
        window.location.origin
      );
    };

    sendTheme();

    const observer = new MutationObserver(sendTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, [ready]);

  // Sync updates of shared models to the persistent playground iframe (e.g. admin just published one)
  useEffect(() => {
    if (!ready || !session || !frame.current?.contentWindow) {
      return;
    }
    frame.current.contentWindow.postMessage(
      { type: "sync-shared-profiles" },
      window.location.origin
    );
  }, [ready, session]);

  // Handle postMessage handshake with playground iframe
  useEffect(() => {
    if (!session || !hasVisitedImage) return;
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== frame.current?.contentWindow
      ) {
        return;
      }
      if (event.data?.type === "account-pool-ready") {
        frame.current?.contentWindow?.postMessage(
          { type: "account-pool-session", key: session.key, owner: `${session.role}:${session.subjectId}` },
          window.location.origin
        );
      }
      if (event.data?.type === "account-pool-mounted") {
        setReady(true);
        setSlow(false);
        const isDark = document.documentElement.classList.contains("dark");
        frame.current?.contentWindow?.postMessage(
          { type: "theme-sync", theme: isDark ? "dark" : "light" },
          window.location.origin
        );
        frame.current?.contentWindow?.postMessage(
          { type: "set-app-mode", mode: currentMode },
          window.location.origin
        );
      }
      if (event.data?.type === "app-mode-sync" && isImageRoute && ready) {
        const incoming = event.data.mode === "agent" ? "agent" : event.data.mode === "canvas" ? "canvas" : "gallery";
        if (incoming !== currentMode) {
          router.replace(`/image/?mode=${incoming}`);
        }
      }
      if (event.data?.type === "open-settings" && isImageRoute) {
        router.push("/settings/");
      }
      if (event.data?.type === "open-creative-library" && isImageRoute && session.role === "admin") {
        router.push("/creative/");
      }
    };

    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [session, hasVisitedImage, currentMode, isImageRoute, ready, router]);

  const sessionKey = session?.key;
  const sessionOwner = session ? `${session.role}:${session.subjectId}` : "";
  const lastOwnerRef = useRef<string>("");

  // 登录账号切换时强制重置工作台 iframe，彻底隔离内存 Zustand 状态与请求控制器。
  useEffect(() => {
    if (sessionOwner === lastOwnerRef.current) return;
    if (lastOwnerRef.current && sessionOwner) {
      setReady(false);
      setSlow(false);
    }
    lastOwnerRef.current = sessionOwner;
  }, [sessionOwner]);

  useEffect(() => {
    if (!sessionKey || !hasVisitedImage) return;
    frame.current?.contentWindow?.postMessage(
      { type: "account-pool-session", key: sessionKey, owner: sessionOwner },
      window.location.origin
    );
  }, [sessionKey, sessionOwner, hasVisitedImage, attempt]);

  useEffect(() => {
    if (ready || !sessionKey || !hasVisitedImage) return;
    const timer = window.setTimeout(() => setSlow(true), 20000);
    return () => window.clearTimeout(timer);
  }, [ready, sessionKey, hasVisitedImage, attempt]);

  if (!isImageRoute && (!hasVisitedImage || !session)) {
    return null;
  }

  return (
    <section
      className={isImageRoute ? "image-workspace-active flex min-h-0 w-full flex-1 flex-col" : "hidden"}
    >
      <div
        className="relative min-h-0 w-full flex-1 overflow-hidden"
      >
        {!ready && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-transparent text-sm text-stone-500">
            <p role="status">
              {slow
                ? "加载时间较长，请点击重试。"
                : "正在加载工作台…"}
            </p>
            {slow && (
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setReady(false);
                  setSlow(false);
                  setAttempt((value) => value + 1);
                }}
              >
                重新加载
              </button>
            )}
          </div>
        )}
        {hasVisitedImage && session && <iframe
          key={`${sessionOwner}:${attempt}`}
          ref={frame}
          src={`/playground/?v=${encodeURIComponent(process.env.NEXT_PUBLIC_APP_VERSION || "0")}&retry=${attempt}`}
          title="生图工作台"
          className="absolute inset-0 h-full min-h-0 w-full border-0 bg-transparent"
          allow="clipboard-write; fullscreen"
        />}
      </div>
    </section>
  );
}

export function PersistentImageWorkspace() {
  return (
    <Suspense fallback={null}>
      <PersistentImageWorkspaceInner />
    </Suspense>
  );
}
