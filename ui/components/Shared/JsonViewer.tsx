import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Brain } from "lucide-react";
import { CopyButton } from "./CopyButton.tsx";
import { isContainer, parseJsonLoose, stringifyJson, tryParseJson, type JsonContainer } from "../../utils/parseJson.ts";

/** Elementos mostrados por tanda en arreglos y objetos grandes. */
const PAGE_SIZE = 100;
/** Caracteres de una cadena larga antes de pedir "ver más". */
const STRING_PREVIEW = 240;
/** Tope de profundidad de "Expandir todo": evita renderizar árboles enormes de una sola vez. */
const EXPAND_ALL_DEPTH = 12;

export interface JsonViewerProps {
  /**
   * Lo que se quiere inspeccionar: un valor ya estructurado, o texto crudo de un modelo (JSON limpio, con
   * razonamiento `<think>`, en cerca de código o rodeado de prosa). Si no hay JSON se muestra como texto.
   */
  data: unknown;
  /** Niveles abiertos al inicio (0 = todo colapsado). */
  defaultExpandDepth?: number;
  /** Clase de altura máxima del área con desplazamiento. */
  maxHeightClass?: string;
  className?: string;
  /** Oculta la barra de herramientas (vista compacta de solo lectura). */
  showToolbar?: boolean;
}

// ---------------------------------------------------------------------------
// Nodos
// ---------------------------------------------------------------------------

const KEY_CLASS = "text-sky-300";
const INDEX_CLASS = "text-slate-500";

const toolButtonBase =
  "flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono rounded border border-slate-800 cursor-pointer transition-colors";
const toolButton = `${toolButtonBase} text-slate-400 hover:text-slate-200 bg-slate-900/80 hover:bg-slate-800`;
const toolButtonActive = `${toolButtonBase} text-white bg-slate-800`;

const NodeName: React.FC<{ name?: string | number }> = ({ name }) =>
  name === undefined ? null : (
    <>
      <span className={typeof name === "number" ? INDEX_CLASS : KEY_CLASS}>{name}</span>
      <span className="text-slate-500">:</span>
    </>
  );

const ScalarValue: React.FC<{ value: unknown }> = ({ value }) => {
  if (value === null) return <span className="text-slate-500">null</span>;
  if (typeof value === "number") return <span className="text-amber-300 tabular-nums">{String(value)}</span>;
  if (typeof value === "boolean") return <span className="text-indigo-300">{String(value)}</span>;
  return <span className="text-slate-400">{String(value)}</span>;
};

const StringRow: React.FC<{ name?: string | number; value: string }> = ({ name, value }) => {
  const [full, setFull] = useState(false);
  const long = value.length > STRING_PREVIEW;
  const multiline = value.includes("\n");
  const shown = long && !full ? `${value.slice(0, STRING_PREVIEW)}…` : value;

  return (
    <div className="flex items-start gap-1 leading-5 pl-4">
      <NodeName name={name} />
      <div className="min-w-0 flex-1">
        <span
          className={`text-emerald-300 break-words ${multiline || full ? "whitespace-pre-wrap" : ""} ${
            full && long ? "block max-h-64 overflow-y-auto" : ""
          }`}
        >
          &quot;{shown}&quot;
        </span>
        {long && (
          <button
            type="button"
            onClick={() => setFull((v) => !v)}
            className="ml-1.5 text-[10px] text-sky-400 hover:text-sky-300 cursor-pointer"
          >
            {full ? "ver menos" : `ver más (${value.length} caracteres)`}
          </button>
        )}
      </div>
    </div>
  );
};

interface NodeProps {
  name?: string | number;
  value: unknown;
  depth: number;
  openDepth: number;
}

const ContainerNode: React.FC<NodeProps & { value: JsonContainer; tag?: string }> = ({
  name,
  value,
  depth,
  openDepth,
  tag,
}) => {
  const isArray = Array.isArray(value);
  const keys = isArray ? [] : Object.keys(value);
  const count = isArray ? value.length : keys.length;
  const [open, setOpen] = useState(depth < openDepth);
  const [shown, setShown] = useState(PAGE_SIZE);

  if (count === 0) {
    return (
      <div className="flex items-start gap-1 leading-5 pl-4">
        <NodeName name={name} />
        <span className="text-slate-500">{isArray ? "[]" : "{}"}</span>
        {tag && <span className="text-[9px] px-1 rounded bg-slate-800 text-slate-400">{tag}</span>}
      </div>
    );
  }

  // Los hijos solo se construyen con el nodo abierto: un árbol colapsado no cuesta nada.
  const entries: Array<[string | number, unknown]> = open
    ? isArray
      ? value.slice(0, shown).map((v, i): [number, unknown] => [i, v])
      : keys.slice(0, shown).map((k): [string, unknown] => [k, (value as Record<string, unknown>)[k]])
    : [];

  return (
    <div className="flex flex-col">
      <div className="group flex items-start gap-1 leading-5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-start gap-1 min-w-0 text-left rounded hover:bg-slate-800/50 cursor-pointer"
        >
          {open ? (
            <ChevronDown className="w-3 h-3 mt-1 text-slate-500 shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 mt-1 text-slate-500 shrink-0" />
          )}
          <NodeName name={name} />
          <span className="text-slate-400 shrink-0">{isArray ? `Array(${count})` : `{${count}}`}</span>
          {tag && <span className="self-center text-[9px] px-1 rounded bg-slate-800 text-slate-400">{tag}</span>}
          {!open && !isArray && (
            <span className="text-slate-600 truncate">{keys.slice(0, 4).join(", ")}{keys.length > 4 ? ", …" : ""}</span>
          )}
        </button>
        <CopyButton
          text={() => stringifyJson(value)}
          title="Copiar este nodo como JSON"
          ariaLabel="Copiar nodo JSON"
          iconSize="w-3 h-3"
          iconColor="text-slate-500"
          stopPropagation
          className="p-0.5 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-slate-800 transition-opacity"
        />
      </div>

      {open && (
        <div className="ml-1.5 pl-3 border-l border-slate-800/80 flex flex-col">
          {entries.map(([k, v]) => (
            <JsonNode key={k} name={k} value={v} depth={depth + 1} openDepth={openDepth} />
          ))}
          {count > shown && (
            <button
              type="button"
              onClick={() => setShown((n) => n + PAGE_SIZE)}
              className="self-start pl-4 py-0.5 text-[10px] text-sky-400 hover:text-sky-300 cursor-pointer"
            >
              mostrar {Math.min(PAGE_SIZE, count - shown)} más ({count - shown} restantes)
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const JsonNode: React.FC<NodeProps> = ({ name, value, depth, openDepth }) => {
  // Un texto que es, completo, un objeto o arreglo JSON se muestra como árbol (p. ej. payloads serializados dentro de otro).
  const nested = useMemo(() => (typeof value === "string" ? tryParseJson(value) : undefined), [value]);

  if (isContainer(value)) return <ContainerNode name={name} value={value} depth={depth} openDepth={openDepth} />;
  if (nested) return <ContainerNode name={name} value={nested} depth={depth} openDepth={openDepth} tag="json" />;
  if (typeof value === "string") return <StringRow name={name} value={value} />;

  return (
    <div className="flex items-start gap-1 leading-5 pl-4">
      <NodeName name={name} />
      <ScalarValue value={value} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Visor
// ---------------------------------------------------------------------------

const TextBlock: React.FC<{ text: string; muted?: boolean }> = ({ text, muted = false }) => (
  <pre
    className={`whitespace-pre-wrap break-words leading-relaxed select-text ${muted ? "text-slate-500" : "text-slate-200"}`}
  >
    {text}
  </pre>
);

/**
 * Visor interactivo de JSON para cualquier dato de la UI: iteraciones de modelos (entrada y salida cruda),
 * argumentos de herramientas, planes, etc. Recibe valores o texto crudo y decide solo cómo mostrarlos.
 */
export const JsonViewer: React.FC<JsonViewerProps> = ({
  data,
  defaultExpandDepth = 1,
  maxHeightClass = "max-h-96",
  className = "",
  showToolbar = true,
}) => {
  const parsed = useMemo(() => parseJsonLoose(data), [data]);
  const [view, setView] = useState<"tree" | "text">("tree");
  // `version` fuerza el remontaje del árbol para que "Expandir/Colapsar todo" reinicie el estado de cada nodo.
  const [expand, setExpand] = useState({ depth: defaultExpandDepth, version: 0 });

  const hasTree = parsed.parsed && parsed.value !== undefined;
  const showTree = hasTree && view === "tree";
  const body = parsed.plain ?? parsed.text;

  if (!hasTree && !parsed.reasoning && !body) {
    return <span className={`text-[11px] font-mono text-slate-500 ${className}`}>Sin datos</span>;
  }

  const setDepth = (depth: number) => setExpand((prev) => ({ depth, version: prev.version + 1 }));

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {showToolbar && (
        <div className="flex items-center justify-end gap-1.5 flex-wrap">
          {hasTree && (
            <div className="flex items-center gap-1 mr-auto" role="group" aria-label="Modo de visualización">
              <button
                type="button"
                aria-pressed={view === "tree"}
                onClick={() => setView("tree")}
                className={view === "tree" ? toolButtonActive : toolButton}
              >
                Árbol
              </button>
              <button
                type="button"
                aria-pressed={view === "text"}
                onClick={() => setView("text")}
                className={view === "text" ? toolButtonActive : toolButton}
              >
                Texto
              </button>
            </div>
          )}
          {showTree && (
            <>
              <button type="button" onClick={() => setDepth(EXPAND_ALL_DEPTH)} className={toolButton}>
                <ChevronsUpDown className="w-3 h-3" />
                <span>Expandir todo</span>
              </button>
              <button type="button" onClick={() => setDepth(0)} className={toolButton}>
                <ChevronsDownUp className="w-3 h-3" />
                <span>Colapsar todo</span>
              </button>
            </>
          )}
          <CopyButton
            text={() => (showTree && parsed.value !== undefined ? stringifyJson(parsed.value) : body)}
            label={showTree ? "Copiar JSON" : "Copiar texto"}
            title={showTree ? "Copiar el JSON completo (con sangría)" : "Copiar el texto completo"}
            iconColor="text-slate-400"
            className="gap-1 px-1.5 py-0.5 text-[10px] font-mono rounded text-slate-400 hover:text-slate-200 bg-slate-900/80 hover:bg-slate-800 border border-slate-800"
          />
        </div>
      )}

      {parsed.reasoning && (
        <details className="rounded border border-slate-800/80 bg-slate-900/40 text-[11px]">
          <summary className="flex items-center gap-1.5 px-2 py-1 cursor-pointer text-slate-400 hover:text-slate-200 select-none">
            <Brain className="w-3 h-3 text-indigo-400" />
            <span>Razonamiento del modelo ({parsed.reasoning.length} caracteres)</span>
          </summary>
          <div className="px-2 pb-2 max-h-64 overflow-y-auto">
            <TextBlock text={parsed.reasoning} muted />
          </div>
        </details>
      )}

      <div className={`font-mono text-[11px] p-2 bg-slate-950/40 border border-slate-800/60 rounded overflow-auto ${maxHeightClass}`}>
        {showTree && parsed.value !== undefined ? (
          <div className="flex flex-col gap-1">
            {parsed.before && <TextBlock text={parsed.before} muted />}
            <div key={expand.version}>
              <JsonNode value={parsed.value} depth={0} openDepth={expand.depth} />
            </div>
            {parsed.after && <TextBlock text={parsed.after} muted />}
          </div>
        ) : (
          <TextBlock text={hasTree ? parsed.text : body} />
        )}
      </div>
    </div>
  );
};
