/**
 * eval/gen/ram_real.ts — La falla real de la corrida "lista las 10 tareas que mas ram esten consumiendo": qwen3.5:4b escribía
 * una propiedad calculada inválida (`Sort-Object @{Get-Member -Name 'WorkingSet64' …}`) y la repetía en cada intento.
 *
 * Uso: npx tsx eval/gen/ram_real.ts → escribe eval/datasets/ram_real.jsonl
 *
 * Cuatro casos de `arguments`: dos instrucciones (la de la traza y una directa), cada una en el primer intento y tras un intento
 * rechazado con la razón del pre-chequeo. El grader fija solo lo prohibido; si el comando es PowerShell válido lo mide
 * `npm run eval:psvalid` (parser oficial), porque el grader de `arguments` no sabe de sintaxis.
 */

import { writeFileSync } from "node:fs";

const SCHEMA = { type: "object", properties: { command: { type: "string" }, timeout_ms: { type: "number" } }, required: ["command"] };
const BAD = "Get-Process | Sort-Object @{Get-Member -Name 'WorkingSet64' -MemberType NoteProperty} -Descending | Select-Object -First 10 Name";
const REASON = "The command has a PowerShell syntax error: Missing '=' operator after key in hash literal.";

const lines = ["# La falla real de los 10 procesos con más RAM (generado por eval/gen/ram_real.ts; no editar a mano)."];
for (const [slug, request, instruction] of [
  ["traza", "lista las 10 tareas que mas ram esten consumiendo", "Obtener la lista de las 10 tareas que más RAM están consumiendo"],
  ["directa", "lista los 10 procesos que más RAM consumen", "listar los 10 procesos con más consumo de RAM"],
] as const) {
  for (const retry of [false, true]) {
    lines.push(
      JSON.stringify({
        id: `ram-${slug}-${retry ? "tras-rechazo" : "primer-intento"}`,
        stage: "arguments",
        tags: ["escenario", "arguments", "ram_real", retry ? "tras_rechazo" : "primer_intento"],
        description: `${instruction} (${retry ? "tras un intento rechazado por sintaxis" : "primer intento"})`,
        scenario: {
          mode: "reactive",
          request,
          steps: [{ state: "running", instruction }],
          ...(retry ? { calls: [{ route: "terminal", tool: "run_command", kind: "write", status: "args_invalid", step: 0, args: { command: BAD, timeout_ms: 5000 }, summary: REASON }] } : {}),
          at: { route: "terminal", tool: "run_command", inputSchema: SCHEMA },
        },
        expect: { requiredFields: ["command"], forbiddenHardcodedValues: ["@{Get-Member", "ps aux", "top -"] },
      }),
    );
  }
}
writeFileSync("eval/datasets/ram_real.jsonl", `${lines.join("\n")}\n`);
console.log("4 casos → eval/datasets/ram_real.jsonl");
