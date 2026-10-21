/**
 * JARVIS Lab — Evaluador Comparativo de Corridas
 *
 * Compara dos archivos de resultados producidos por run.ts sobre los mismos casos.
 * NO decide ni acepta/rechaza automáticamente. Solo muestra el informe comparativo.
 * NO sugiere significancia estadística (con N bajo las variaciones pueden ser estocásticas).
 * NO importa de src/.
 *
 * Uso:
 *   npx tsx lab/evaluate.ts <resultadoA.json> <resultadoB.json>
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RunResult } from "./types.ts";

function loadResult(filePath: string): RunResult {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`No se encontró el archivo de resultado en: ${resolved}`);
  }
  try {
    const raw = fs.readFileSync(resolved, "utf-8");
    return JSON.parse(raw);
  } catch (err: any) {
    throw new Error(`Error al leer o parsear '${filePath}': ${err.message}`);
  }
}

function validateRunValidity(res: RunResult, runLabel: string): void {
  let totalReps = 0;
  let errorReps = 0;
  let hasConnectionError = false;
  let connectionErrorDetail = "";

  for (const c of res.cases) {
    for (const r of c.repetitions) {
      totalReps++;
      if (r.error) {
        errorReps++;
        const errLower = r.error.toLowerCase();
        if (
          errLower.includes("connection error") ||
          errLower.includes("econnrefused") ||
          errLower.includes("enotfound") ||
          errLower.includes("fetch failed") ||
          errLower.includes("inalcanzable") ||
          errLower.includes("no se pudo conectar")
        ) {
          hasConnectionError = true;
          connectionErrorDetail = r.error;
        }
      }
    }
  }

  if (hasConnectionError) {
    throw new Error(
      `La ${runLabel} (${res.id}) contiene errores de conexión de red:\n  ${connectionErrorDetail}\nNo es posible evaluar comparativamente corridas afectadas por problemas de conexión.`
    );
  }

  if (totalReps > 0 && errorReps === totalReps) {
    throw new Error(
      `La ${runLabel} (${res.id}) no es válida para evaluación: el 100% de las repeticiones (${errorReps}/${totalReps}) fallaron con error.`
    );
  }
}

export function compareRuns(pathA: string, pathB: string): void {
  const resA = loadResult(pathA);
  const resB = loadResult(pathB);

  // 1. Validar integridad de las corridas (rechazar caídas o 100% de errores)
  validateRunValidity(resA, "Corrida A");
  validateRunValidity(resB, "Corrida B");

  // 2. Validar compatibilidad de etapas
  if (resA.stage !== resB.stage) {
    throw new Error(
      `Incompatibilidad de etapas: la corrida A es '${resA.stage}' y la corrida B es '${resB.stage}'.`
    );
  }

  const mapA = new Map(resA.cases.map((c) => [c.caseId, c]));
  const mapB = new Map(resB.cases.map((c) => [c.caseId, c]));

  const casesA = Array.from(mapA.keys()).sort();
  const casesB = Array.from(mapB.keys()).sort();

  if (casesA.length !== casesB.length || !casesA.every((id, idx) => id === casesB[idx])) {
    throw new Error(
      `Incompatibilidad de casos: los conjuntos de casos evaluados difieren.\nCorrida A: [${casesA.join(", ")}]\nCorrida B: [${casesB.join(", ")}]`
    );
  }

  // Validar número de repeticiones
  for (const caseId of casesA) {
    const cA = mapA.get(caseId)!;
    const cB = mapB.get(caseId)!;
    if (cA.totalReps !== cB.totalReps) {
      throw new Error(
        `Incompatibilidad de repeticiones en el caso '${caseId}': Corrida A tiene ${cA.totalReps} repeticiones y Corrida B tiene ${cB.totalReps}.`
      );
    }
  }

  console.log(`\n============================================================`);
  console.log(`JARVIS Lab — Evaluación Comparativa`);
  console.log(`Etapa: ${resA.stage}`);
  console.log(`Corrida A: [${resA.promptType.toUpperCase()}${resA.variantId ? `: ${resA.variantId}` : ""}] (Split: ${resA.split ?? "todos"}) ${resA.id}`);
  console.log(`Corrida B: [${resB.promptType.toUpperCase()}${resB.variantId ? `: ${resB.variantId}` : ""}] (Split: ${resB.split ?? "todos"}) ${resB.id}`);
  if (resA.warmup || resB.warmup) {
    const wA = resA.warmup ? `${resA.warmup.latencyMs}ms (${resA.warmup.ok ? "ok" : "falló"})` : "N/D";
    const wB = resB.warmup ? `${resB.warmup.latencyMs}ms (${resB.warmup.ok ? "ok" : "falló"})` : "N/D";
    console.log(`Warmup inicial:  A=${wA}  vs  B=${wB}`);
  }
  console.log(`============================================================\n`);

  // 2. Desglose caso por caso
  console.log(`--- DESGLOSE POR CASO ---`);
  const improved: string[] = [];
  const worsened: string[] = [];
  const neutral: string[] = [];

  for (const caseId of casesA) {
    const cA = mapA.get(caseId)!;
    const cB = mapB.get(caseId)!;

    const rateA = `${cA.passedReps}/${cA.totalReps}`;
    const rateB = `${cB.passedReps}/${cB.totalReps}`;

    let trend = "(=) Sin cambio";
    if (cB.passedReps > cA.passedReps) {
      trend = "(↑) MEJORA";
      improved.push(caseId);
    } else if (cB.passedReps < cA.passedReps) {
      trend = "(↓) EMPEORA";
      worsened.push(caseId);
    } else {
      neutral.push(caseId);
    }

    const latDelta = cB.avgLatencyMs - cA.avgLatencyMs;
    const latSign = latDelta >= 0 ? `+${latDelta}` : `${latDelta}`;

    console.log(`- ${caseId}:`);
    console.log(`    Aciertos: A=${rateA} vs B=${rateB}  -->  ${trend}`);

    // Mostrar detalle de checks
    const checksA = cA.repetitions[0]?.checks || [];
    const checksB = cB.repetitions[0]?.checks || [];
    if (checksA.length > 0 || checksB.length > 0) {
      const checkItems: string[] = [];
      const maxLen = Math.max(checksA.length, checksB.length);
      for (let i = 0; i < maxLen; i++) {
        const chkA = checksA[i];
        const chkB = checksB[i];
        const name = chkA?.check || chkB?.check || `check_${i + 1}`;
        const passA = chkA ? (chkA.passed ? "✓" : "✗") : "—";
        const passB = chkB ? (chkB.passed ? "✓" : "✗") : "—";
        const note = chkB && !chkB.passed && chkB.message ? ` [${chkB.message}]` : "";
        checkItems.push(`${name}: A=${passA} vs B=${passB}${note}`);
      }
      console.log(`    Checks: ${checkItems.join(" | ")}`);
    }

    if (cA.medianLatencyMs !== undefined && cB.medianLatencyMs !== undefined) {
      const medDelta = cB.medianLatencyMs - cA.medianLatencyMs;
      const medSign = medDelta >= 0 ? `+${medDelta}` : `${medDelta}`;
      console.log(`    Latencia media: A=${cA.avgLatencyMs}ms vs B=${cB.avgLatencyMs}ms (${latSign}ms) | Mediana: A=${cA.medianLatencyMs}ms vs B=${cB.medianLatencyMs}ms (${medSign}ms)`);
    } else {
      console.log(`    Latencia media: A=${cA.avgLatencyMs}ms vs B=${cB.avgLatencyMs}ms (${latSign}ms)`);
    }

    // Descriptivo para plan y replan (cantidad de pasos y rutas de A y B)
    if (resA.stage === "plan" || resA.stage === "replan") {
      const stepsA = cA.planStepCount ?? (Array.isArray((cA.repetitions[0]?.parsedOutput as any)?.steps) ? (cA.repetitions[0]?.parsedOutput as any).steps.length : undefined);
      const stepsB = cB.planStepCount ?? (Array.isArray((cB.repetitions[0]?.parsedOutput as any)?.steps) ? (cB.repetitions[0]?.parsedOutput as any).steps.length : undefined);
      const routesA = cA.planRoutes ?? (Array.isArray((cA.repetitions[0]?.parsedOutput as any)?.steps) ? (cA.repetitions[0]?.parsedOutput as any).steps.map((s: any) => s.route || s.suggested_mcp) : []);
      const routesB = cB.planRoutes ?? (Array.isArray((cB.repetitions[0]?.parsedOutput as any)?.steps) ? (cB.repetitions[0]?.parsedOutput as any).steps.map((s: any) => s.route || s.suggested_mcp) : []);

      const sAStr = stepsA !== undefined ? `${stepsA}` : "N/D";
      const sBStr = stepsB !== undefined ? `${stepsB}` : "N/D";
      const rAStr = routesA.length > 0 ? `[${routesA.join(", ")}]` : "[]";
      const rBStr = routesB.length > 0 ? `[${routesB.join(", ")}]` : "[]";

      console.log(`    Pasos y rutas: A=${sAStr} ${rAStr} vs B=${sBStr} ${rBStr}`);

      if (resA.stage === "replan") {
        const actA = cA.replanAction ?? (cA.repetitions[0]?.parsedOutput as any)?.action ?? "N/D";
        const actB = cB.replanAction ?? (cB.repetitions[0]?.parsedOutput as any)?.action ?? "N/D";
        console.log(`    Acción replan: A=${actA} vs B=${actB}`);
      }
    }

    // Descriptivo para stage_verification (status y pregunta al usuario)
    if (resA.stage === "stage_verification") {
      const stA = cA.stageVerificationStatus ?? (cA.repetitions[0]?.parsedOutput as any)?.status ?? "N/D";
      const stB = cB.stageVerificationStatus ?? (cB.repetitions[0]?.parsedOutput as any)?.status ?? "N/D";
      const qA = (cA.repetitions[0]?.parsedOutput as any)?.question_for_user ? "sí" : "no";
      const qB = (cB.repetitions[0]?.parsedOutput as any)?.question_for_user ? "sí" : "no";
      console.log(`    Estado de etapa: A=${stA} (pregunta: ${qA}) vs B=${stB} (pregunta: ${qB})`);
    }

    // Descriptivo para final_response (longitud y vista comparativa del texto generado)
    if (resA.stage === "final_response") {
      const textA =
        cA.finalResponseText ??
        cA.repetitions[0]?.finalResponseText ??
        (cA.repetitions[0]?.parsedOutput as any)?.response ??
        "";
      const textB =
        cB.finalResponseText ??
        cB.repetitions[0]?.finalResponseText ??
        (cB.repetitions[0]?.parsedOutput as any)?.response ??
        "";

      const lenA = textA.length;
      const lenB = textB.length;
      const lenDelta = lenB - lenA;
      const lenSign = lenDelta >= 0 ? `+${lenDelta}` : `${lenDelta}`;

      console.log(`    Longitud de respuesta: A=${lenA} chars vs B=${lenB} chars (${lenSign} chars)`);
      console.log(`    --- Texto Respuesta A [${resA.promptType.toUpperCase()}] ---`);
      console.log(textA ? textA.split("\n").map((l: string) => `      | ${l}`).join("\n") : "      (vacía)");
      console.log(`    --- Texto Respuesta B [${resB.promptType.toUpperCase()}${resB.variantId ? `: ${resB.variantId}` : ""}] ---`);
      console.log(textB ? textB.split("\n").map((l: string) => `      | ${l}`).join("\n") : "      (vacía)");
    }

    // Ajuste C: mostrar probabilidades de opción esperada para choice_equals (Eos: decision_one, decision_two)
    if (cA.expectedChoiceProbability !== undefined || cB.expectedChoiceProbability !== undefined) {
      const pA = cA.expectedChoiceProbability !== undefined ? `${(cA.expectedChoiceProbability * 100).toFixed(1)}%` : "N/D";
      const pB = cB.expectedChoiceProbability !== undefined ? `${(cB.expectedChoiceProbability * 100).toFixed(1)}%` : "N/D";
      let diffMsg = "";
      if (cA.expectedChoiceProbability !== undefined && cB.expectedChoiceProbability !== undefined) {
        const pDelta = Number(((cB.expectedChoiceProbability - cA.expectedChoiceProbability) * 100).toFixed(1));
        const pSign = pDelta >= 0 ? `+${pDelta}` : `${pDelta}`;
        diffMsg = ` (Diferencia: ${pSign}%)`;
      }
      console.log(`    Probabilidad opción esperada: A=${pA} vs B=${pB}${diffMsg}`);
    }

    // Fase B: mostrar probabilidades de noul y veredicto de aprobación (Eos: step_verification)
    if (cA.noulProbabilities || cB.noulProbabilities) {
      const keys = ["ok", "cumple"];
      for (const k of keys) {
        const pAVal = cA.noulProbabilities?.[k];
        const pBVal = cB.noulProbabilities?.[k];
        const pAStr = pAVal !== undefined ? `${(pAVal * 100).toFixed(1)}%` : "N/D";
        const pBStr = pBVal !== undefined ? `${(pBVal * 100).toFixed(1)}%` : "N/D";
        let diffMsg = "";
        if (pAVal !== undefined && pBVal !== undefined) {
          const pDelta = Number(((pBVal - pAVal) * 100).toFixed(1));
          const pSign = pDelta >= 0 ? `+${pDelta}` : `${pDelta}`;
          diffMsg = ` (Diferencia: ${pSign}%)`;
        }
        console.log(`    Probabilidad '${k}': A=${pAStr} vs B=${pBStr}${diffMsg}`);
      }
      const appA = cA.noulApproved !== undefined ? (cA.noulApproved ? "APROBADO" : "RECHAZADO") : "N/D";
      const appB = cB.noulApproved !== undefined ? (cB.noulApproved ? "APROBADO" : "RECHAZADO") : "N/D";
      console.log(`    Veredicto Eos (ok y cumple > 0.5): A=${appA} vs B=${appB}`);
    }
  }

  // 3. Resumen Global
  const rateDelta = Number((resB.summary.successRatePct - resA.summary.successRatePct).toFixed(1));
  const rateSign = rateDelta >= 0 ? `+${rateDelta}` : `${rateDelta}`;

  const latGlobalDelta = resB.summary.avgLatencyMs - resA.summary.avgLatencyMs;
  const latGlobalSign = latGlobalDelta >= 0 ? `+${latGlobalDelta}` : `${latGlobalDelta}`;

  console.log(`\n--- RESUMEN GLOBAL ---`);
  console.log(`Casos evaluados:              ${casesA.length}`);
  console.log(`Split evaluado:                A=${resA.split ?? "todos"}  vs  B=${resB.split ?? "todos"}`);
  console.log(`Total repeticiones por corrida: ${resA.summary.totalRepetitions}`);
  console.log(
    `Tasa de acierto global:        A=${resA.summary.successRatePct}%  vs  B=${resB.summary.successRatePct}%  (Diferencia: ${rateSign}%)`
  );
  console.log(
    `Latencia promedio:             A=${resA.summary.avgLatencyMs}ms  vs  B=${resB.summary.avgLatencyMs}ms  (Diferencia: ${latGlobalSign}ms)`
  );
  if (resA.summary.medianLatencyMs !== undefined && resB.summary.medianLatencyMs !== undefined) {
    const medGlobalDelta = resB.summary.medianLatencyMs - resA.summary.medianLatencyMs;
    const medGlobalSign = medGlobalDelta >= 0 ? `+${medGlobalDelta}` : `${medGlobalDelta}`;
    console.log(
      `Mediana de latencia:           A=${resA.summary.medianLatencyMs}ms  vs  B=${resB.summary.medianLatencyMs}ms  (Diferencia: ${medGlobalSign}ms)`
    );
  }
  console.log(
    `Errores sintácticos de JSON:   A=${resA.summary.jsonErrors}  vs  B=${resB.summary.jsonErrors}`
  );
  console.log(
    `Errores de validación Schema:  A=${resA.summary.schemaErrors}  vs  B=${resB.summary.schemaErrors}`
  );

  console.log(`\n--- DISTRIBUCIÓN DE CASOS ---`);
  console.log(`Casos que mejoran:  ${improved.length} ${improved.length > 0 ? `[${improved.join(", ")}]` : ""}`);
  console.log(`Casos que empeoran: ${worsened.length} ${worsened.length > 0 ? `[${worsened.join(", ")}]` : ""}`);
  console.log(`Casos neutros:      ${neutral.length}`);

  // Advertencias de fidelidad
  const allWarnings = [
    ...(resA.fidelityWarnings?.map((w) => `[Corrida A / Caso ${w.caseId}] ${w.parameter}: ${w.message}`) || []),
    ...(resB.fidelityWarnings?.map((w) => `[Corrida B / Caso ${w.caseId}] ${w.parameter}: ${w.message}`) || []),
  ];
  if (allWarnings.length > 0) {
    console.log(`\n--- ADVERTENCIAS DE FIDELIDAD ---`);
    for (const w of allWarnings) {
      console.log(`⚠ ${w}`);
    }
  }

  console.log(`\n* NOTA: Este informe es estrictamente cuantitativo y descriptivo.`);
  console.log(`  Con muestras pequeñas (N bajo) las diferencias observadas pueden corresponder a`);
  console.log(`  variaciones estocásticas propias de los modelos y no implican significancia estadística.`);
  console.log(`============================================================\n`);
}

// Ejecución CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("Uso: npx tsx lab/evaluate.ts <resultadoA.json> <resultadoB.json>");
    process.exit(1);
  }

  try {
    compareRuns(args[0], args[1]);
  } catch (err: any) {
    console.error(`\n[FATAL] Error en la evaluación comparativa: ${err.message}`);
    process.exit(1);
  }
}
