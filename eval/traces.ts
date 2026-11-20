/**
 * eval/traces.ts — Convierte carpetas reales de `jarvis-traces/` a casos `.jsonl` validados para `eval/`.
 *
 * Uso:
 *   npm run eval:traces -- [--input=jarvis-traces] [--out=eval/traces_export] [--stages=a,b] [--task=id] [--limit=N] [--anonymize] [--no-dedupe] [--dry-run]
 */

import { pathToFileURL } from "node:url";
import { flagBool, flagCsv, flagInt, flagStr, parseArgvFlags } from "./core/config.ts";
import { hasStage } from "./core/stages/index.ts";
import { convertTraces } from "./core/traces.ts";
import type { StageName } from "./core/types.ts";

const TRACES_KNOWN_FLAGS = new Set([
  "input",
  "out",
  "stages",
  "task",
  "limit",
  "dedupe",
  "anonymize",
  "use-full",
  "dry-run",
  "help",
]);

export interface TracesCliConfig {
  inputPath: string;
  outPath: string;
  stages?: StageName[];
  taskFilters?: string[];
  limit?: number;
  dedupe: boolean;
  anonymize: boolean;
  useFull: boolean;
  dryRun: boolean;
  help: boolean;
}

export function parseTracesConfig(argv: string[]): TracesCliConfig {
  if (argv.includes("--help") || argv.includes("-h")) {
    return {
      inputPath: "jarvis-traces",
      outPath: "eval/traces_export",
      dedupe: true,
      anonymize: false,
      useFull: true,
      dryRun: false,
      help: true,
    };
  }
  const flags = parseArgvFlags(argv, TRACES_KNOWN_FLAGS);
  if (flags.has("help")) {
    return {
      inputPath: "jarvis-traces",
      outPath: "eval/traces_export",
      dedupe: true,
      anonymize: false,
      useFull: true,
      dryRun: false,
      help: true,
    };
  }
  const inputPath = flagStr(flags, "input") ?? "jarvis-traces";
  const outPath = flagStr(flags, "out") ?? "eval/traces_export";
  const rawStages = flagCsv(flags, "stages");
  const stages: StageName[] | undefined = rawStages.length > 0
    ? rawStages.map((s) => {
        if (!hasStage(s)) throw new Error(`--stages: etapa '${s}' desconocida.`);
        return s;
      })
    : undefined;
  const rawTasks = flagCsv(flags, "task");
  const taskFilters = rawTasks.length > 0 ? rawTasks : undefined;
  const limit = flagInt(flags, "limit", 1);
  const dedupe = flagBool(flags, "dedupe", true);
  const anonymize = flagBool(flags, "anonymize", false);
  const useFull = flagBool(flags, "use-full", true);
  const dryRun = flagBool(flags, "dry-run", false);

  return { inputPath, outPath, stages, taskFilters, limit, dedupe, anonymize, useFull, dryRun, help: false };
}

function printTracesUsage(): void {
  console.log("Uso: npm run eval:traces -- [--input=<ruta>] [--out=<archivo.jsonl|carpeta>] [flags]");
  console.log("");
  console.log("Convierte carpetas reales de jarvis-traces/ (trace.json + opcional full.json.gz) en casos .jsonl");
  console.log("validados contra el esquema actual de eval/ (con expect borrador marcado para revisión humana).");
  console.log("");
  console.log("Flags:");
  console.log("  --input=<ruta>        Carpeta base de trazas, carpeta de una tarea o trace.json (default: jarvis-traces)");
  console.log("  --out=<ruta>          Archivo .jsonl único o carpeta de salida (default: eval/traces_export)");
  console.log("  --stages=<a,b>        Filtrar etapas de eval (ej. d0,route,arguments,recovery)");
  console.log("  --task=<id1,id2>      Filtrar carpetas/tareas cuyo nombre o id contenga alguno de esos textos");
  console.log("  --limit=<N>           Máximo de archivos trace.json a procesar");
  console.log("  --dedupe=true|false   Deduplicar por inputHash/escenario (default: true)");
  console.log("  --anonymize           Reemplaza rutas de usuario por 'usuario' (default: false)");
  console.log("  --use-full=true|false Usar full.json.gz si existe junto a trace.json (default: true)");
  console.log("  --dry-run             Validar y resumir sin escribir archivos");
  console.log("  --help, -h            Muestra esta ayuda");
}

export async function runTracesCli(argv: string[]): Promise<number> {
  let cfg: TracesCliConfig;
  try {
    cfg = parseTracesConfig(argv);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
  if (cfg.help) {
    printTracesUsage();
    return 0;
  }

  try {
    const res = convertTraces({
      inputPath: cfg.inputPath,
      outPath: cfg.outPath,
      stages: cfg.stages,
      taskFilters: cfg.taskFilters,
      limit: cfg.limit,
      dedupe: cfg.dedupe,
      anonymize: cfg.anonymize,
      useFull: cfg.useFull,
      dryRun: cfg.dryRun,
    });

    console.log(
      `Trazas procesadas: ${res.filesScanned} · Consultas vistas: ${res.queriesSeen} · Casos válidos: ${res.cases.length} · Omitidos: ${res.skipped.length}`,
    );
    const entries = Object.entries(res.byStage).sort((a, b) => a[0].localeCompare(b[0]));
    if (entries.length > 0) {
      console.log(`Por etapa: ${entries.map(([k, n]) => `${k}=${n}`).join(", ")}`);
    }
    if (res.writtenFiles.length > 0) {
      console.log("Archivos escritos:");
      for (const f of res.writtenFiles) console.log(`  - ${f}`);
    } else if (cfg.dryRun) {
      console.log("(dry-run: no se escribieron archivos)");
    }
    if (res.skipped.length > 0) {
      const reasons = new Map<string, number>();
      for (const s of res.skipped) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
      console.log("Motivos de omisión:");
      for (const [reason, count] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  - (${count}) ${reason}`);
      }
    }
    return 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runTracesCli(process.argv.slice(2)).then((code) => process.exit(code));
}
