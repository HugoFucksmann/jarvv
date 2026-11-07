/**
 * eval/gen/ram_retry.ts — ¿Cómo mostrarle al LLM de argumentos un intento rechazado para que no lo copie?
 *
 * Uso: npx tsx eval/gen/ram_retry.ts → escribe eval/datasets/ram_retry_{a,b,c,d}.jsonl
 *
 * Hallazgo (`ram_real`): tras un intento rechazado por sintaxis, el modelo repite el mismo comando roto (0 de 20), aunque la línea
 * FAIL traiga la razón: el comando fallido aparece completo y el modelo lo copia. Cuatro formas de presentarlo, mismos casos:
 *   a  como hoy: comando completo + razón.
 *   b  sin el comando (args `null`) + razón.
 *   c  comando completo + razón + "reescribilo desde cero, sin copiar el anterior".
 *   d  sin el comando + razón + "reescribilo desde cero".
 * Se mide con la etapa `arguments` (el grader prohíbe el patrón roto) y `npm run eval:psvalid` (sintaxis válida).
 */

import { writeFileSync } from "node:fs";

const SCHEMA = { type: "object", properties: { command: { type: "string" }, timeout_ms: { type: "number" } }, required: ["command"] };
const BAD = "Get-Process | Sort-Object @{Get-Member -Name 'WorkingSet64' -MemberType NoteProperty} -Descending | Select-Object -First 10 Name";
const REASON = "The command has a PowerShell syntax error: Missing '=' operator after key in hash literal.";
const REWRITE = " Write the command again from scratch; do not copy the previous one.";

for (const [key, hideArgs, hint] of [["a", false, false], ["b", true, false], ["c", false, true], ["d", true, true]] as const) {
  const lines = [`# Intento rechazado mostrado en la forma '${key}' (generado por eval/gen/ram_retry.ts; no editar a mano).`];
  for (const [slug, request, instruction] of [
    ["traza", "lista las 10 tareas que mas ram esten consumiendo", "Obtener la lista de las 10 tareas que más RAM están consumiendo"],
    ["directa", "lista los 10 procesos que más RAM consumen", "listar los 10 procesos con más consumo de RAM"],
  ] as const) {
    lines.push(
      JSON.stringify({
        id: `retry-${key}-${slug}`,
        stage: "arguments",
        tags: ["escenario", "arguments", "ram_retry", `forma_${key}`],
        description: `${instruction} tras un intento rechazado (forma ${key}).`,
        scenario: {
          mode: "reactive",
          request,
          steps: [{ state: "running", instruction }],
          calls: [
            {
              route: "terminal",
              tool: "start_process",
              kind: "write",
              status: "args_invalid",
              step: 0,
              args: hideArgs ? null : { command: BAD, timeout_ms: 5000 },
              summary: REASON + (hint ? REWRITE : ""),
            },
          ],
          at: { route: "terminal", tool: "start_process", inputSchema: SCHEMA },
        },
        expect: { requiredFields: ["command"], forbiddenHardcodedValues: ["@{Get-Member", "ps aux", "top -"] },
      }),
    );
  }
  writeFileSync(`eval/datasets/ram_retry_${key}.jsonl`, `${lines.join("\n")}\n`);
}
console.log("2 casos × 4 formas → eval/datasets/ram_retry_{a,b,c,d}.jsonl");
