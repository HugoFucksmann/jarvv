/**
 * eval/psvalid.ts — De una corrida del eval con la etapa `arguments`, cuántos comandos generados son PowerShell válido.
 *
 * Uso: npm run eval:psvalid -- eval/results/<modelo>/<corrida>
 *
 * Por cada `<variante>__<dataset>/runs.jsonl`, toma el `command` de cada salida y lo pasa por el analizador del pre-chequeo
 * (parser oficial de PowerShell y `Get-Command`): válido = sin errores de sintaxis y con todos los comandos existentes.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { analyzePowerShell } from "../src/core/engine/precheck.ts";

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (dir === undefined) throw new Error("Uso: npm run eval:psvalid -- <carpeta de la corrida>");
  const cache = new Map<string, boolean>();
  const valid = async (command: string): Promise<boolean> => {
    let v = cache.get(command);
    if (v === undefined) {
      const report = await analyzePowerShell(command);
      v = report !== null && report.syntaxErrors.length === 0 && report.commands.every((c) => c.kind !== "None");
      cache.set(command, v);
    }
    return v;
  };
  console.log("| Variante | Dataset | Comandos | PowerShell válido |");
  console.log("|---|---|---|---|");
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name, "runs.jsonl");
    if (!entry.isDirectory() || !entry.name.includes("__") || !existsSync(file)) continue;
    const i = entry.name.lastIndexOf("__");
    let n = 0;
    let ok = 0;
    for (const line of readFileSync(file, "utf8").split(String.fromCharCode(10))) {
      if (line.trim() === "") continue;
      const r = JSON.parse(line) as { stage: string; parsedOutput?: { args?: { command?: unknown } } };
      const command = r.stage === "arguments" ? r.parsedOutput?.args?.command : undefined;
      if (typeof command !== "string") continue;
      n++;
      if (await valid(command)) ok++;
    }
    if (n > 0) console.log(`| ${entry.name.slice(0, i)} | ${entry.name.slice(i + 2)} | ${n} | ${((100 * ok) / n).toFixed(0)} % (${ok}/${n}) |`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
