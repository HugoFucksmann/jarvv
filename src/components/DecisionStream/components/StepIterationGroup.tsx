import React, { useState, useEffect } from "react";
import { ChevronDown, ChevronRight, Layers, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import type { StepIterationGroupData } from "../../../types/debug.ts";
import type { ExecutableRoute } from "../../../core/types.ts";
import { getRouteLabel } from "../../../utils/routeLabels.ts";
import { ModelIterationCard } from "./ModelIterationCard.tsx";

interface StepIterationGroupProps {
  group: StepIterationGroupData;
  isInitiallyExpanded?: boolean;
}

export const StepIterationGroup: React.FC<StepIterationGroupProps> = ({
  group,
  isInitiallyExpanded = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(isInitiallyExpanded);

  useEffect(() => {
    if (isInitiallyExpanded !== undefined) {
      setIsExpanded(isInitiallyExpanded);
    }
  }, [isInitiallyExpanded]);

  const eosCount = group.iterations.filter((it) => it.model === "EOS_0_8B").length;
  const qwenCount = group.iterations.filter((it) => it.model === "QWEN_3_5_9B").length;

  const renderStatusIcon = () => {
    switch (group.state) {
      case "COMPLETED":
        return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
      case "RUNNING":
        return <Loader2 className="w-3.5 h-3.5 text-sky-400 animate-spin shrink-0" />;
      case "FAILED":
        return <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />;
      default:
        return <Layers className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
    }
  };

  return (
    <div className="flex flex-col rounded-lg border border-slate-800 bg-slate-900/30 overflow-hidden text-xs">
      {/* Group Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between px-3.5 py-2.5 bg-slate-950/70 hover:bg-slate-900/80 transition-colors text-left cursor-pointer border-b border-slate-800/60"
      >
        <div className="flex items-center gap-2 flex-wrap text-slate-300 font-mono text-[11px]">
          {renderStatusIcon()}
          <span className="font-semibold text-slate-200">
            {group.stepTitle}
          </span>
          {group.route && (
            <>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className="text-sky-300">{getRouteLabel(group.route as ExecutableRoute)}</span>
            </>
          )}
          {group.tool && (
            <>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className="text-emerald-300 font-medium">{group.tool}</span>
            </>
          )}
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span className="text-slate-400">
            {group.iterations.length} iteraciones ({eosCount > 0 ? `${eosCount} Eos` : ""}{eosCount > 0 && qwenCount > 0 ? " · " : ""}{qwenCount > 0 ? `${qwenCount} Qwen` : ""})
          </span>
        </div>

        <div className="flex items-center gap-1 text-slate-400 ml-2">
          <span className="text-[11px] font-mono">{isExpanded ? "Colapsar" : "Expandir"}</span>
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </div>
      </button>

      {/* Group Content — Model cards are minimized/collapsed by default */}
      {isExpanded && (
        <div className="flex flex-col gap-2 p-3 bg-slate-950/20">
          {group.iterations.map((iteration) => (
            <ModelIterationCard
              key={iteration.id}
              iteration={iteration}
              isInitiallyExpanded={false}
            />
          ))}
        </div>
      )}
    </div>
  );
};
