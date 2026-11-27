/**
 * JARVIS Core — Cobertura de la primera lista de pendientes, en modo sombra.
 *
 * La lista de pendientes la arma el modelo generativo, y a veces junta varias partes del pedido en un ítem y pierde una: «crea un md y recopila toda la información» quedó
 * como «crear un md con información», sin ningún paso que busque, y el contenido salió de la imaginación del modelo. Nadie lo verifica. Acá, con la primera lista ya
 * aceptada, se le pregunta a Decisión si la lista cubre todo lo que pide la solicitud (`covers`, una pregunta `noul`) y se REGISTRA la respuesta en la traza (etapa
 * `coverage`) y en el log; **no actúa**: no cambia la lista, los contadores, el contexto ni el cierre, nunca lanza y no pausa si Decisión no responde.
 *
 * Sirve para medir con tareas reales, antes de dejar que decida, si el corte (`COVERAGE_LOW`) separa las listas incompletas de las completas. Medido a mano con 7 listas de
 * trazas reales: las incompletas dieron 0,33 y 0,75 y las completas entre 0,97 y 1,00 (`scripts/validate/probe_coverage.ts`).
 */

import { clip } from "../utils.ts";
import type { EngineEnv } from "./env.ts";

/** Por debajo de esto la lista se marca en el log como posible pérdida de una parte del pedido. Solo informa. */
const COVERAGE_LOW = 0.9;

export async function shadowCoverage(env: EngineEnv, list: readonly string[]): Promise<void> {
  const { ctx, runtime } = env;
  const check = env.decision.checkCoverage;
  if (check === undefined || list.length === 0) return;
  try {
    const { covers } = await check({ request: ctx.task.request.replace(/\s+/g, " ").trim(), list }, runtime.signal);
    if (covers < COVERAGE_LOW) console.warn(`[Engine] cobertura de la lista ${covers.toFixed(2)} (< ${COVERAGE_LOW}): puede faltar una parte del pedido. Lista: ${clip(list.join(" | "), 200)}`);
  } catch {
    // modo sombra: un fallo no cambia nada
  }
}
