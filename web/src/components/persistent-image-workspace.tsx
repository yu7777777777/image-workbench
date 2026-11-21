"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getValidatedAuthSession } from "@/lib/auth-session";
import type { StoredAuthSession } from "@/store/auth";
import { cn } from "@/lib/utils";

function PersistentImageWorkspaceInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const normalizedPath = (pathname || "").replace(/\/$/, "");
  const isImageRoute = normalizedPath === "/image";
  const rawMode = searchParams.get("mode");
  const currentMode = rawMode === "agent" ? "agent" : rawMode === "canvas" ? "canvas" : "gallery";

  const [session, setSession] = useState<StoredAuthSession | null>(null);
  const [hasVisitedImage, setHasVisitedImage] = useState(false);
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

  // Mark as visited when user enters /image with a valid session
  useEffect(() => {
    if (isImageRoute && session) {
      setHasVisitedImage(true);
    }
  }, [isImageRoute, session]);

  // Lock outer page scrolling when in image workspace
  useEffect(() => {
    if (isImageRoute) {
      document.documentElement.classList.add("image-route-lock");
      document.body.classList.add("image-route-lock");
      return () => {
        document.documentElement.classList.remove("image-route-lock");
        document.body.classList.remove("image-route-lock");
      };
    }
  }, [isImageRoute]);

  // Sync mode to iframe whenever ready and mode changes
  useEffect(() => {
    if (ready && frame.current?.contentWindow) {
      frame.current.contentWindow.postMessage(
        { type: "set-app-mode", mode: currentMode },
        window.location.origin
      );
    }
  }, [ready, currentMode]);

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
          { type: "account-pool-session", key: session.key },
          window.location.origin
        );
      }
      if (event.data?.type === "account-pool-mounted") {
        setReady(true);
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
      if (event.data?.type === "app-mode-sync" && isImageRoute) {
        const incoming = event.data.mode === "agent" ? "agent" : event.data.mode === "canvas" ? "canvas" : "gallery";
        if (incoming !== currentMode) {
          router.replace(`/image?mode=${incoming}`);
        }
      }
      if (event.data?.type === "open-settings") {
        router.push("/settings");
      }
    };

    window.addEventListener("message", receive);
    const timer = window.setTimeout(() => setSlow(true), 20000);
    return () => {
      window.removeEventListener("message", receive);
      window.clearTimeout(timer);
    };
  }, [session, attempt, hasVisitedImage, currentMode, isImageRoute, router]);

  // If user hasn't visited /image yet, or is not logged in, don't mount the iframe
  if (!hasVisitedImage || !session) {
    return null;
  }

  return (
    <section
      className={cn(
        "w-full min-h-0 flex-1 flex-col",
        isImageRoute ? "flex" : "hidden"
      )}
    >
      <div
        className={cn(
          "relative w-full overflow-hidden",
          isImageRoute ? "min-h-0 flex-1" : "min-h-[520px] flex-none"
        )}
      >
        {!ready && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-transparent text-sm text-zinc-500">
            <p>
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
        <iframe
          key={attempt}
          ref={frame}
          src={`/playground/?v=${encodeURIComponent(process.env.NEXT_PUBLIC_APP_VERSION || "0")}&retry=${attempt}#${currentMode}`}
          title="生图工作台"
          className="absolute inset-0 h-full min-h-0 w-full border-0 bg-transparent"
          allow="clipboard-write; fullscreen"
        />
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
