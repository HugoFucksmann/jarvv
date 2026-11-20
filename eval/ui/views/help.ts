/**
 * eval/ui/views/help.ts
 *
 * Vista de `--help`.
 */

import { box, c, kv, section, sym } from "../style.ts";

export function printHelp(): void {
  console.log();
  console.log(box([`${c.bold(c.cyan("Eval"))} ${c.gray("·")} ${c.bold("evaluación de modelos y variantes")}`], { color: c.violet }));

  section("Uso");
  console.log(`  ${c.bold("npm run eval -- [flags]")}`);

  section("Opciones");
  kv([
    ["--menu", "asistente interactivo: elige modelos, datasets, variantes, etapas y opciones, y ejecuta"],
    ["--auto", "bucle autónomo de optimización de prompts para una etapa (usa flags de eval:auto)"],
    ["--list", "muestra etapas, variantes y datasets disponibles"],
    ["--help, -h", "muestra esta ayuda"],
  ]);

  section("Ejemplos");
  console.log(`  ${sym.bar} npm run eval -- --menu`);
  console.log(`  ${sym.bar} npm run eval -- --dataset=smoke --variant=prod,mi_variante --decision-model=d3:2b-text`);
  console.log(`  ${sym.bar} npm run eval -- --dataset=smoke --dry-run --ids=<caso>   ${c.gray("imprime el prompt que recibe el modelo (copiable para armar una variante)")}`);
  console.log(`  ${sym.bar} npm run eval -- --auto --stage=args_review --decision-model=d3:2b-text --optimizer-model=qwen3:32b --max-loops=6 --target=0.80`);
  console.log(`  ${sym.bar} npm run eval -- --auto --help   ${c.gray("flags completos del bucle autónomo")}`);
  console.log(`\n  ${c.gray("Datasets y variantes se pueden escribir solo por nombre.")}`);
  console.log(`  ${c.gray("Referencia completa de flags:")} ${c.cyan("eval/INSTRUCCIONES.md")}\n`);
}