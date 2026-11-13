/**
 * eval/core/graders/pending.ts
 *
 * Grader de la etapa PENDING: la lista de pendientes del reactivo. El primer pendiente es la instrucción del paso; la lista
 * vacía significa que no queda nada por hacer.
 */

import type { Grader, PendingExpect, PendingOutput } from "../types.ts";
import { containsTerm, norm } from "./common.ts";

const KINDS = ["search", "read", "write", "execute", "other"];
const FIELDS = ["kind", "goal", "done_when"];

/** Nombres de herramientas de Jarvis y comandos de shell frecuentes; `goal` describe el qué, nunca el cómo. */
const TOOL_OR_COMMAND =
  /\b(read_file|read_multiple_files|write_file|list_directory|start_search|run_command|web_search|move_file|create_directory|ask_user)\b|\b[A-Z][a-z]+-[A-Z][A-Za-z]+\b|`|\b(mkdir|rmdir|powershell|cmd\.exe|curl|wget|npm|npx|git|grep|sudo|chmod)\b|\$\(|\s\|\s|\bdu -|\bls -/;

/** Sustantivos y adjetivos en -ar/-er/-ir que no son infinitivos. */
const NOT_VERB = new Set(["primer", "tercer", "mujer", "lugar", "hogar", "taller", "cualquier", "particular", "regular", "similar", "familiar", "titular", "mar", "ayer"]);

/** ¿La frase empieza con un verbo en infinitivo ("Buscar…", "Guardar…")? */
function startsWithInfinitive(text: string): boolean {
  const first = norm(text).split(/[^\p{L}]+/u).find((w) => w !== "") ?? "";
  return first.length >= 4 && /(ar|er|ir)$/.test(first) && !NOT_VERB.has(first);
}

const isQuestion = (text: string): boolean => /^¿/.test(text.trim()) || /\?\s*$/.test(text);

export const PendingGrader: Grader<PendingOutput, PendingExpect> = {
  name: "pending",
  grade(output, expect, _ctx, col) {
    if (!output || !Array.isArray(output.pending)) {
      col.check("valid_pending", false, "Salida no contiene una lista de pendientes válida.");
      return;
    }

    const list = output.pending;
    col.measure("pending_items", list.length);

    if (expect.expectEmpty !== undefined) {
      col.check(
        "empty_as_expected",
        (list.length === 0) === expect.expectEmpty,
        expect.expectEmpty
          ? `Se esperaba la lista vacía (nada por hacer) pero trae ${list.length} pendiente(s).`
          : "Se esperaba al menos un pendiente pero la lista vino vacía.",
      );
    }

    if (expect.maxItems !== undefined) {
      col.check(
        "max_items_met",
        list.length <= expect.maxItems,
        `La lista tiene ${list.length} pendientes, más que el máximo (${expect.maxItems}).`,
      );
    }

    const first = list[0] ?? "";
    (expect.requiredKeywordsInFirst ?? []).forEach((kw, i) => {
      col.check(
        `first_keyword_${i}`,
        containsTerm(first, kw),
        `El primer pendiente no contiene la palabra clave esperada: '${kw}'`,
      );
    });

    (expect.forbiddenKeywords ?? []).forEach((bad, i) => {
      col.check(
        `no_forbidden_${i}`,
        !list.some((item) => containsTerm(item, bad)),
        `Algún pendiente contiene la palabra prohibida: '${bad}'`,
      );
    });

    if (output.rich !== undefined) gradeRich(output.rich, col);
  },
};

/** Estructura y reglas de `kind`/`goal`/`done_when` de la variante con objetos. Los ítems sin `goal` se descartan de las reglas por ítem. */
function gradeRich(rich: unknown[], col: Parameters<typeof PendingGrader.grade>[3]): void {
  const isObj = (it: unknown): it is Record<string, unknown> => typeof it === "object" && it !== null && !Array.isArray(it);
  const text = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

  col.check(
    "items_are_objects",
    rich.every(isObj),
    "Algún pendiente no es un objeto con kind, goal y done_when.",
  );
  const objs = rich.filter(isObj);
  col.check(
    "item_fields_exact",
    objs.every((it) => Object.keys(it).join() === FIELDS.join()),
    `Cada pendiente debe traer exactamente ${FIELDS.join(", ")}, en ese orden y sin campos extra.`,
  );
  col.check("kind_valid", objs.every((it) => typeof it.kind === "string" && KINDS.includes(it.kind)), `'kind' debe ser uno de: ${KINDS.join(", ")}.`);
  col.check("done_when_present", objs.every((it) => text(it.done_when)), "Algún pendiente no trae 'done_when' (texto no vacío).");

  const withGoal = objs.filter((it) => text(it.goal));
  col.check(
    "goal_question_iff_search",
    withGoal.every((it) => isQuestion(it.goal as string) === (it.kind === "search")),
    "Si kind es 'search', 'goal' debe ser una pregunta; en los demás casos no.",
  );
  col.check(
    "done_when_not_action",
    withGoal.every((it) => !text(it.done_when) || !startsWithInfinitive(it.done_when as string)),
    "'done_when' no debe empezar con un verbo de acción en infinitivo: es una condición sobre el resultado.",
  );
  col.check(
    "goal_no_command_or_tool",
    withGoal.every((it) => !TOOL_OR_COMMAND.test(it.goal as string)),
    "'goal' no debe contener comandos ni nombres de herramientas.",
  );
}
