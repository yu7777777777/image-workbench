"use client";

import { ThemeToggle } from "@/components/theme-toggle";
import { VersionReleaseDialog } from "@/components/version-release-dialog";
import { cn } from "@/lib/utils";

export function HeaderActions({
  className,
  showGithubText: _showGithubText = true,
  compact = false,
}: {
  className?: string;
  showGithubText?: boolean;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex items-center", compact ? "flex-col gap-0.5" : "gap-2 sm:gap-3", className)}>
      <ThemeToggle className={compact ? "workspace-theme-trigger" : undefined} />
      <VersionReleaseDialog compact={compact} />
    </div>
  );
}
