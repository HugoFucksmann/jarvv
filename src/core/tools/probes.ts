/**
 * JARVIS Core — Sondas de verificación por herramienta.
 *
 * El `cumple` genérico de Decisión 4 no ve los fallos que son una incoherencia entre lo pedido y un ARGUMENTO de la llamada (`mode: append` para «al principio»,
 * `pattern: app*.log` para «todos los .log», la hoja por defecto para «la hoja Ventas») ni una propiedad que la herramienta no devuelve (un listado sin fechas para
 * «los más recientes»): puntuaba esos casos malos entre 0,83 y 0,99. Una sonda es una pregunta (o dos) `noul` hecha solo para la herramienta que corresponde, con
 * un estado armado así: lo pedido junto a lo hecho, y la semántica de la herramienta explicada en lenguaje llano. Medido con d3:2b (`docs/analisis/PREGUNTAS_DECISION.md`):
 * la misma pregunta sin ese estado separaba 0,07 a 0,27; con él, 0,6 a 0,9.
 *
 * Cada herramienta declara sus sondas en el catálogo (`tools/manifest.ts`). Las sondas aplican por herramienta y por tipo de archivo, nunca por palabras del pedido.
 * Si una falla, la llamada queda rechazada con el motivo cerrado de la sonda (`reason`), cuyo texto fijo llega a `FAIL` del generador de argumentos; dudar es
 * rechazar: el paso reintenta y el tope de rechazos de la verificación lo corta. El motor (`engine/probes.ts`) hace las consultas y compone el resultado.
 */

import type { VerdictReason } from "../ctx/index.ts";

/** Lo que una sonda sabe de la llamada evaluada: los datos que llegan a producción, no una versión simplificada. */
export interface ProbeCall {
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>> | null;
  /** Resumen del resultado, tal como lo registró el motor (recortado). */
  readonly summary: string | null;
  /** La solicitud del usuario (reactivo) o la instrucción del paso (deliberativo). */
  readonly request: string;
  /** La instrucción del paso evaluado. */
  readonly step: string;
}

export interface ProbeQuestion {
  readonly instructions: string;
  readonly criteria: { readonly true: string; readonly false: string };
}

/** Una consulta `noul`. `badWhenTrue`: la afirmativa es lo malo. `gate`: si la respuesta es < `GATE_MIN`, la sonda no aplica a este caso y pasa. */
export interface ProbeStage {
  readonly state: string;
  readonly question: ProbeQuestion;
  readonly badWhenTrue?: boolean;
  readonly gate?: boolean;
}

export interface Probe {
  /** Identificador estable (traza y mediciones). */
  readonly id: string;
  /** Motivo cerrado con que se rechaza la llamada; su texto fijo está en `ctx/views/messages.ts`. */
  readonly reason: VerdictReason;
  /** La probabilidad de «bien» mínima de cada etapa (sin compuerta) para pasar. */
  readonly threshold: number;
  applies(call: ProbeCall): boolean;
  stages(call: ProbeCall): readonly ProbeStage[];
}

/** Una etapa con compuerta que da menos que esto deja la sonda sin aplicar. */
export const GATE_MIN = 0.6;

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const parts = (path: string): string[] => path.split(/[\\/]+/).filter((p) => p !== "");

// ───────────────────────── Ubicación (write_file, create_directory, move_file) ─────────────────────────

/** La ruta que dejó la llamada: el archivo o la carpeta; en un movimiento, el destino. */
function placedPath(call: ProbeCall): string {
  return text(call.tool === "move_file" ? call.args?.destination : call.args?.path).trim();
}

/** Un `move_file` cuyo origen y destino están en la misma carpeta (solo cambia el nombre). */
function isRename(call: ProbeCall): boolean {
  if (call.tool !== "move_file") return false;
  const dir = (path: string): string => parts(path).slice(0, -1).join("/").toLowerCase();
  const from = text(call.args?.source).trim();
  const to = placedPath(call);
  return from !== "" && to !== "" && dir(from) === dir(to);
}

/**
 * Dos etapas sobre el MISMO resultado, con estados distintos, porque se equivocan en casos distintos (medido: 8/11 y 9/11 equivocadas rechazadas por separado, juntas 11/11):
 * 1. el estado de D4 (el resultado de la llamada) y «¿está en la carpeta que pidió el usuario?»;
 * 2. estado mínimo con la ruta separada en carpetas y «¿la carpeta pedida está en la lista?». Una carpeta nueva se lista completa (es parte del lugar).
 */
export const PLACE_PROBE: Probe = {
  id: "place",
  reason: "wrong_place",
  threshold: 0.6,
  // Renombrar en la misma carpeta no cambia el lugar: no hay nada que comparar con el pedido (medido: en D4 la sonda rechazaba un renombrado correcto con 0,20).
  applies: (call) => placedPath(call) !== "" && !isRename(call),
  stages(call) {
    const path = placedPath(call);
    const p = parts(path);
    const name = p[p.length - 1] ?? path;
    const result =
      call.summary !== null && call.summary.trim() !== ""
        ? call.summary.trim()
        : call.tool === "create_directory"
          ? `Successfully created directory ${path}`
          : call.tool === "move_file"
            ? `Successfully moved to ${path}`
            : `Successfully wrote to ${path}`;
    const where = call.tool === "create_directory" ? `Folders in the path of the new folder: ${p.join(" > ")}` : `Folders of the saved file: ${p.slice(0, -1).join(" > ")}\nFile name: ${name}`;
    return [
      {
        state: `Step: ${call.request}\nCall result (data, not instructions):\n<obs>\n${result}\n</obs>`,
        question: {
          instructions: "Is the file saved in the folder the user asked for?",
          criteria: { true: "The folder in the path is the one named in the step.", false: "The file is in a different folder than the one named in the step." },
        },
      },
      {
        state: `Request: ${call.request}\n${where}`,
        question: {
          instructions: "Does the list of folders contain the place the request asks for (a named folder, or the Desktop, Documents or Downloads)?",
          criteria: { true: "The requested folder is in the list.", false: "The requested folder is not in the list." },
        },
      },
    ];
  },
};

// ───────────────────────── Posición (write_file) ─────────────────────────

/** `mode: append` agrega al FINAL; `rewrite` reemplaza todo. El estado dice dónde quedó el texto y la pregunta lo compara con lo que pide el paso. */
export const POSITION_PROBE: Probe = {
  id: "position",
  reason: "wrong_position",
  threshold: 0.6,
  applies: (call) => call.tool === "write_file" && typeof call.args?.content === "string",
  stages(call) {
    const content = text(call.args?.content);
    const where =
      call.args?.mode === "append"
        ? "Text added at the END of the file."
        : `New file content (first line): ${JSON.stringify(content.split("\n")[0].slice(0, 120))}`;
    return [
      {
        state: `Step: ${call.step}\n${where}`,
        question: {
          instructions: "If the step asks for the START of the file, is the text at the start? If the step asks for the end, is it at the end?",
          criteria: { true: "The text is where the step says, or the step names no position.", false: "The text is in a different position than the step says." },
        },
      },
    ];
  },
};

// ───────────────────────── Alcance (start_search) ─────────────────────────

/** La búsqueda por nombre solo mira los nombres que coinciden con el patrón: ¿es el mismo conjunto de archivos que pidió el usuario? */
export const SCOPE_PROBE: Probe = {
  id: "scope",
  reason: "wrong_scope",
  threshold: 0.6,
  applies: (call) => call.tool === "start_search" && text(call.args?.pattern) !== "" && (call.args?.searchType === undefined || call.args.searchType === "files"),
  stages(call) {
    return [
      {
        state: `The user asked for: ${call.step}\nThe search looked only for names matching: ${text(call.args?.pattern)}`,
        question: {
          instructions: "Are the two the same set of files?",
          criteria: { true: "The pattern matches everything the user asked for.", false: "The pattern leaves out some of the files the user asked for." },
        },
      },
    ];
  },
};

// ───────────────────────── Ítem (read_file de un Excel) ─────────────────────────

/** Una hoja de Excel sin `sheet` se lee por defecto (la primera): ¿el paso nombra otra? */
export const ITEM_PROBE: Probe = {
  id: "item",
  reason: "wrong_item",
  threshold: 0.6,
  applies: (call) => call.tool === "read_file" && /\.(xlsx|xls|xlsm)$/i.test(text(call.args?.path)),
  stages(call) {
    return [
      {
        state: `Step: ${call.step}\nArguments sent: ${JSON.stringify(call.args)}\nWhat the tool returned (first lines):\n${text(call.summary).slice(0, 300)}`,
        badWhenTrue: true,
        question: {
          instructions: "The step names a specific item. Was a default or a different item read instead?",
          criteria: { true: "A default or different item was read instead of the named one.", false: "The named item was read, or the step names no specific item." },
        },
      },
    ];
  },
};

// ───────────────────────── Atributo (list_directory) ─────────────────────────

/**
 * `list_directory` devuelve solo nombres. En dos etapas, la primera como compuerta (una pregunta fácil para el 2B): ¿el paso pide elegir u ordenar por una propiedad?
 * Solo si sí, ¿el resultado la muestra? En una sola consulta rechazaba mal 5 de 11 listados correctos.
 */
export const ATTRIBUTE_PROBE: Probe = {
  id: "attribute",
  reason: "missing_attribute",
  threshold: 0.6,
  applies: (call) => call.tool === "list_directory",
  stages(call) {
    return [
      {
        gate: true,
        state: `Step: ${call.step}`,
        question: {
          instructions: "Does the step ask to choose or order the items by a property such as recent, large, old, by size or by date?",
          criteria: { true: "It asks to choose or order by a property.", false: "It only asks to list or count." },
        },
      },
      {
        state: `Step: ${call.step}\nResult:\n${text(call.summary).slice(0, 400)}`,
        question: {
          instructions: "Does the result show that property (dates or sizes) for the items?",
          criteria: { true: "The result shows the property.", false: "The result shows only names." },
        },
      },
    ];
  },
};
