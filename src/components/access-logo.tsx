import { useId } from "react";

type AccessLogoProps = {
  className?: string;
  markOnly?: boolean;
  tone?: "gradient" | "black" | "white";
};

/** Compact geometric AccessForAll A mark and wordmark. */
export function AccessLogo({ className = "", markOnly = false, tone = "gradient" }: AccessLogoProps) {
  const gradientId = useId().replaceAll(":", "");
  const stroke = tone === "black" ? "#111827" : tone === "white" ? "#FFFFFF" : `url(#${gradientId})`;

  return <span className={`access-logo ${markOnly ? "access-logo-mark-only" : ""} ${className}`.trim()}>
    <svg className="access-logo-symbol" viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
      {tone === "gradient" && <defs><linearGradient id={gradientId} x1="9" y1="47" x2="55" y2="14" gradientUnits="userSpaceOnUse"><stop stopColor="#6366F1" /><stop offset="1" stopColor="#8B5CF6" /></linearGradient></defs>}
      <path d="M12 50 29.3 17.4a3 3 0 0 1 5.4 0L52 50" stroke={stroke} strokeWidth="7.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22.2 42.5h19.6" stroke={stroke} strokeWidth="5.6" strokeLinecap="round" />
      <path d="M24.7 49.5v-4.8m7.3 4.8v-8m7.3 8v-4.8" stroke={stroke} strokeWidth="4.2" strokeLinecap="round" />
      <circle cx="50.5" cy="17" r="4.2" fill={stroke} />
    </svg>
    {!markOnly && <span className="access-logo-wordmark">AccessForAll</span>}
  </span>;
}
