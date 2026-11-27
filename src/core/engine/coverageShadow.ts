/**
 * JARVIS Core — Cobertura de la primera lista de pendientes, en modo sombra.
 *
 * La lista de pendientes la arma el modelo generativo, y a veces junta varias partes del pedido en un ítem y pierde una: «crea un md y recopila toda la información» quedó
 * como «crear un md con información», sin ningún paso que busque, y el contenido salió de la imaginación del modelo. Nadie lo verifica. Acá, con la primera lista ya
 * aceptada, se le pregunta a Decisión si la lista cubre todo lo que pide la solicitud (`covers`, una pregunta `noul`) y se REGISTRA la respuesta en la traza (etapa
 * `coverage`) y en el log; **no cambia la lista, los contadores ni el contexto**, nunca lanza y no pausa si Decisión no responde. Guarda el valor en `env.state.listCoverage`:
 * lo lee `confirmCompletion` (`completion.ts`), que es quien decide con él cuándo la lista cubierta y cumplida cierra la tarea sin consultar a Decisión 5.
 *
 * Medido con 417 listas de verdad conocida (`eval/exp/list_coverage.ts`: 132 completas y 285 con un ítem menos), la probabilidad de `covers` se satura cerca de 1: con 0,75 a 0,80
 * acepta 60 % de las listas a las que les falta una parte; con 0,99, 7 %.
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
    env.state.listCoverage = covers;
    if (covers < COVERAGE_LOW) console.warn(`[Engine] cobertura de la lista ${covers.toFixed(2)} (< ${COVERAGE_LOW}): puede faltar una parte del pedido. Lista: ${clip(list.join(" | "), 200)}`);
  } catch {
    // modo sombra: un fallo no cambia nada
  }
}
