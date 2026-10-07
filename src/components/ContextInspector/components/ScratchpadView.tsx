import React from "react";
import { Scratchpad } from "../../../core/types.ts";

interface ScratchpadViewProps {
  scratchpad: Scratchpad;
}

export const ScratchpadView: React.FC<ScratchpadViewProps> = ({ scratchpad }) => {
  const hasContent = Object.keys(scratchpad).length > 0;

  if (!hasContent) {
    return (
      <div className="py-4 text-xs font-mono text-slate-500">
        Scratchpad vacío (sin estado temporal registrado).
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 text-xs font-mono">
      {scratchpad.path && (
        <div>
          <span className="text-slate-500">path: </span>
          <span className="text-slate-200">{scratchpad.path}</span>
        </div>
      )}
      {scratchpad.url && (
        <div>
          <span className="text-slate-500">url: </span>
          <span className="text-slate-200">{scratchpad.url}</span>
        </div>
      )}
      {scratchpad.window_handle && (
        <div>
          <span className="text-slate-500">window_handle: </span>
          <span className="text-slate-200">{scratchpad.window_handle}</span>
        </div>
      )}
      {scratchpad.element_id && (
        <div>
          <span className="text-slate-500">element_id: </span>
          <span className="text-slate-200">{scratchpad.element_id}</span>
        </div>
      )}
      {scratchpad.process_id && (
        <div>
          <span className="text-slate-500">process_id: </span>
          <span className="text-slate-200">{scratchpad.process_id}</span>
        </div>
      )}
      {scratchpad.text && (
        <div>
          <span className="text-slate-500">text: </span>
          <span className="text-slate-300 font-sans">{scratchpad.text}</span>
        </div>
      )}
      {scratchpad.search_results && (
        <div>
          <span className="text-slate-500">search_results: </span>
          <span className="text-slate-300">
            {scratchpad.search_results.length} resultados disponibles
          </span>
        </div>
      )}
    </div>
  );
};
