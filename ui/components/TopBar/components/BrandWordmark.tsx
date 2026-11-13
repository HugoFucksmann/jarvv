import React from "react";

export const BrandWordmark: React.FC = () => {
  return (
    <div className="flex items-center gap-2.5">
      <span aria-hidden="true" className="w-2 h-2 rounded-full bg-accent-500" />
      <span className="text-base font-bold tracking-tight text-white">JARVIS</span>
      <span className="text-xs text-slate-500 font-mono tracking-wider">v2.2</span>
    </div>
  );
};