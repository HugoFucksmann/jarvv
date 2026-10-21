import React from "react";

export type StatusDotStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "unverified"
  | "blocked"
  | "approval";

interface StatusDotProps {
  status: StatusDotStatus;
  className?: string;
}

const STATUS_STYLES: Record<StatusDotStatus, { color: string; pulse: boolean }> = {
  idle: { color: "bg-slate-500", pulse: false },
  running: { color: "bg-sky-400", pulse: true },
  completed: { color: "bg-emerald-400", pulse: false },
  failed: { color: "bg-rose-500", pulse: false },
  unverified: { color: "bg-amber-400", pulse: false },
  blocked: { color: "bg-orange-500", pulse: false },
  approval: { color: "bg-amber-400", pulse: true },
};

export const StatusDot: React.FC<StatusDotProps> = ({ status, className = "" }) => {
  const { color, pulse } = STATUS_STYLES[status] ?? STATUS_STYLES.idle;

  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${color} ${pulse ? "animate-pulse" : ""} ${className}`}
    />
  );
};