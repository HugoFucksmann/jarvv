import React from "react";
import type { Scratchpad } from "../../../core/types.ts";

interface ScratchpadViewProps {
  scratchpad: Scratchpad;
}

export const ScratchpadView: React.FC<ScratchpadViewProps> = ({ scratchpad }) => {
  const entries = Object.entries(scratchpad || {});
  const hasContent = entries.length > 0;

  if (!hasContent) {
    return (
      <div className="py-4 text-xs font-mono text-slate-500">
        Scratchpad vacío (sin estado temporal registrado).
      </div>
    );
  }

  const standardKeys = new Set([
    "path",
    "url",
    "window_handle",
    "element_id",
    "process_id",
    "text",
    "search_results",
    "selected_result",
  ]);

  const extraEntries = entries.filter(([k]) => !standardKeys.has(k));

  const formatValue = (val: unknown): string => {
    if (typeof val === "string") return val;
    if (typeof val === "number" || typeof val === "boolean") return String(val);
    if (val === null) return "null";
    if (val === undefined) return "undefined";
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  };

  return (
    <div className="flex flex-col gap-2.5 text-xs font-mono">
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
      {scratchpad.selected_result !== undefined && (
        <div>
          <span className="text-slate-500">selected_result: </span>
          <span className="text-slate-300">{formatValue(scratchpad.selected_result)}</span>
        </div>
      )}

      {/* Dynamic Extra Variables (FUNC-05) */}
      {extraEntries.length > 0 && (
        <div className="pt-2 border-t border-slate-800/80 flex flex-col gap-1.5">
          <span className="text-slate-500 text-[11px] font-semibold">Variables adicionales:</span>
          {extraEntries.map(([key, val]) => (
            <div key={key} className="flex items-start gap-1">
              <span className="text-slate-400">{key}: </span>
              <span className="text-slate-200 break-all">{formatValue(val)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
