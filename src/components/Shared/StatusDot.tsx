import React from "react";

interface StatusDotProps {
  status: "idle" | "running" | "completed" | "failed" | "unverified" | "blocked" | "approval";
  className?: string;
}

export const StatusDot: React.FC<StatusDotProps> = ({ status, className = "" }) => {
  let color = "bg-slate-400";
  let pulse = false;

  switch (status) {
    case "running":
      color = "bg-sky-400";
      pulse = true;
      break;
    case "completed":
      color = "bg-emerald-400";
      break;
    case "failed":
      color = "bg-rose-500";
      break;
    case "unverified":
      color = "bg-amber-400";
      break;
    case "blocked":
      color = "bg-orange-500";
      break;
    case "approval":
      color = "bg-amber-400";
      pulse = true;
      break;
    case "idle":
    default:
      color = "bg-slate-500";
  }

  return (
    <span className={`inline-block w-2 h-2 rounded-full ${color} ${pulse ? "animate-pulse" : ""} ${className}`} />
  );
};
