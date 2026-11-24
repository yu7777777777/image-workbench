"use client";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  return (
    <AnimatedThemeToggler
      aria-label="切换主题"
      title="切换主题"
      variant="circle"
      className={cn("inline-flex size-8 shrink-0 items-center justify-center text-stone-500 transition hover:text-stone-900 dark:text-stone-300 dark:hover:text-white [&_svg]:size-4", className)}
    />
  );
}
