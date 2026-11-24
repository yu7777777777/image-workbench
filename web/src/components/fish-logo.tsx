import { cn } from "@/lib/utils";

export function FishLogo({ className, animated = false }: { className?: string; animated?: boolean }) {
  return (
    <svg
      viewBox="0 0 118 78"
      aria-hidden="true"
      focusable="false"
      className={cn("fish-logo", animated && "fish-logo--animated", className)}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <g className="fish-logo__motion">
        <path
          className="fish-logo__tail"
          d="M9 24c12 2 23 8 31 18C30 54 18 57 9 57"
          strokeWidth="7.5"
        />
        <path
          d="M40 42c13-17 32-26 48-24 12 1 20 9 20 19 0 13-12 23-28 23-15 0-29-6-40-18Z"
          strokeWidth="7.5"
        />
        <path d="M58 45c6 5 14 7 23 6" stroke="#e3ac2e" strokeWidth="5" />
        <circle className="fish-logo__eye" cx="88" cy="33" r="4.9" fill="currentColor" stroke="none" />
      </g>
    </svg>
  );
}
