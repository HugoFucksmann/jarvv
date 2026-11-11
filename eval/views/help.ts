/**
 * eval/views/help.ts
 *
 * Vista de `--help`.
 */

import { box, c, kv, section, sym } from "../ui.ts";

export function printHelp(): void {
  console.log();
  console.log(box([`${c.bold(c.cyan("Eval"))} ${c.gray("·")} ${c.bold("evaluación de modelos y variantes")}`], { color: c.violet }));

  section("Uso");
  console.log(`  ${c.bold("npm run eval -- [flags]")}`);

  section("Opciones");
  kv([
    ["--menu", "asistente interactivo: elige modelos, datasets, variantes, etapas y opciones, y ejecuta"],
    ["--list", "muestra etapas, variantes y datasets disponibles"],
    ["--help, -h", "muestra esta ayuda"],
  ]);

  section("Ejemplos");
  console.log(`  ${sym.bar} npm run eval -- --menu`);
  console.log(`  ${sym.bar} npm run eval -- --dataset=smoke --variant=prod,mi_variante`);
  console.log(`  ${sym.bar} npm run eval -- --dataset=smoke --dry-run --ids=<caso>   ${c.gray("imprime el prompt que recibe el modelo (copiable para armar una variante)")}`);
  console.log(`\n  ${c.gray("Datasets y variantes se pueden escribir solo por nombre.")}`);
  console.log(`  ${c.gray("Referencia completa de flags:")} ${c.cyan("eval/INSTRUCCIONES.md")}\n`);
}
