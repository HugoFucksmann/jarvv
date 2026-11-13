/**
 * Sonda cualitativa: preguntas «intensas» (comparar, varias facetas, listas, dos hechos a la vez, documentación extensa) contra el proveedor REAL (Free Search + 2B).
 * No afirma nada: imprime estado, etapa y el texto que recibiría el modelo, para ver qué parte de la pregunta queda sin cubrir.
 *   npx tsx scripts/validate/web_eval/deep_probe.ts [--only=n,n]
 */
import { ConfigManager } from "../../../src/core/config.ts";
import { DiscoveryEngine } from "../../../src/core/mcp/discovery.ts";
import { FreeSearchMCPServer } from "../../../src/core/mcp/freeSearchMcp.ts";
import { Decision20Engine } from "../../../src/core/models/decision.ts";
import { createToolHost } from "../../../src/core/tools/host.ts";
import { readToolResult } from "../../../src/core/tools/result.ts";
import { NULL_SINK } from "../../../src/core/trace/sink.ts";
import { WEB_DEPENDENCIES, WebSearchProvider } from "../../../src/tools/web/webSearchProvider.ts";

const QUESTIONS: [string, string][] = [
  ["comparación", "¿Qué diferencias hay entre Node.js 22 y Node.js 24 en rendimiento y compatibilidad?"],
  ["facetas", "¿Qué cambios de seguridad y de rendimiento trajo PostgreSQL 17 respecto a PostgreSQL 16?"],
  ["dos hechos", "¿Quién creó Redis y cuál fue la fecha de su primera versión pública?"],
  ["doc extensa", "¿Qué opciones acepta fs.cp en Node.js y qué valor por defecto tiene cada una?"],
  ["facetas 2", "¿Cuáles son los límites de tamaño de un item y de una consulta (Query) en DynamoDB?"],
  ["lista", "Resumen de las principales novedades de Python 3.14"],
  ["dos hechos 2", "¿Cuál es la versión estable más reciente de Kubernetes y cuándo termina su soporte?"],
  ["subjetiva", "¿Cuál es la mejor base de datos vectorial en 2026 y por qué?"],
];
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",").map(Number);
const getConfig = ConfigManager.getConfig.bind(ConfigManager);
const server = new FreeSearchMCPServer(getConfig);
const discovery = new DiscoveryEngine([server]);
const provider = new WebSearchProvider({ judge: () => new Decision20Engine(getConfig) });
try {
  for (const [i, [kind, need]] of QUESTIONS.entries()) {
    if (only && !only.includes(i + 1)) continue;
    const host = createToolHost(discovery, WEB_DEPENDENCIES, NULL_SINK, "deep");
    const t0 = Date.now();
    const result = await provider.callTool("web_search", { need }, { taskId: "deep", host, timeoutMs: 150_000 });
    const native = readToolResult(result);
    console.log(`\n### ${i + 1} [${kind}] ${need}`);
    if (native === null) { console.log("  (sin resultado nativo)"); continue; }
    const passages = (native.data.passages as unknown[]).length;
    const sources = new Set((native.data.passages as { n: number }[]).map((p) => p.n)).size;
    console.log(`  state=${String(native.data.state)} stage=${String(native.data.stage)} páginas=${String(native.data.read)} fragmentos=${passages} fuentes=${sources} ${Date.now() - t0} ms ${native.text.length}c`);
    console.log("  " + native.text.replace(/\n/g, "\n  ").slice(0, 1500));
  }
} finally {
  await server.close();
}
process.exit(0);
