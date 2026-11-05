/**
 * eval/wizard.ts
 *
 * Menú interactivo de consola (`--menu`): guía la elección de modo, modelos, datasets, variantes y opciones, arma el
 * `argv` equivalente y, tras confirmar, lo devuelve para que la CLI lo ejecute como si se hubiera escrito a mano.
 * Sin dependencias: solo `node:readline`; el estilo de consola vive en `ui.ts`.
 */

import { createInterface } from "node:readline/promises";
import { DECISION_STAGES, GENERATIVE_STAGES } from "./core/case.ts";
import { DEFAULT_DECISION_MODEL, DEFAULT_MODEL } from "./core/config.ts";
import { listDatasetNames } from "./core/datasets.ts";
import { allStageNames } from "./core/stages/index.ts";
import { listVariantNames } from "./core/variants/load.ts";
import { box, c, padEnd, sym, vlen, WIDTH } from "./ui.ts";

type Mode = "decision" | "generative" | "all";

class Cancelled extends Error { }

type Ask = (prompt: string) => Promise<string>;

// ─────────────────────────────────────────────────────────────────────────────
// Estilo
// ─────────────────────────────────────────────────────────────────────────────

const TOTAL_STEPS = 6;

/** Encabezado de paso: "Paso 2/6 · Modelos" con barra de progreso. */
function step(n: number, title: string): void {
  const progress = Array.from({ length: TOTAL_STEPS }, (_, i) => (i < n ? c.cyan("▰") : c.gray("▱"))).join("");
  console.log(`\n${c.violet(c.bold(`Paso ${n}/${TOTAL_STEPS}`))} ${c.gray("·")} ${c.bold(title)}   ${progress}`);
  console.log(c.gray("─".repeat(WIDTH)));
}

const hint = (s: string): void => console.log(`  ${c.gray(s)}`);
const warn = (s: string): void => console.log(`  ${sym.err} ${c.red(s)}`);
const note = (s: string): void => console.log(`  ${sym.warn} ${c.yellow(s)}`);

const prompt = (label: string, def?: string): string =>
  `  ${sym.pointer} ${c.bold(label)}${def !== undefined && def !== "" ? ` ${c.gray(`[${def}]`)}` : ""}${c.gray(":")} `;

// ─────────────────────────────────────────────────────────────────────────────
// Preguntas
// ─────────────────────────────────────────────────────────────────────────────

/** Pregunta con valor por defecto (Enter lo acepta). */
async function text(ask: Ask, label: string, def?: string): Promise<string> {
  const a = (await ask(prompt(label, def))).trim();
  return a === "" ? (def ?? "") : a;
}

async function confirm(ask: Ask, label: string, def: boolean): Promise<boolean> {
  for (; ;) {
    const a = (await ask(prompt(label, def ? "S/n" : "s/N"))).trim().toLowerCase();
    if (a === "") return def;
    if (["s", "si", "sí", "y", "yes"].includes(a)) return true;
    if (["n", "no"].includes(a)) return false;
    warn("Responde s o n.");
  }
}

/** Elige una opción por número. */
async function pickOne<T extends string>(ask: Ask, label: string, options: Array<{ value: T; text: string }>, def = 0): Promise<T> {
  console.log(`\n  ${c.bold(label)}`);
  options.forEach((o, i) => {
    const isDef = i === def;
    const num = isDef ? c.cyan(c.bold(`${i + 1}`)) : c.gray(`${i + 1}`);
    console.log(`  ${isDef ? sym.dot : sym.ring} ${num}  ${isDef ? o.text : c.dim(o.text)}`);
  });
  console.log();
  for (; ;) {
    const a = (await ask(prompt("Opción", String(def + 1)))).trim();
    if (a === "") return options[def].value;
    const n = Number(a);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1].value;
    warn("Número fuera de rango.");
  }
}

/** Imprime una lista numerada; en dos columnas si es larga y entra. */
function printNumbered(items: string[]): void {
  const numW = String(items.length).length;
  const cell = (it: string, i: number): string => `${c.cyan(String(i + 1).padStart(numW))} ${c.gray("·")} ${it}`;
  const colW = Math.max(...items.map((it) => vlen(it))) + numW + 5;
  if (items.length > 8 && colW * 2 + 4 <= WIDTH) {
    const rows = Math.ceil(items.length / 2);
    for (let r = 0; r < rows; r++) {
      const left = cell(items[r], r);
      const right = r + rows < items.length ? cell(items[r + rows], r + rows) : "";
      console.log(`  ${padEnd(left, colW)}${right}`);
    }
  } else {
    items.forEach((it, i) => console.log(`  ${cell(it, i)}`));
  }
}

/**
 * Elige varios por número o nombre (separados por coma). `a` = todos. Con `allowCompose`, `2+3` compone dos elementos.
 * Enter devuelve `def` (nombres).
 */
async function pickMany(
  ask: Ask,
  label: string,
  items: string[],
  opts: { def: string[]; defLabel?: string; allowCompose?: boolean; hint: string },
): Promise<string[]> {
  console.log(`\n  ${c.bold(label)}\n`);
  printNumbered(items);
  console.log();
  hint(opts.hint);
  console.log();
  const resolveOne = (tok: string): string | null => {
    if (items.includes(tok)) return tok;
    const n = Number(tok);
    return Number.isInteger(n) && n >= 1 && n <= items.length ? items[n - 1] : null;
  };
  for (; ;) {
    const a = (await ask(prompt("Selección", opts.defLabel ?? (opts.def.length > 0 ? opts.def.join(",") : "todos")))).trim();
    if (a === "") return opts.def;
    if (a.toLowerCase() === "a" || a.toLowerCase() === "todos") return items;
    const out: string[] = [];
    let bad: string | null = null;
    for (const tok of a.split(",").map((t) => t.trim()).filter(Boolean)) {
      const parts = opts.allowCompose ? tok.split("+").map((p) => p.trim()) : [tok];
      const names = parts.map(resolveOne);
      if (names.some((n) => n === null)) {
        bad = tok;
        break;
      }
      const joined = names.join("+");
      if (!out.includes(joined)) out.push(joined);
    }
    if (bad !== null) {
      warn(`'${bad}' no es válido.`);
      continue;
    }
    if (out.length > 0) return out;
  }
}

function quoteArg(a: string): string {
  return /[\s"'`$&|<>*?;()]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
}

// ─────────────────────────────────────────────────────────────────────────────
// Asistente
// ─────────────────────────────────────────────────────────────────────────────

/** Devuelve el `argv` elegido, o `null` si se canceló (Ctrl+C, entrada cerrada o "no ejecutar"). */
export async function runWizard(): Promise<string[] | null> {
  if (!process.stdin.isTTY) {
    console.error(`${sym.err} --menu necesita una terminal interactiva.`);
    return null;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let closed = false;
  rl.on("close", () => {
    closed = true;
  });
  const ask: Ask = async (p) => {
    if (closed) throw new Cancelled();
    try {
      return await rl.question(p);
    } catch {
      throw new Cancelled();
    }
  };

  try {
    console.log();
    console.log(
      box(
        [
          `${c.bold(c.cyan("Eval"))} ${c.gray("·")} ${c.bold("asistente interactivo")}`,
          c.gray("Enter acepta el valor entre corchetes  ·  Ctrl+C cancela"),
        ],
        { color: c.violet },
      ),
    );

    const argv: string[] = [];
    const summary: Array<[string, string]> = [];

    // 1. Modo
    step(1, "Modo de evaluación");
    const mode = await pickOne<Mode>(ask, "¿Qué quieres evaluar?", [
      { value: "decision", text: `Solo decisión    ${c.gray("route, tool_choice, args_review, result_verification  (--d-model)")}` },
      { value: "generative", text: `Solo generativo  ${c.gray("plan, arguments, final, question  (--llm-model)")}` },
      { value: "all", text: `Todas las etapas ${c.gray("(--model)")}` },
    ]);
    summary.push(["Modo", mode === "decision" ? "decisión" : mode === "generative" ? "generativo" : "todas las etapas"]);

    // 2. Modelos
    step(2, "Modelos");
    let models: string;
    if (mode === "decision") {
      models = await text(ask, "Modelos de decisión (separados por coma)", DEFAULT_DECISION_MODEL);
      argv.push(`--d-model=${models}`);
    } else if (mode === "generative") {
      models = await text(ask, "Modelos generativos (separados por coma)", DEFAULT_MODEL);
      argv.push(`--llm-model=${models}`);
    } else {
      hint("Formato: <generativo>+<decisión>");
      models = await text(ask, "Configuraciones (separadas por coma)", `${DEFAULT_MODEL}+${DEFAULT_DECISION_MODEL}`);
      if (models !== `${DEFAULT_MODEL}+${DEFAULT_DECISION_MODEL}`) argv.push(`--model=${models}`);
    }
    summary.push(["Modelos", models]);

    // 3. Datasets
    step(3, "Datasets");
    const datasets = listDatasetNames();
    let datasetSummary = "todos";
    if (datasets.length > 0) {
      const chosen = await pickMany(ask, "Datasets disponibles", datasets, {
        def: [],
        hint: "Números o nombres separados por coma  ·  Enter o 'a' = todos",
      });
      if (chosen.length > 0 && chosen.length < datasets.length) {
        argv.push(`--dataset=${chosen.join(",")}`);
        datasetSummary = chosen.join(", ");
      }
    } else {
      note("No hay datasets disponibles.");
    }
    summary.push(["Datasets", datasetSummary]);

    // 4. Variantes (prod como baseline es opcional: --no-baseline)
    step(4, "Variantes");
    const variants = listVariantNames();
    const others = variants.filter((v) => v !== "prod");
    let variantSummary = "solo prod";
    if (others.length > 0) {
      hint("prod es la baseline: las demás se comparan contra ella (deltas, regresiones, mejoras).");
      const withProd = await confirm(ask, "¿Incluir prod como baseline? (si no, corre solo tus variantes)", true);
      let chosen: string[] = [];
      for (; ;) {
        chosen = await pickMany(ask, "Variantes disponibles", others, {
          def: [],
          defLabel: withProd ? "solo prod" : "elige al menos una",
          allowCompose: true,
          hint: withProd
            ? "Números o nombres separados por coma  ·  'a+b' compone dos  ·  Enter = solo prod"
            : "Números o nombres separados por coma  ·  'a+b' compone dos  ·  elige al menos una",
        });
        if (withProd || chosen.length > 0) break;
        warn("Sin prod hay que elegir al menos una variante.");
      }
      // `a` devuelve todos: eso es una lista, no una composición.
      if (withProd && chosen.length > 0) {
        argv.push(`--variant=prod,${chosen.join(",")}`);
        variantSummary = `prod, ${chosen.join(", ")}`;
      } else if (!withProd) {
        argv.push(`--variant=${chosen.join(",")}`, "--no-baseline");
        variantSummary = `${chosen.join(", ")}  ${c.gray("(sin prod)")}`;
      }
    } else {
      hint("Solo existe la variante prod.");
    }
    summary.push(["Variantes", variantSummary]);

    // 5. Etapas
    step(5, "Etapas");
    const stagePool: string[] = mode === "decision" ? [...DECISION_STAGES] : mode === "generative" ? [...GENERATIVE_STAGES] : allStageNames();
    const stages = await pickMany(ask, "Etapas disponibles", stagePool, { def: [], hint: "Enter o 'a' = todas las del modo" });
    let stageSummary = "todas";
    if (stages.length > 0 && stages.length < stagePool.length) {
      argv.push(`--stages=${stages.join(",")}`);
      stageSummary = stages.join(", ");
    }
    summary.push(["Etapas", stageSummary]);

    // 6. Opciones avanzadas
    step(6, "Opciones avanzadas");
    if (await confirm(ask, "¿Configurar repeticiones, concurrencia, límite, thinking, cliente...?", false)) {
      const client = await pickOne(ask, "Cliente", [
        { value: "real", text: `real    ${c.gray("llama a los modelos")}` },
        { value: "oracle", text: `oracle  ${c.gray("responde lo esperado (prueba la maquinaria)")}` },
        { value: "mock", text: `mock    ${c.gray("respuestas genéricas")}` },
      ]);
      if (client !== "real") {
        argv.push(`--client=${client}`);
        summary.push(["Cliente", client]);
      }

      console.log();
      const positiveInt = async (label: string, def: string, flag: string, title: string): Promise<void> => {
        for (; ;) {
          const v = await text(ask, label, def);
          if (/^\d+$/.test(v) && Number(v) >= 1) {
            if (v !== def) {
              argv.push(`--${flag}=${v}`);
              summary.push([title, v]);
            }
            return;
          }
          warn("Debe ser un entero >= 1.");
        }
      };
      await positiveInt("Repeticiones por caso", "1", "repeat", "Repeticiones");
      hint("Con concurrencia > 1 las latencias dejan de ser comparables.");
      await positiveInt("Concurrencia", "1", "concurrency", "Concurrencia");

      const limit = await text(ask, "Límite de casos por dataset (vacío = sin límite)", "");
      if (limit !== "") {
        if (/^\d+$/.test(limit) && Number(limit) >= 1) {
          argv.push(`--limit=${limit}`);
          summary.push(["Límite", limit]);
        } else note("Límite ignorado (no es un entero >= 1).");
      }

      if (mode !== "decision") {
        const thinking = await pickOne(ask, "Thinking", [
          { value: "auto", text: "auto" },
          { value: "prod", text: "prod" },
          { value: "on", text: "on" },
          { value: "off", text: "off" },
          { value: "both", text: `both  ${c.gray("compara on y off")}` },
        ]);
        if (thinking !== "auto") {
          argv.push(`--thinking=${thinking}`);
          summary.push(["Thinking", thinking]);
        }
      }

      console.log();
      const label = await text(ask, "Label de la corrida (vacío = ninguno)", "");
      if (label !== "") {
        argv.push(`--label=${label}`);
        summary.push(["Label", label]);
      }
      if (await confirm(ask, "¿Dry-run (no llama a los modelos)?", false)) {
        argv.push("--dry-run");
        summary.push(["Dry-run", "sí"]);
      }
    } else {
      hint("Se usan los valores por defecto.");
    }

    // 7. Resumen y confirmación
    const keyW = Math.max(...summary.map(([k]) => k.length));
    console.log();
    console.log(
      box(
        summary.map(([k, v]) => `${c.gray(k.padEnd(keyW))}  ${c.bold(v)}`),
        { title: "Resumen", color: c.violet },
      ),
    );

    const cmd = `npm run eval -- ${argv.map(quoteArg).join(" ")}`.trimEnd();
    console.log(`\n  ${c.gray("Comando equivalente")}`);
    console.log(`  ${c.cyan("▌")} ${c.bold(cmd)}\n`);

    if (!(await confirm(ask, "¿Ejecutar ahora?", true))) {
      console.log(`\n  ${c.gray("Nada que ejecutar. Hasta luego.")}\n`);
      return null;
    }
    console.log(`\n  ${sym.ok} ${c.green("Lanzando evaluación…")}\n`);
    return argv;
  } catch (e) {
    if (e instanceof Cancelled) {
      console.log(`\n\n  ${sym.warn} ${c.yellow("Cancelado.")}\n`);
      return null;
    }
    throw e;
  } finally {
    rl.close();
  }
}