"use client";

import { ThemeToggle } from "@/components/theme-toggle";
import { VersionReleaseDialog } from "@/components/version-release-dialog";
import { cn } from "@/lib/utils";

export function HeaderActions({
  className,
  showGithubText: _showGithubText = true,
  compact = false,
  canUpgrade = false,
}: {
  className?: string;
  showGithubText?: boolean;
  compact?: boolean;
  canUpgrade?: boolean;
}) {
  return (
    <div className={cn("flex items-center", compact ? "flex-row sm:flex-col gap-0.5" : "gap-2 sm:gap-3", className)}>
      <ThemeToggle className={compact ? "workspace-theme-trigger" : undefined} />
      <VersionReleaseDialog compact={compact} canUpgrade={canUpgrade} />
    </div>
  );
}
