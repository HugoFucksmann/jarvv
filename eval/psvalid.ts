/**
 * eval/psvalid.ts — De una corrida del eval con la etapa `arguments`, cuántos comandos generados son PowerShell válido.
 *
 * Uso: npm run eval:psvalid -- eval/results/<modelo>/<corrida>
 *
 * Por cada `<variante>__<dataset>/runs.jsonl`, toma el `command` de cada salida y lo pasa por el analizador del pre-chequeo
 * (parser oficial de PowerShell y `Get-Command`): válido = sin errores de sintaxis y con todos los comandos existentes.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { analyzePowerShell } from "./core/contract.ts";
import { forEachJsonlLineAsync } from "./core/io.ts";

function printUsage(): void {
  console.log("Uso: npm run eval:psvalid -- <carpeta de la corrida>");
  console.log("");
  console.log("Analiza los comandos generados en <variante>__<dataset>/runs.jsonl para la etapa 'arguments'");
  console.log("usando el analizador de PowerShell del pre-chequeo de producción.");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }
  const dir = args[0];
  if (dir === undefined) throw new Error("Uso: npm run eval:psvalid -- <carpeta de la corrida>");
  if (!existsSync(dir)) throw new Error(`No existe la carpeta '${dir}'.`);
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
    await forEachJsonlLineAsync(file, async (line) => {
      if (line.trim() === "") return;
      let r: { stage: string; parsedOutput?: { args?: { command?: unknown } } };
      try {
        r = JSON.parse(line) as { stage: string; parsedOutput?: { args?: { command?: unknown } } };
      } catch {
        return;
      }
      const command = r.stage === "arguments" ? r.parsedOutput?.args?.command : undefined;
      if (typeof command !== "string") return;
      n++;
      if (await valid(command)) ok++;
    });
    if (n > 0) console.log(`| ${entry.name.slice(0, i)} | ${entry.name.slice(i + 2)} | ${n} | ${((100 * ok) / n).toFixed(0)} % (${ok}/${n}) |`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
