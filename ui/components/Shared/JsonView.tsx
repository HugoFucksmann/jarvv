import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { CopyButton } from "./CopyButton.tsx";

/**
 * Visor JSON compartido: resaltado de sintaxis, nodos plegables con guías de indentación,
 * textos largos o con saltos de línea legibles como párrafos, y copia por nodo.
 *
 * - `JsonView` recibe un valor ya parseado.
 * - `JsonText` recibe texto: si es JSON válido usa `JsonView`, si no lo muestra tal cual.
 */

const PAGE_SIZE = 100;
const CLIP_AT = 1200;
const BLOCK_STRING_MIN = 160;

const COPY_CLASS = "gap-1 rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-white";
const REVEAL = "opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100";

const isContainer = (v: unknown): v is Record<string, unknown> | unknown[] => typeof v === "object" && v !== null;

const stringify = (v: unknown) => JSON.stringify(v, null, 2);

const Punct: React.FC<{ children: React.ReactNode }> = ({ children }) => <span className="text-slate-500">{children}</span>;

const Comma: React.FC<{ show: boolean }> = ({ show }) => (show ? <span className="text-slate-600">,</span> : null);

/*
 * Sintaxis: claves en naranja, textos en gris claro (el valor que se lee), números en amarillo y
 * true/false/null en rosa. Los textos no usan un tono cálido para no confundirse con las claves.
 */
const Key: React.FC<{ name: string }> = ({ name }) => (
  <>
    <span className="text-accent-300">{JSON.stringify(name)}</span>
    <span className="text-slate-500">: </span>
  </>
);

const Primitive: React.FC<{ value: unknown }> = ({ value }) => {
  if (value === null) return <span className="text-rose-300">null</span>;
  if (typeof value === "boolean") return <span className="text-rose-300">{String(value)}</span>;
  if (typeof value === "number") return <span className="text-yellow-300">{String(value)}</span>;
  if (typeof value === "string") return <span className="break-words text-slate-100">{JSON.stringify(value)}</span>;
  return <span className="text-slate-400">{String(value)}</span>;
};

/** Texto largo o multilínea: se lee como párrafo, con barra lateral, en lugar de una línea con \n escapados. */
const LongString: React.FC<{ name?: string; value: string }> = ({ name, value }) => {
  const [full, setFull] = useState(false);
  const clipped = !full && value.length > CLIP_AT;
  return (
    <div className="group/row rounded hover:bg-slate-800/40">
      <div className="flex items-center gap-2 pl-5">
        {name !== undefined && (
          <span>
            <Key name={name} />
          </span>
        )}
        <span className="text-xs text-slate-500">{value.length.toLocaleString()} car.</span>
        <span className={`ml-auto ${REVEAL}`}>
          <CopyButton text={value} title="Copiar texto" iconSize="w-3.5 h-3.5" className={COPY_CLASS} />
        </span>
      </div>
      <div className="ml-5 mb-1 border-l-2 border-slate-700 pl-3 font-sans text-sm leading-7 text-slate-200 whitespace-pre-wrap break-words">
        {clipped ? `${value.slice(0, CLIP_AT)}…` : value}
      </div>
      {clipped && (
        <button
          type="button"
          onClick={() => setFull(true)}
          className="ml-5 mb-1 pl-3 text-xs text-accent-300 hover:underline cursor-pointer"
        >
          Mostrar todo ({value.length.toLocaleString()} car.)
        </button>
      )}
    </div>
  );
};

interface NodeProps {
  name?: string;
  value: unknown;
  depth: number;
  last: boolean;
  defaultDepth: number;
}

const Node: React.FC<NodeProps> = ({ name, value, depth, last, defaultDepth }) => {
  const [open, setOpen] = useState(depth < defaultDepth);
  const [shown, setShown] = useState(PAGE_SIZE);
  const container = isContainer(value);
  const isArray = Array.isArray(value);
  const entries = useMemo<[string, unknown][]>(() => {
    if (!isContainer(value)) return [];
    return Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value);
  }, [value]);

  if (!container) {
    if (typeof value === "string" && (value.includes("\n") || value.length > BLOCK_STRING_MIN)) {
      return <LongString name={name} value={value} />;
    }
    return (
      <div className="rounded pl-5 break-words hover:bg-slate-800/40">
        {name !== undefined && <Key name={name} />}
        <Primitive value={value} />
        <Comma show={!last} />
      </div>
    );
  }

  const [openCh, closeCh] = isArray ? ["[", "]"] : ["{", "}"];
  const count = entries.length;
  const noun = isArray ? (count === 1 ? "elemento" : "elementos") : count === 1 ? "clave" : "claves";

  if (count === 0) {
    return (
      <div className="rounded pl-5 hover:bg-slate-800/40">
        {name !== undefined && <Key name={name} />}
        <Punct>{openCh + closeCh}</Punct>
        <Comma show={!last} />
      </div>
    );
  }

  return (
    <div>
      <div
        onClick={() => setOpen((o) => !o)}
        className="group/row flex cursor-pointer items-start gap-1 rounded hover:bg-slate-800/40"
      >
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? "Contraer" : "Expandir"}
          className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded text-slate-500 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <div className="min-w-0 flex-1 break-words">
          {name !== undefined && <Key name={name} />}
          <Punct>{openCh}</Punct>
          {!open && (
            <>
              <span className="mx-1.5 text-xs text-slate-500">
                {count} {noun}
              </span>
              <Punct>{closeCh}</Punct>
              <Comma show={!last} />
            </>
          )}
        </div>
        {depth > 0 && (
          <span className={`shrink-0 ${REVEAL}`}>
            <CopyButton
              text={() => stringify(value)}
              stopPropagation
              title="Copiar este nodo"
              iconSize="w-3.5 h-3.5"
              className={COPY_CLASS}
            />
          </span>
        )}
      </div>
      {open && (
        <>
          <div className="ml-2 border-l border-slate-800 pl-4">
            {entries.slice(0, shown).map(([k, v], i) => (
              <Node
                key={k}
                name={isArray ? undefined : k}
                value={v}
                depth={depth + 1}
                last={i === count - 1}
                defaultDepth={defaultDepth}
              />
            ))}
            {shown < count && (
              <button
                type="button"
                onClick={() => setShown((s) => s + PAGE_SIZE)}
                className="py-0.5 text-xs text-accent-300 hover:underline cursor-pointer"
              >
                Mostrar más (quedan {count - shown})
              </button>
            )}
          </div>
          <div className="rounded pl-5">
            <Punct>{closeCh}</Punct>
            <Comma show={!last} />
          </div>
        </>
      )}
    </div>
  );
};

interface JsonViewProps {
  value: unknown;
  /** Niveles abiertos al inicio (el raíz es el nivel 0). */
  defaultDepth?: number;
  /** Controles flotantes (expandir, contraer, copiar) que aparecen al pasar el ratón. */
  toolbar?: boolean;
  className?: string;
}

const TOOL_BTN =
  "rounded px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-white cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60";

export const JsonView: React.FC<JsonViewProps> = ({ value, defaultDepth = 3, toolbar = true, className = "" }) => {
  // Al cambiar `tick` se vuelve a montar el árbol con la nueva profundidad.
  const [mode, setMode] = useState({ depth: defaultDepth, tick: 0 });
  return (
    <div className={`group/json relative font-mono text-[13px] leading-6 text-slate-300 ${className}`}>
      {toolbar && isContainer(value) && (
        <div className="absolute right-0 top-0 z-10 flex items-center gap-0.5 rounded-md border border-slate-800 bg-slate-900/95 p-0.5 opacity-0 transition-opacity group-hover/json:opacity-100 focus-within:opacity-100">
          <button type="button" className={TOOL_BTN} onClick={() => setMode((m) => ({ depth: Infinity, tick: m.tick + 1 }))}>
            Expandir todo
          </button>
          <button type="button" className={TOOL_BTN} onClick={() => setMode((m) => ({ depth: 1, tick: m.tick + 1 }))}>
            Contraer todo
          </button>
          <CopyButton text={() => stringify(value)} title="Copiar JSON" iconSize="w-3.5 h-3.5" className={COPY_CLASS} />
        </div>
      )}
      <Node key={mode.tick} value={value} depth={0} last defaultDepth={mode.depth} />
    </div>
  );
};

/** Muestra texto JSON con `JsonView`; si no es JSON válido, lo muestra como texto plano. */
export const JsonText: React.FC<Omit<JsonViewProps, "value"> & { text: string }> = ({ text, ...rest }) => {
  const parsed = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(text) as unknown };
    } catch {
      return { ok: false as const };
    }
  }, [text]);

  if (!parsed.ok) {
    return (
      <pre
        className={`whitespace-pre-wrap break-words font-mono text-[13px] leading-6 text-slate-300 ${rest.className ?? ""}`}
      >
        {text}
      </pre>
    );
  }
  return <JsonView value={parsed.value} {...rest} />;
};