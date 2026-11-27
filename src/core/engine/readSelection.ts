/**
 * JARVIS Core — Qué lecturas previas ve el modelo de un paso.
 *
 * Las vistas de argumentos y de revisión muestran solo las últimas `BUDGET.caps.lastReads` (3) lecturas aprobadas, tengan o no relación con el paso. En una tarea con más
 * lecturas que esas, las más viejas desaparecen de la vista aunque el paso actual dependa de ellas: el modelo no ve el dato que necesita y inventa, repite o falla.
 *
 * Acá las lecturas se eligen por lo que el paso necesita y no por cuándo ocurrieron: una pregunta `noul` por lectura («¿trae información que este paso necesita?»,
 * `DECISION_PROMPTS.buildReadSelection`). La vista muestra las elegidas y, hasta completar el tamaño de siempre, las más recientes: lo de hoy queda como piso y solo se suma lo
 * relevante que quedaba fuera. Con tantas lecturas como caben (o menos) no se consulta nada.
 *
 * Es opcional: si el modelo de decisión no lo implementa, falla o responde mal, se muestran las últimas lecturas como siempre.
 */

import type { Call } from "../ctx/index.ts";
import { BUDGET } from "../budget.ts";
import { clip } from "../utils.ts";
import type { EngineEnv } from "./env.ts";

/** Desde esta probabilidad una lectura se toma como relevante para el paso (medido: la propia da 0,98 a 1,00; las demás, 0,01 a 0,55). */
const READ_RELEVANT_MIN = 0.5;
/** Lecturas candidatas que se preguntan (las más recientes): acota el tamaño de la consulta. */
const MAX_CANDIDATE_READS = 10;
const READ_TEXT_CHARS = 700;

const flat = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Las lecturas con datos de la tarea (aprobadas), de la más vieja a la más nueva. */
function approvedReads(calls: readonly Call[]): Call[] {
  return calls.filter((c) => c.kind === "read" && c.status === "ok" && c.verdict === "approved" && c.summary !== null);
}

/**
 * Las lecturas para un paso que escribe un texto compuesto con lo leído (`composesFromReads`): todas las de la tarea (las más recientes, hasta `readsForContent`) y sin consultar
 * a Decisión. La elección por relevancia no sirve acá: el paso dice «toda la información recopilada» sin nombrar temas, y todas las lecturas puntúan bajo (0,01 a 0,14 en la traza
 * del viaje). `undefined` si caben en la ventana de siempre.
 */
export function allReadIds(env: EngineEnv): readonly string[] | undefined {
  const all = approvedReads(env.ctx.find("calls", {}));
  if (all.length <= BUDGET.caps.lastReads) return undefined;
  return all.slice(-BUDGET.caps.readsForContent).map((c) => c.id);
}

/**
 * Los ids de las lecturas que debe ver el paso, en orden cronológico, o `undefined` si rige la ventana de siempre (pocas lecturas, sin consulta disponible o sin
 * veredicto). Nunca lanza ni pausa la tarea.
 */
export async function chooseReads(env: EngineEnv, step: string): Promise<readonly string[] | undefined> {
  const { ctx, runtime } = env;
  const select = env.decision.selectReads;
  const size = BUDGET.caps.lastReads;
  const all = approvedReads(ctx.find("calls", {}));
  if (select === undefined || all.length <= size || step.trim() === "") return undefined;

  const candidates = all.slice(-MAX_CANDIDATE_READS);
  let relevance: readonly number[];
  try {
    const input = {
      task: clip(flat(step), 600),
      reads: candidates.map((c) => ({ label: `${c.tool} ${clip(JSON.stringify(c.args ?? {}), 100)}`, text: clip(flat(c.summary ?? ""), READ_TEXT_CHARS) })),
    };
    relevance = (await select(input, runtime.signal)).relevance;
  } catch (error) {
    if (!runtime.cancelled) console.warn(`[Engine] elección de lecturas no disponible (${error instanceof Error ? error.message : String(error)}); se muestran las últimas.`);
    return undefined;
  }
  if (relevance.length !== candidates.length) return undefined;

  // Las relevantes (las de mayor probabilidad si son más de las que caben) y, hasta completar, las más recientes.
  const relevant = candidates
    .map((c, i) => ({ id: c.id, p: relevance[i] }))
    .filter((r) => r.p >= READ_RELEVANT_MIN)
    .sort((a, b) => b.p - a.p)
    .slice(0, size)
    .map((r) => r.id);
  const chosen = new Set(relevant);
  for (let i = all.length - 1; i >= 0 && chosen.size < size; i--) chosen.add(all[i].id);
  const ids = all.filter((c) => chosen.has(c.id)).map((c) => c.id);

  const recent = all.slice(-size).map((c) => c.id);
  if (ids.length !== recent.length || ids.some((id, i) => id !== recent[i])) console.warn(`[Engine] lecturas para «${clip(flat(step), 60)}»: ${ids.join(", ")} (por relevancia; la ventana de siempre: ${recent.join(", ")}).`);
  return ids;
}
