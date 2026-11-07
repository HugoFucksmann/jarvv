/**
 * eval/gen/verificacion_vieja.ts — Convierte los datasets de verificación de las pruebas viejas (rama `main`,
 * `scripts/eval/decision/datasets/dataset_v2.jsonl` y `dataset_v3.jsonl`, 106 casos en pares bueno/malo) a casos por escenario
 * de `result_verification`.
 *
 * Uso: npx tsx eval/gen/verificacion_vieja.ts → escribe eval/datasets/old_verificacion.jsonl
 *
 * Conversión: instrucción del paso = `instruction`; una llamada ejecutada (`status: ok`) con `args` y el `observation` como
 * resumen. Etiquetas: `matches` → ok y cumple; `failed` → ni ok ni cumple; el resto (target o contenido equivocado, parcial,
 * sin confirmar) → ok pero no cumple. Se descartan los `failed` con texto de error explícito (en producción serían
 * `tool_error` y no se le preguntan al modelo) y las herramientas que no tienen ruta.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

interface Old {
  id: string;
  pair: string;
  category: string;
  tool: string;
  kind: "read" | "mutation";
  instruction: string;
  args: Record<string, unknown>;
  observation: string;
  gold_post: string;
  notes?: string;
}

const ROUTES: Record<string, { route: string; tool: string }> = {
  read_file: { route: "files", tool: "read_file" },
  write_file: { route: "files", tool: "write_file" },
  create_directory: { route: "files", tool: "create_directory" },
  move_file: { route: "files", tool: "move_file" },
  delete_file: { route: "files", tool: "delete_file" },
  copy_file: { route: "files", tool: "copy_file" },
  replace_in_file: { route: "files", tool: "replace_in_file" },
  run_command: { route: "terminal", tool: "start_process" },
  start_process: { route: "terminal", tool: "start_process" },
  kill_process: { route: "terminal", tool: "start_process" },
  search_files: { route: "locate", tool: "start_search" },
  search: { route: "locate", tool: "start_search" },
};

/** El contexto limita el resumen de una llamada a 2500 caracteres: se conserva el principio y el final. */
function clip(text: string): string {
  return text.length <= 2400 ? text : `${text.slice(0, 800)}
[…]
${text.slice(-1500)}`;
}

function load(name: string): Old[] {
  const text = execFileSync("git", ["show", `main:scripts/eval/decision/datasets/${name}.jsonl`], { encoding: "utf8", maxBuffer: 20_000_000 });
  return text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Old);
}

const out: string[] = [
  "# Verificación de las pruebas viejas (generado por eval/gen/verificacion_vieja.ts desde dataset_v2/v3 de la rama main; no editar a mano).",
  "# Pares bueno/malo por `meta.pair`. Etiquetas convertidas: ver la cabecera del generador.",
];
let kept = 0;
let dropped = 0;
for (const ds of ["dataset_v2", "dataset_v3"] as const) {
  for (const c of load(ds)) {
    const mapped = ROUTES[c.tool];
    const explicitError = /^\s*(error|exception|eperm|enoent)/i.test(c.observation);
    if (mapped === undefined || (c.gold_post === "failed" && explicitError)) {
      dropped++;
      continue;
    }
    const matches = c.gold_post === "matches";
    const failed = c.gold_post === "failed";
    out.push(
      JSON.stringify({
        id: `old-${ds.slice(-2)}-${c.id}`,
        stage: "result_verification",
        tags: ["escenario", "result_verification", "viejo", ds.slice(-2), c.category, matches ? "control" : `mal:${c.gold_post}`],
        description: c.notes ?? `Caso ${c.id} (${c.category}).`,
        scenario: {
          mode: "reactive",
          request: c.instruction,
          steps: [{ state: "running", instruction: c.instruction }],
          calls: [{ ...mapped, kind: c.kind === "mutation" ? "write" : "read", status: "ok", args: c.args, summary: clip(c.observation) }],
        },
        expect: { expectedOk: !failed, expectedCumple: matches },
        meta: { pair: `${ds}-${c.pair}`, gold: c.gold_post },
      }),
    );
    kept++;
  }
}
writeFileSync("eval/datasets/old_verificacion.jsonl", `${out.join("\n")}\n`);
console.log(`${kept} casos escritos, ${dropped} descartados → eval/datasets/old_verificacion.jsonl`);
