import React, { useState, useEffect } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { StepIterationGroupData } from "../../../types/debug.ts";
import { MODELS } from "../../../../src/core/models.ts";
import { getRouteLabel } from "../../../utils/routeLabels.ts";
import { ModelIterationCard } from "./ModelIterationCard.tsx";
import { StepStatusIcon } from "../../Shared/StepStatusIcon.tsx";
import { Separator } from "../../Shared/Separator.tsx";

interface StepIterationGroupProps {
  group: StepIterationGroupData;
  isInitiallyExpanded?: boolean;
}

export const StepIterationGroup: React.FC<StepIterationGroupProps> = ({
  group,
  isInitiallyExpanded = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(isInitiallyExpanded);

  // El control global "Expandir/Colapsar todos" sobrescribe el estado local del grupo
  useEffect(() => {
    setIsExpanded(isInitiallyExpanded);
  }, [isInitiallyExpanded]);

  const eosCount = group.iterations.filter((it) => it.model === "EOS_0_8B").length;
  const qwenCount = group.iterations.filter((it) => it.model === "QWEN_3_5_9B").length;
  const breakdown = [eosCount > 0 && `${eosCount} ${MODELS.EOS_0_8B.short}`, qwenCount > 0 && `${qwenCount} ${MODELS.QWEN_3_5_9B.short}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col text-xs">
      {/* Cabecera del grupo */}
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        aria-expanded={isExpanded}
        className="flex items-center justify-between px-2 py-2 rounded-md hover:bg-slate-900/50 transition-colors text-left cursor-pointer"
      >
        <div className="flex items-center gap-2 flex-wrap text-slate-300 font-mono text-[11px]">
          <StepStatusIcon state={group.state} size="sm" />
          <span className="font-semibold text-slate-200">{group.stepTitle}</span>
          {group.route && (
            <>
              <Separator />
              <span className="text-sky-300">{getRouteLabel(group.route)}</span>
            </>
          )}
          {group.tool && (
            <>
              <Separator />
              <span className="text-emerald-300 font-medium">{group.tool}</span>
            </>
          )}
          <Separator />
          <span className="text-slate-400">
            {group.iterations.length} iteraciones{breakdown && ` (${breakdown})`}
          </span>
        </div>

        <div className="flex items-center gap-1 text-slate-400 ml-2">
          <span className="text-[11px] font-mono">{isExpanded ? "Colapsar" : "Expandir"}</span>
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </div>
      </button>

      {/* Contenido: las tarjetas de modelo arrancan minimizadas */}
      {isExpanded && (
        <div className="flex flex-col gap-2 ml-3 pl-3 py-1.5 border-l border-slate-800">
          {group.iterations.map((iteration) => (
            <ModelIterationCard key={iteration.id} iteration={iteration} />
          ))}
        </div>
      )}
    </div>
  );
};