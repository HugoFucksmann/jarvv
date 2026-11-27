/**
 * eval/exp/traces_d4_d5.ts
 *
 * Cura los borradores que genera `npm run eval:traces` para `result_verification` (D4) y `d5` y los convierte en datasets de eval con etiquetas revisadas.
 *
 * El conversor (`eval/core/traces.ts`) etiqueta cada caso con lo que HIZO el sistema en esa traza (el veredicto que dio D4, si cerró D5): puede ser erróneo, y el encargo de
 * datasets (`docs/evaluacion/INSTRUCCIONES_AGENTE_DATASETS.md`, §3 y §6) pide etiquetar contra la documentación, no contra un modelo. Acá la etiqueta sale de reglas que dicen
 * qué pide el paso y qué trae el resultado, y cada caso lleva la razón por escrito en su `description`. Además:
 *   - anonimiza lo que el conversor no toca (usuario, equipo, direcciones IP y MAC);
 *   - descarta lo ambiguo (dos etiquetas defendibles) y lo que ninguna regla decide, y lo informa;
 *   - deduplica por clase (mismo pedido, misma herramienta, mismos argumentos y misma regla) y limita a 2 casos por traza y etapa;
 *   - reparte las clases entre desarrollo y holdout (ninguna clase en los dos).
 *
 * Uso:
 *   npm run eval:traces -- --input=jarvis-traces --out=<carpeta> --stages=d5,result_verification --limit=100 --anonymize
 *   npx tsx eval/exp/traces_d4_d5.ts --in=<carpeta> [--out=eval/datasets] [--dry-run]
 */

import fs from "node:fs";
import path from "node:path";

interface Call {
  step?: number;
  route: string;
  tool: string;
  kind?: string;
  status: string;
  args?: Record<string, unknown> | null;
  summary?: string | null;
  verdict?: string;
  reason?: string | null;
}
interface Step { instruction?: string; state?: string; expected?: string }
interface Scenario { mode: string; request: string; steps?: Step[]; calls?: Call[]; at?: { call?: number; lastItem?: boolean } }
interface Case { id: string; stage: string; tags: string[]; description: string; scenario: Scenario; expect: Record<string, unknown> }

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const inDir = flag("in");
const outDir = flag("out") ?? "eval/datasets";
const dryRun = argv.includes("--dry-run");
if (inDir === undefined) {
  console.error("Uso: npx tsx eval/exp/traces_d4_d5.ts --in=<carpeta del conversor> [--out=eval/datasets] [--dry-run]");
  process.exit(2);
}

// ───────────────────────── Anonimizado ─────────────────────────

/** Lo que el conversor no cambia: usuario, equipo, direcciones de red y MAC. Las fechas y los nombres de programas se conservan (son del sistema, no de la persona). */
const ANON: readonly (readonly [RegExp, string])[] = [
  [/hugof/gi, "usuario"],
  [/\bcolof\b/gi, "PC-DEMO"],
  [/192\.168\.100\.(\d+)/g, "192.168.1.$1"],
  [/\b2803:9800:[0-9a-f:]+/gi, "2001:db8:1:2::10"],
  [/\bfe80::[0-9a-f:]+/gi, "fe80::1a2b:3c4d:5e6f:7a8b"],
  [/\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/gi, "00:11:22:33:44:55"],
];
const anonymize = <T>(value: T): T => JSON.parse(ANON.reduce((text, [re, to]) => text.replace(re, to), JSON.stringify(value))) as T;

// ───────────────────────── Lectura de los borradores ─────────────────────────

const readJsonl = (file: string): Case[] =>
  fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as Case) : [];
const taskOf = (id: string): string => /^tr-(task_[^-]+)-/.exec(id)?.[1] ?? id;
const norm = (s: string): string => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const cmd = (c: Call): string => (typeof c.args?.command === "string" ? c.args.command : "");
const section = (c: Call): string => (typeof c.args?.section === "string" ? c.args.section : "");

const isDefender = (c: Call): boolean => /Get-MpComputerStatus/i.test(cmd(c));
/** Procesos filtrados por hora de inicio: dice cuáles llevan corriendo más de X. */
const isAgeFilter = (c: Call): boolean => /Get-Process/i.test(cmd(c)) && /Where-Object[^|]*StartTime/i.test(cmd(c));
const isProcessListing = (c: Call): boolean => /Get-Process/i.test(cmd(c)) && !isAgeFilter(c);

// ───────────────────────── D4: result_verification ─────────────────────────

interface Verdict { readonly cls: string; readonly ok: boolean; readonly cumple: boolean; readonly tag: "typical" | "hard" | "edge"; readonly why: string }

/**
 * Qué se espera de D4 para este paso y esta llamada, según lo que el paso pide y lo que el resultado muestra. `null` = ambiguo o fuera de las reglas: se descarta.
 * `ok` es siempre true acá: todas las llamadas devolvieron datos sin error.
 */
function judgeRv(step: string, call: Call): Verdict | null {
  const s = norm(step);
  const virus = /virus|malware|antivirus/.test(s);
  const scan = /analisis completo|escaner/.test(s);
  const old = /(viej|antigu|obsolet)/.test(s) && /proces/.test(s);
  const wholeRequest = /revisa el estado de mi pc/.test(s);
  const yes = (cls: string, why: string, tag: Verdict["tag"] = "typical"): Verdict => ({ cls, ok: true, cumple: true, tag, why });
  const no = (cls: string, why: string, tag: Verdict["tag"] = "hard"): Verdict => ({ cls, ok: true, cumple: false, tag, why });

  if (call.tool === "play_media") return yes("media", "abrir YouTube con la búsqueda pedida es lo que hace play_media: el resultado confirma la acción del paso");
  if (call.tool === "system_info") {
    const sec = section(call);
    if (/\bram\b/.test(s) && sec === "hardware") return yes("ram", "el informe de hardware trae la RAM libre que pide el paso");
    if (/disco/.test(s) && sec === "disks") return yes("disks", "el informe de discos trae el espacio libre de cada uno");
    if (/direccion ip/.test(s) && sec === "network") return yes("ip", "el informe de red trae la dirección IPv4 de la interfaz externa, aunque lo acompañe IPv6 y el loopback", "edge");
    if (wholeRequest) return no("whole-si", "el paso es el pedido entero (virus y procesos viejos) y un informe fijo del equipo no responde ni lo uno ni lo otro");
    if (virus && !scan) return no(`virus-si-${sec}`, `un informe de ${sec} no dice si hay virus o malware`);
    if (old) return no("old-si-processes", "la lista de procesos por memoria o nombre no trae la hora de inicio: no dice cuáles son viejos");
    return null;
  }
  if (call.tool === "run_command") {
    if (isDefender(call)) {
      if (/analisis completo/.test(s)) return no("scan-def", "el paso pide ejecutar un análisis completo y el comando solo consulta el estado del antivirus, no analiza nada");
      if (/escaner/.test(s)) return null; // «usando un escáner de seguridad»: consultar Defender puede o no contar
      if (virus) return yes("virus-def", "el estado de Microsoft Defender (protección activa, firmas al día, amenazas) responde si hay virus");
      return null;
    }
    if (isProcessListing(call) && virus && !old) return no("virus-plist", "listar procesos no es una revisión de virus: no dice si alguno es malicioso");
    if (isAgeFilter(call) && old) {
      if (/consumiendo recursos|consumen recursos/.test(s)) return no("old-resources", "el comando filtra por hora de inicio y muestra Name, Id y StartTime, pero el paso también pide qué consume recursos y no hay CPU ni memoria");
      if (/maliciosos|sospechosos/.test(s)) return null; // «antiguos o maliciosos»: la hora de inicio no dice si son maliciosos
      return yes("old-filter", "el filtro por hora de inicio lista los procesos que llevan corriendo más del umbral pedido");
    }
    return null;
  }
  return null;
}

function buildRv(drafts: readonly Case[]): { dev: Case[]; holdout: Case[]; dropped: string[] } {
  const dropped: string[] = [];
  const picked = new Map<string, { draft: Case; verdict: Verdict; call: Call; step: string }>();
  const perTask = new Map<string, number>();
  for (const draft of drafts) {
    const sc = draft.scenario;
    const at = sc.at?.call ?? (sc.calls?.length ?? 1) - 1;
    const call = sc.calls?.[at];
    const stepIndex = call?.step ?? (sc.steps?.length ?? 1) - 1;
    const step = sc.steps?.[stepIndex]?.instruction ?? sc.request;
    if (call === undefined || call.status !== "ok") { dropped.push(`${draft.id}: la llamada evaluada no es ok`); continue; }
    const verdict = judgeRv(step, call);
    if (verdict === null) { dropped.push(`${draft.id}: ambiguo o sin regla (${step.slice(0, 40)} · ${call.tool})`); continue; }
    const key = `${verdict.cls}|${norm(step)}|${call.tool}|${norm(JSON.stringify(call.args ?? {}))}`;
    if (picked.has(key)) continue;
    const task = taskOf(draft.id);
    if ((perTask.get(task) ?? 0) >= 2) continue;
    perTask.set(task, (perTask.get(task) ?? 0) + 1);
    picked.set(key, { draft, verdict, call, step });
  }
  // Una clase (regla) tiene a lo sumo 3 casos: las que se repiten mucho en las trazas (Defender, procesos filtrados) no tapan al resto.
  const perClass = new Map<string, number>();
  const kept = [...picked.values()].filter(({ verdict }) => {
    const n = perClass.get(verdict.cls) ?? 0;
    perClass.set(verdict.cls, n + 1);
    return n < 3;
  });
  const cases: Case[] = kept.map(({ draft, verdict, step }, i) => {
    const sc = draft.scenario;
    const at = sc.at?.call ?? (sc.calls?.length ?? 1) - 1;
    const calls = (sc.calls ?? []).slice(0, at + 1).map((c, idx) => {
      if (idx !== at) return c;
      const { verdict: _v, reason: _r, ...rest } = c; // la llamada a juzgar no lleva su propio veredicto
      return rest;
    });
    return anonymize({
      id: `rv-tr-${String(i + 1).padStart(2, "0")}`,
      stage: "result_verification",
      tags: [verdict.tag, "trace", ...(verdict.cumple ? [] : ["negative"])],
      description: `Traza real: ${verdict.why}. Paso: «${step.slice(0, 70)}».`,
      scenario: { mode: sc.mode, request: sc.request, steps: sc.steps, calls, at: { call: at } },
      expect: { expectedOk: verdict.ok, expectedCumple: verdict.cumple },
    });
  });
  return { ...split(cases, (c) => String(c.expect.expectedCumple)), dropped };
}

// ───────────────────────── D5: cierre ─────────────────────────

interface Closing { readonly cls: string; readonly complete: boolean; readonly why: string; readonly tag: "typical" | "hard" | "edge" }

const approved = (sc: Scenario): Call[] => (sc.calls ?? []).filter((c) => c.verdict === "approved");

/** ¿Lo hecho (llamadas aprobadas) cumple todo el pedido? `null` = ninguna regla lo decide: se descarta. */
function judgeD5(sc: Scenario): Closing | null {
  const done = approved(sc);
  const req = norm(sc.request);
  if (/virus/.test(req) && /proces/.test(req)) {
    const def = done.some(isDefender);
    const age = done.some(isAgeFilter);
    if (def && age) return { cls: "pc-both", complete: true, tag: "typical", why: "hay el estado de Defender y los procesos filtrados por hora de inicio: las dos partes del pedido tienen su resultado" };
    if (def) return { cls: "pc-def-only", complete: false, tag: "hard", why: "solo se revisó el antivirus: faltan los procesos viejos" };
    if (age) return { cls: "pc-age-only", complete: false, tag: "hard", why: "solo se listaron procesos por antigüedad: falta revisar virus y malware" };
    if (done.length > 0 && done.every((c) => c.tool === "system_info")) return { cls: "pc-si-only", complete: false, tag: "hard", why: "solo hay informes fijos del sistema: ninguno revisa virus ni da la antigüedad de los procesos" };
    return null;
  }
  if (/\bram\b/.test(req) && /disco/.test(req)) {
    const hw = done.some((c) => c.tool === "system_info" && section(c) === "hardware");
    const dk = done.some((c) => c.tool === "system_info" && section(c) === "disks");
    if (hw && dk) return { cls: "ram-disks", complete: true, tag: "typical", why: "están la RAM libre y el espacio de los discos" };
    if (hw || dk) return { cls: "ram-disks-half", complete: false, tag: "typical", why: "falta una de las dos consultas (RAM o discos)" };
    return null;
  }
  if (/back in black/.test(req) && done.some((c) => c.tool === "play_media")) return { cls: "media", complete: true, tag: "typical", why: "se abrió YouTube con la búsqueda pedida: era la única acción" };
  return null;
}

function buildD5(drafts: readonly Case[]): { dev: Case[]; holdout: Case[]; dropped: string[] } {
  const dropped: string[] = [];
  const picked = new Map<string, { draft: Case; verdict: Closing }>();
  const perTask = new Map<string, number>();
  for (const draft of drafts) {
    const verdict = judgeD5(draft.scenario);
    if (verdict === null) { dropped.push(`${draft.id}: ninguna regla decide si está cumplido`); continue; }
    const key = `${verdict.cls}|${norm(JSON.stringify(approved(draft.scenario).map((c) => [c.tool, c.args])))}`;
    if (picked.has(key)) continue;
    const task = taskOf(draft.id);
    if ((perTask.get(task) ?? 0) >= 2) continue;
    perTask.set(task, (perTask.get(task) ?? 0) + 1);
    picked.set(key, { draft, verdict });
  }
  const perClass = new Map<string, number>();
  const kept = [...picked.values()].filter(({ verdict }) => {
    const n = perClass.get(verdict.cls) ?? 0;
    perClass.set(verdict.cls, n + 1);
    return n < 4;
  });
  const cases: Case[] = kept.map(({ draft, verdict }, i) =>
    anonymize({
      id: `d5-tr-${String(i + 1).padStart(2, "0")}`,
      stage: "d5",
      tags: [verdict.tag, "trace", ...(verdict.complete ? [] : ["negative"])],
      description: `Traza real: ${verdict.why}.`,
      scenario: { mode: draft.scenario.mode, request: draft.scenario.request, steps: draft.scenario.steps, calls: draft.scenario.calls },
      expect: { expectedComplete: verdict.complete },
    }),
  );
  return { ...split(cases, (c) => String(c.expect.expectedComplete)), dropped };
}

// ───────────────────────── Reparto y salida ─────────────────────────

/** Desarrollo y holdout sin clases en común: se reparte caso por caso alternando dentro de cada etiqueta (cada caso ya es de una clase distinta por la deduplicación). */
function split(cases: readonly Case[], label: (c: Case) => string): { dev: Case[]; holdout: Case[] } {
  const dev: Case[] = [];
  const holdout: Case[] = [];
  const seen = new Map<string, number>();
  for (const c of cases) {
    const k = label(c);
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    (n % 2 === 0 ? dev : holdout).push(c);
  }
  return { dev, holdout };
}

function write(stage: string, name: string, dev: Case[], holdout: Case[]): void {
  const dir = path.join(outDir, stage);
  const files: [string, Case[]][] = [[`${name}_1.jsonl`, dev], [`${name}_holdout_1.jsonl`, holdout]];
  for (const [file, rows] of files) {
    const renumbered = rows.map((c, i) => ({ ...c, id: `${c.id.replace(/-\d+$/, "")}-${file.includes("holdout") ? "h" : "d"}${String(i + 1).padStart(2, "0")}` }));
    if (!dryRun) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, file), renumbered.map((c) => JSON.stringify(c)).join("\n") + "\n", "utf8");
    }
    const yes = rows.filter((c) => c.expect.expectedCumple === true || c.expect.expectedComplete === true).length;
    console.log(`${path.join(dir, file)}: ${rows.length} casos (${yes} positivos, ${rows.length - yes} negativos)${dryRun ? " [dry-run]" : ""}`);
  }
}

const rv = buildRv(readJsonl(path.join(inDir, "traces_result_verification.jsonl")));
write("result_verification", "result_verification_traces", rv.dev, rv.holdout);
const d5 = buildD5(readJsonl(path.join(inDir, "traces_d5.jsonl")));
write("d5", "d5_traces", d5.dev, d5.holdout);

const reasons = new Map<string, number>();
for (const d of [...rv.dropped, ...d5.dropped]) reasons.set(d.replace(/^[^:]+: /, ""), (reasons.get(d.replace(/^[^:]+: /, "")) ?? 0) + 1);
console.log("\nDescartados:");
for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  (${n}) ${r}`);
