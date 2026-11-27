/**
 * JARVIS Core — Dependencias entre los ítems de la lista del reactivo.
 *
 * Tras un ítem fallido, el modelo de pendientes suele devolver la lista sin ese ítem y siguiendo con los de atrás. Antes el código cerraba la tarea en ese caso
 * (`skips_failed_item`): decidía por parecido de palabras si los de atrás podían depender del fallido, y ante la duda cerraba, con lo cual un ítem que no se
 * podía hacer (por ejemplo, un archivo en una carpeta protegida) se llevaba puesto el resto del pedido. Acá la dependencia la juzga Decisión con una pregunta `noul`
 * por ítem («¿B necesita el resultado de A?»): los independientes siguen y el fallido se difiere detrás de ellos (`ReactiveList.deferFailed`), una sola vez; los que sí lo
 * necesitan quedan detrás de él. Si el fallido vuelve a fallar, o todos los de atrás dependen de él, se cierra como siempre (`partial` si algo se logró).
 *
 * Solo suma continuidad: si el modelo de decisión no lo implementa, falla o responde mal, no hay veredicto y rige el cierre de antes.
 */

import { clip } from "../utils.ts";
import type { EngineEnv } from "./env.ts";

/** Desde esta probabilidad un ítem se toma como dependiente (medido: los independientes dan 0,00 a 0,06 y los dependientes 0,98 a 1,00). */
const DEPENDS_MIN = 0.5;
/** Ítems de atrás que se preguntan por consulta; los demás se toman como dependientes (ante la duda, quedan detrás del fallido). */
const MAX_DEPENDENCY_ITEMS = 8;

/**
 * Para cada ítem de `later`, si necesita el resultado de `failed`; `null` si no hay veredicto (decision no lo implementa o falló). Es una exigencia opcional: un fallo
 * del modelo no pausa la tarea.
 */
export async function dependentsOf(env: EngineEnv, failed: string, later: readonly string[]): Promise<boolean[] | null> {
  const { ctx, runtime } = env;
  const check = env.decision.checkDependencies;
  if (check === undefined || later.length === 0) return null;
  const asked = later.slice(0, MAX_DEPENDENCY_ITEMS);
  try {
    const { dependent } = await check({ request: clip(ctx.task.request.replace(/\s+/g, " ").trim(), 600), blocked: failed, items: asked }, runtime.signal);
    if (dependent.length !== asked.length) return null;
    return [...dependent.map((p) => p >= DEPENDS_MIN), ...later.slice(asked.length).map(() => true)];
  } catch (error) {
    if (!runtime.cancelled) console.warn(`[Engine] dependencias entre ítems no disponibles (${error instanceof Error ? error.message : String(error)}); se cierra como siempre.`);
    return null;
  }
}
