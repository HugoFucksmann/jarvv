import React from "react";
import { CheckCheck } from "lucide-react";

interface FinalResponseViewProps {
  response: string;
}

export const FinalResponseView: React.FC<FinalResponseViewProps> = ({ response }) => {
  return (
    <div className="flex flex-col gap-2 p-4 bg-slate-900/60 border border-slate-800 rounded-lg">
      <div className="flex items-center gap-2 text-xs font-mono font-medium text-emerald-400">
        <CheckCheck className="w-4 h-4" />
        <span>RESPUESTA FINAL SINTETIZADA</span>
      </div>
      <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
        {response}
      </div>
    </div>
  );
};
