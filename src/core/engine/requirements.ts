/**
 * JARVIS Core — Libro de requisitos del cierre del reactivo.
 *
 * Decisión 5 compara toda la solicitud con el registro de lo hecho y devuelve un solo número: dice que falta algo, pero no qué, y con varias búsquedas más un archivo
 * ve «hecho» donde el archivo todavía no tiene lo buscado. El libro fija los requisitos de la solicitud al empezar (la primera lista de pendientes) y, al cierre, pregunta
 * por cada uno, sobre un texto concreto, tres cosas en una sola consulta (`DECISION_PROMPTS.buildRequirementsCheck`): de qué tipo es (`choice`), si las lecturas traen
 * información real de él (`noul`) y cuánto de él llegó al entregable (`score`). Con eso el hueco tiene nombre y un próximo paso que sale de una plantilla, no del modelo:
 *
 *   pide información y las lecturas no la traen → se vuelve a buscar ese requisito
 *   las lecturas la traen y el entregable no la tiene → se agrega al entregable
 *   es una acción sin búsqueda → no se juzga acá (queda para Decisión 5)
 *
 * Solo suma exigencia: nunca cierra una tarea, y cada reapertura cuenta contra `MAX_REOPENS`. Si el modelo de decisión no lo implementa, falla o responde mal, no hay huecos.
 */

import type { RequirementsDecisionInput, RequirementVerdict } from "../contracts.ts";
import type { TaskContext } from "../ctx/index.ts";
import type { DiskView } from "../types/disk.ts";
import { artifactsOf, ARTIFACT_SEPARATOR, sectionDigest } from "./artifacts.ts";
import type { EngineEnv } from "./env.ts";
import { REAL_DISK } from "./postcondition.ts";
import { clip } from "../utils.ts";

/** Requisitos que se preguntan por consulta (3 preguntas por requisito). */
const MAX_REQUIREMENTS = 6;
/** Huecos que se convierten en pasos por reapertura. */
const MAX_GAPS_PER_REOPEN = 3;
/** Desde esta probabilidad de `info` el requisito pide información; por debajo es una acción y no se juzga. */
export const INFO_MIN = 0.5;
/** Probabilidad mínima de que las lecturas traigan información del requisito. */
export const GATHERED_MIN = 0.5;
/** Masa mínima de los niveles altos del `score` del entregable. Sin medir todavía: se ajusta con `eval`. */
export const DELIVERED_MIN = 0.5;

const MAX_READS = 6;
const flat = (s: string): string => s.replace(/\s+/g, " ").trim();

interface RequirementGap {
  readonly kind: "gather" | "deliver";
  /** El paso que cierra el hueco (la instrucción de un ítem de la lista). */
  readonly item: string;
}

/** El paso que agrega a un entregable lo que falta de un requisito. */
export const deliverItem = (requirement: string, deliverable: string): string =>
  `Add to the file ${deliverable} the information found about: ${requirement}. Keep the existing content and write only what is missing.`;

/** Los huecos de los requisitos según lo que dijo el modelo: primero los de buscar (habilitan a los de entregar), luego los de entregar. */
export function gapsOf(requirements: readonly string[], verdicts: readonly RequirementVerdict[], deliverable: string | null): RequirementGap[] {
  const gather: RequirementGap[] = [];
  const deliver: RequirementGap[] = [];
  requirements.forEach((requirement, i) => {
    const v = verdicts[i];
    if (v === undefined || v.info < INFO_MIN) return;
    if (v.gathered < GATHERED_MIN) gather.push({ kind: "gather", item: requirement });
    else if (deliverable !== null && v.delivered !== null && v.delivered < DELIVERED_MIN) deliver.push({ kind: "deliver", item: deliverItem(requirement, deliverable) });
  });
  return [...gather, ...deliver];
}

/** Lo que se lee del entregable al preguntar (el archivo como está en ese momento). */
const DELIVERABLE_READ_BYTES = 256 * 1024;

/** El entregable para las preguntas: sus secciones con su contenido, leído del disco ahora; si no se puede leer, el esbozo que quedó en el hecho. */
function deliverableText(ctx: TaskContext, deliverable: string, disk: DiskView): string {
  try {
    const text = disk.readText?.(deliverable, DELIVERABLE_READ_BYTES);
    if (text !== undefined && text !== null) return `${deliverable}${ARTIFACT_SEPARATOR}${sectionDigest(text, disk.size(deliverable))}`;
  } catch {
    // sin lectura: rige el esbozo del hecho
  }
  return artifactsOf(ctx).find((a) => a.file === deliverable)?.value ?? deliverable;
}

/** Lo que traen las lecturas, una línea por lectura (las últimas): herramienta, argumentos y el comienzo del resumen. */
function readsText(ctx: TaskContext): string {
  const reads = ctx
    .find("calls", {})
    .filter((c) => c.kind === "read" && c.status === "ok" && c.verdict !== "rejected" && c.summary !== null)
    .slice(-MAX_READS)
    .map((c) => `- ${c.tool} ${clip(JSON.stringify(c.args ?? {}), 120)} => ${clip(flat(c.summary ?? ""), 350)}`);
  return reads.length > 0 ? reads.join("\n") : "(none)";
}

/**
 * La evidencia de cada pregunta, separada: la solicitud, lo que trajeron las lecturas y el estado del entregable. El estado de un archivo cuesta lo mismo que cualquier
 * texto repetido por cada pregunta del servidor: por eso cada consulta lleva solo el suyo.
 */
function requirementsInput(ctx: TaskContext, requirements: readonly string[], deliverable: string | null, disk: DiskView = REAL_DISK): RequirementsDecisionInput {
  return {
    requirements,
    request: clip(flat(ctx.task.request), 600),
    reads: readsText(ctx),
    deliverable: deliverable === null ? null : deliverableText(ctx, deliverable, disk),
  };
}

/**
 * Los pasos que cierran los huecos de los requisitos, o vacío si no hay huecos (o no se pudo preguntar). `requirements` son los de la primera lista de pendientes.
 * Es una exigencia extra y opcional: un fallo del modelo (o un desborde) no pausa ni cierra la tarea, y sin ella rige Decisión 5 como siempre.
 */
export async function findRequirementGaps(env: EngineEnv, requirements: readonly string[]): Promise<readonly string[]> {
  const { ctx, runtime } = env;
  const check = env.decision.checkRequirements;
  if (check === undefined || requirements.length < 2) return [];
  const asked = requirements.slice(0, MAX_REQUIREMENTS);
  const deliverable = artifactsOf(ctx).find((a) => !a.value.includes(`${ARTIFACT_SEPARATOR}folder, `))?.file ?? null;
  const input = requirementsInput(ctx, asked, deliverable, env.deps.disk ?? REAL_DISK);

  let items: readonly RequirementVerdict[];
  try {
    items = (await check(input, runtime.signal)).items;
  } catch (error) {
    if (!runtime.cancelled) console.warn(`[Engine] libro de requisitos no disponible (${error instanceof Error ? error.message : String(error)}); rige Decisión 5.`);
    return [];
  }
  if (runtime.cancelled || ctx.isClosed()) return [];
  const gaps = gapsOf(asked, items, deliverable).slice(0, MAX_GAPS_PER_REOPEN);
  if (gaps.length > 0) console.warn(`[Engine] libro de requisitos: faltan ${gaps.map((g) => `${g.kind} «${clip(g.item, 60)}»`).join("; ")}.`);
  return gaps.map((g) => g.item);
}
