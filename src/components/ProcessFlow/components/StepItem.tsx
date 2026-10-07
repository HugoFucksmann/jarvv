import React from "react";
import { CheckCircle2, AlertCircle, Clock, ShieldX, HelpCircle, Loader2, ShieldAlert } from "lucide-react";
import { Step } from "../../../core/types.ts";

interface StepItemProps {
  step: Step;
  index: number;
  isCurrent: boolean;
}

export const StepItem: React.FC<StepItemProps> = ({ step, index, isCurrent }) => {
  const renderStatusIcon = () => {
    switch (step.state) {
      case "COMPLETED":
        return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
      case "RUNNING":
        return <Loader2 className="w-4 h-4 text-sky-400 animate-spin shrink-0" />;
      case "WAITING_APPROVAL":
        return <ShieldAlert className="w-4 h-4 text-amber-400 animate-pulse shrink-0" />;
      case "FAILED":
        return <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />;
      case "UNVERIFIED":
        return <HelpCircle className="w-4 h-4 text-amber-400 shrink-0" />;
      case "BLOCKED":
        return <ShieldX className="w-4 h-4 text-orange-500 shrink-0" />;
      case "PENDING":
      default:
        return <Clock className="w-4 h-4 text-slate-600 shrink-0" />;
    }
  };

  const getRouteLabel = () => {
    switch (step.route) {
      case "windows":
        return "Windows MCP";
      case "desktop_commander":
        return "Desktop Commander";
      case "free_search":
        return "Free Search MCP";
      case "chat":
        return "Qwen 3.5 9B Chat";
      default:
        return step.route;
    }
  };

  return (
    <div
      className={`flex flex-col gap-2 py-3 px-3.5 rounded-lg transition-colors ${
        isCurrent
          ? "bg-slate-900/90 border border-slate-700/60"
          : "hover:bg-slate-900/40 border border-transparent"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5">{renderStatusIcon()}</div>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-mono text-slate-500 tabular-nums">
                #{index + 1}
              </span>
              <span className="font-mono text-slate-400 font-medium">
                {getRouteLabel()}
              </span>
              {step.tool && (
                <>
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <span className="font-mono text-sky-300">
                    {step.tool}
                  </span>
                </>
              )}
            </div>
            <p className="text-sm text-slate-200">
              {step.instruction}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono shrink-0">
          {step.verification === "UNVERIFIED" && (
            <span className="text-amber-400 font-medium">
              [UNVERIFIED]
            </span>
          )}
          {step.verification === "VERIFIED" && (
            <span className="text-emerald-400">
              [VERIFIED]
            </span>
          )}
          <span className="text-slate-500">
            {step.state}
          </span>
        </div>
      </div>

      {/* Render evidence or execution details if present */}
      {step.evidence && (
        <div className="ml-7 text-xs text-slate-400 border-l border-slate-800 pl-3 py-0.5">
          <p className="line-clamp-2 text-slate-300">
            {step.evidence.summary}
          </p>
          {step.evidence.flags && step.evidence.flags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-1 text-slate-500 font-mono text-[11px]">
              {step.evidence.flags.map((flag, fIdx) => (
                <span key={fIdx}>· {flag}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Render error if failed */}
      {step.error && (
        <div className="ml-7 text-xs text-rose-400 font-mono border-l border-rose-900/60 pl-3 py-1">
          {step.error}
        </div>
      )}
    </div>
  );
};
