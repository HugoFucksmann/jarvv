import React from "react";

export const BrandWordmark: React.FC = () => {
  return (
    <div className="flex items-center gap-3">
      <span className="text-base font-bold tracking-tight text-white">
        JARVIS
      </span>
      <span className="text-xs text-slate-400 font-mono tracking-wider">
        v1.0
      </span>
    </div>
  );
};
