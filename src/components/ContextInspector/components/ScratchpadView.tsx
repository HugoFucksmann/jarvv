import React, { useState } from "react";
import type { Scratchpad } from "../../../core/types.ts";

interface ScratchpadViewProps {
  scratchpad: Scratchpad;
}

interface SearchItemShape {
  title?: string;
  url?: string;
  snippet?: string;
  [key: string]: unknown;
}

export const ScratchpadView: React.FC<ScratchpadViewProps> = ({ scratchpad }) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const entries = Object.entries(scratchpad || {});
  const hasContent = entries.length > 0;

  if (!hasContent) {
    return (
      <div className="py-6 text-center text-xs font-mono text-slate-500">
        Scratchpad vacío (sin variables ni resultados temporales registrados).
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
    "search_results_total",
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

  const searchResults = Array.isArray(scratchpad.search_results)
    ? (scratchpad.search_results as SearchItemShape[])
    : null;

  const totalResults = typeof scratchpad.search_results_total === "number"
    ? scratchpad.search_results_total
    : searchResults?.length;

  const rawPrimaryVars = [
    { key: "path", label: "path", value: scratchpad.path },
    { key: "url", label: "url", value: scratchpad.url },
    { key: "process_id", label: "process_id", value: scratchpad.process_id },
    { key: "window_handle", label: "window_handle", value: scratchpad.window_handle },
    { key: "element_id", label: "element_id", value: scratchpad.element_id },
    { key: "text", label: "text", value: scratchpad.text },
  ];
  const primaryVars = rawPrimaryVars.filter(
    (item): item is { key: string; label: string; value: string } => typeof item.value === "string" && item.value.length > 0
  );

  return (
    <div className="flex flex-col gap-6 text-xs font-sans text-slate-300">
      {/* 1. Primary & Extra Context Variables */}
      <section>
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 font-mono">
            Variables de Contexto
          </span>
          <span className="text-[10px] font-mono text-slate-500">
            {primaryVars.length + extraEntries.length + (scratchpad.selected_result !== undefined ? 1 : 0)} var(s)
          </span>
        </div>

        {primaryVars.length === 0 && extraEntries.length === 0 && scratchpad.selected_result === undefined ? (
          <div className="text-slate-500 font-mono text-[11px] py-1">Sin variables de contexto registradas.</div>
        ) : (
          <div className="flex flex-col divide-y divide-slate-800/40">
            {primaryVars.map((item) => {
              const isCopied = copiedKey === item.key;
              return (
                <div key={item.key} className="py-1.5 flex items-start justify-between gap-4 group">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="font-mono text-slate-400 text-[11px] shrink-0 font-medium">{item.label}:</span>
                    <span className="font-mono text-slate-200 text-xs break-all selection:bg-cyan-950">
                      {item.value}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopy(item.key, item.value)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-mono text-slate-500 hover:text-slate-300 shrink-0 px-1.5 py-0.5 rounded hover:bg-slate-800"
                    title={`Copiar ${item.label}`}
                  >
                    {isCopied ? "Copiado!" : "Copiar"}
                  </button>
                </div>
              );
            })}

            {scratchpad.selected_result !== undefined && (
              <div key="selected_result" className="py-1.5 flex items-start justify-between gap-4 group">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="font-mono text-slate-400 text-[11px] shrink-0 font-medium">selected_result:</span>
                  <span className="font-mono text-amber-200/90 text-xs break-all">
                    {formatValue(scratchpad.selected_result)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy("selected_result", formatValue(scratchpad.selected_result))}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-mono text-slate-500 hover:text-slate-300 shrink-0 px-1.5 py-0.5 rounded hover:bg-slate-800"
                >
                  {copiedKey === "selected_result" ? "Copiado!" : "Copiar"}
                </button>
              </div>
            )}

            {extraEntries.map(([key, val]) => {
              const strVal = formatValue(val);
              const isCopied = copiedKey === key;
              return (
                <div key={key} className="py-1.5 flex items-start justify-between gap-4 group">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="font-mono text-slate-400 text-[11px] shrink-0 font-medium">{key}:</span>
                    <span className="font-mono text-slate-200 text-xs break-all selection:bg-cyan-950">{strVal}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopy(key, strVal)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-mono text-slate-500 hover:text-slate-300 shrink-0 px-1.5 py-0.5 rounded hover:bg-slate-800"
                  >
                    {isCopied ? "Copiado!" : "Copiar"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 2. Structured Search Results */}
      {searchResults && (
        <section>
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 font-mono">
                Resultados de Búsqueda
              </span>
              <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-slate-800 text-slate-300">
                {searchResults.length}
                {totalResults !== undefined && totalResults > searchResults.length ? ` de ${totalResults}` : ""}
              </span>
            </div>
            {totalResults !== undefined && totalResults > searchResults.length && (
              <span className="text-[10px] font-mono text-slate-500">
                Conservando los primeros {searchResults.length}
              </span>
            )}
          </div>

          {searchResults.length === 0 ? (
            <div className="text-slate-500 font-mono text-xs py-2">
              Sin resultados para la última consulta.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {searchResults.map((item, idx) => {
                const itemKey = item.url ? `url:${item.url}` : `search-item-${idx}-${item.title || "untitled"}`;
                const isCopied = copiedKey === itemKey;

                return (
                  <div
                    key={itemKey}
                    className="p-2.5 rounded border border-slate-800/80 bg-slate-900/40 hover:border-slate-700/80 transition-colors flex flex-col gap-1.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h4 className="font-medium text-slate-200 text-xs leading-snug">
                        {item.title || "Sin título"}
                      </h4>
                      {item.url && (
                        <button
                          type="button"
                          onClick={() => handleCopy(itemKey, item.url!)}
                          className="text-[10px] font-mono text-slate-500 hover:text-slate-300 shrink-0 px-1 py-0.5 rounded hover:bg-slate-800"
                          title="Copiar URL"
                        >
                          {isCopied ? "Copiado!" : "Copiar enlace"}
                        </button>
                      )}
                    </div>

                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] font-mono text-cyan-400/90 hover:text-cyan-300 underline underline-offset-2 break-all line-clamp-1"
                      >
                        {item.url}
                      </a>
                    )}

                    {item.snippet && (
                      <p className="text-[11px] leading-relaxed text-slate-400 font-sans mt-0.5">
                        {item.snippet}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
