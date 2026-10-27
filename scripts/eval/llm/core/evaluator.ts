import {
  parseJsonObject,
  parsePlanSteps,
  validateArgs,
  stripThink,
} from "../../../../src/core/reasoner/qwen.ts";
import type {
  LlmTestCase,
  PlanEvaluationExpectation,
  ReplanEvaluationExpectation,
  ArgumentsEvaluationExpectation,
  FinalResponseEvaluationExpectation,
} from "./types.ts";

export interface EvaluationContext {
  finishReason?: string;
}

export interface EvaluationOutcome {
  passed: boolean;
  parsedOutput?: any;
  /** Checks pass/fail. */
  metrics: Record<string, boolean>;
  /** Valores medidos que no son pass/fail. */
  measurements: Record<string, number | string>;
  errors: string[];
  /** Desvíos del formato pedido por el prompt que producción tolera (no afectan `passed`). */
  warnings: string[];
}

type StepLike = { id: unknown; route: string; instruction: string };

interface StepLimits {
  minSteps?: number;
  maxSteps?: number;
  allowedRoutes?: string[];
}

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function findMissing(text: string, needles: string[]): string[] {
  const hay = norm(text);
  return needles.filter((n) => !hay.includes(norm(n)));
}

function findPresent(text: string, needles: string[]): string[] {
  const hay = norm(text);
  return needles.filter((n) => hay.includes(norm(n)));
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const body = Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",");
    return `{${body}}`;
  }
  return JSON.stringify(v) ?? "undefined";
}

function createCollector() {
  const metrics: Record<string, boolean> = {};
  const measurements: Record<string, number | string> = {};
  const errors: string[] = [];
  const warnings: string[] = [];
  return {
    metrics,
    measurements,
    errors,
    warnings,
    soft(key: string, ok: boolean, warningMessage: string): boolean {
      metrics[key] = ok;
      if (!ok) warnings.push(warningMessage);
      return ok;
    },
    check(key: string, ok: boolean, errorMessage: string): boolean {
      metrics[key] = ok;
      if (!ok) errors.push(errorMessage);
      return ok;
    },
    finish(parsedOutput?: unknown): EvaluationOutcome {
      return { passed: errors.length === 0, parsedOutput, metrics, measurements, errors, warnings };
    },
  };
}

type Collector = ReturnType<typeof createCollector>;

function describeParseFailure(rawOutput: string, ctx?: EvaluationContext): string {
  const visible = stripThink(rawOutput).trim();
  const empty = rawOutput.trim().length === 0;
  if (ctx?.finishReason === "length") {
    return `Salida truncada por límite de tokens (finish_reason=length)${empty ? "; content vacío" : ""}. Producción descarta toda salida truncada.`;
  }
  if (empty) {
    return `El modelo devolvió content vacío (finish_reason=${ctx?.finishReason ?? "desconocido"}).`;
  }
  if (!visible) return "El output solo contiene un bloque <think> sin respuesta visible.";
  if (!visible.includes("{")) return "El output no contiene ningún objeto JSON (texto libre).";
  return "Se encontró '{' pero no se pudo parsear un objeto JSON válido.";
}

function parseFailure(rawOutput: string, ctx?: EvaluationContext): EvaluationOutcome {
  const c = createCollector();
  c.metrics.valid_json = false;
  c.errors.push(describeParseFailure(rawOutput, ctx));
  if (ctx?.finishReason) c.measurements.finish_reason = ctx.finishReason;
  return c.finish();
}

function truncatedFailure(rawOutput: string, ctx: EvaluationContext): EvaluationOutcome {
  const c = createCollector();
  c.check("not_truncated", false, describeParseFailure(rawOutput, ctx));
  c.measurements.finish_reason = "length";
  return c.finish();
}

function checkSteps(c: Collector, steps: StepLike[], limits: StepLimits, scope: string): void {
  c.measurements.steps_count = steps.length;

  if (limits.minSteps !== undefined) {
    c.check(
      "min_steps_met",
      steps.length >= limits.minSteps,
      `Cantidad de pasos${scope} (${steps.length}) menor al mínimo (${limits.minSteps}).`
    );
  }

  if (limits.maxSteps !== undefined) {
    c.check(
      "max_steps_met",
      steps.length <= limits.maxSteps,
      `Cantidad de pasos${scope} (${steps.length}) supera el máximo (${limits.maxSteps}).`
    );
  }

  if (limits.allowedRoutes && limits.allowedRoutes.length > 0) {
    const allowed = limits.allowedRoutes;
    const invalid = steps.filter((s) => !allowed.includes(s.route));
    c.check(
      "routes_allowed",
      invalid.length === 0,
      `Pasos con rutas no permitidas${scope}: ${invalid.map((s) => `${String(s.id)}:${s.route}`).join(", ")}`
    );
  }
}

export function evaluatePlan(
  rawOutput: string,
  expect: PlanEvaluationExpectation,
  ctx?: EvaluationContext
): EvaluationOutcome {
  const parsed = parseJsonObject(rawOutput);
  if (!parsed) return parseFailure(rawOutput, ctx);

  const c = createCollector();
  c.metrics.valid_json = true;

  c.soft(
    "has_objective",
    typeof parsed.objective === "string" && parsed.objective.trim().length > 0,
    "Falta 'objective' o está vacío (producción usa el mensaje del usuario como respaldo)."
  );

  const stepsRes = parsePlanSteps(parsed.steps, 1, expect.allowEmpty ?? true);
  if ("error" in stepsRes) {
    c.check("valid_steps_structure", false, `Error al validar pasos del plan: ${stepsRes.error}`);
    return c.finish(parsed);
  }
  c.metrics.valid_steps_structure = true;

  const steps = stepsRes.steps;
  checkSteps(c, steps, expect, "");

  if (expect.firstRoute) {
    c.check(
      "first_route_matches",
      steps[0]?.route === expect.firstRoute,
      `El primer paso debe usar '${expect.firstRoute}', pero usa '${steps[0]?.route ?? "ninguno"}'.`
    );
  }

  if (expect.requiredRoutes && expect.requiredRoutes.length > 0) {
    const used = new Set<string>(steps.map((s) => s.route));
    const missing = expect.requiredRoutes.filter((r) => !used.has(r));
    c.check("required_routes_used", missing.length === 0, `Rutas requeridas no usadas: ${missing.join(", ")}`);
  }

  const goalsText = steps.map((s) => s.instruction).join(" ");

  if (expect.requiredKeywordsInGoal && expect.requiredKeywordsInGoal.length > 0) {
    const missing = findMissing(goalsText, expect.requiredKeywordsInGoal);
    c.check(
      "required_keywords_met",
      missing.length === 0,
      `Faltan palabras clave requeridas en los pasos del plan: ${missing.join(", ")}`
    );
  }

  if (expect.forbiddenKeywordsInGoal && expect.forbiddenKeywordsInGoal.length > 0) {
    const found = findPresent(goalsText, expect.forbiddenKeywordsInGoal);
    c.check(
      "no_forbidden_keywords",
      found.length === 0,
      `Palabras prohibidas presentes en los pasos del plan: ${found.join(", ")}`
    );
  }

  return c.finish(parsed);
}

export function evaluateReplan(
  rawOutput: string,
  expect: ReplanEvaluationExpectation,
  ctx?: EvaluationContext
): EvaluationOutcome {
  const parsed = parseJsonObject(rawOutput);
  if (!parsed) return parseFailure(rawOutput, ctx);

  const c = createCollector();
  c.metrics.valid_json = true;

  const action = parsed.action;
  c.measurements.action = typeof action === "string" ? action : "unknown";

  if (action !== "continue" && action !== "abort") {
    c.check("valid_action", false, `Acción inválida '${action}'; debe ser 'continue' o 'abort'.`);
    return c.finish(parsed);
  }
  c.metrics.valid_action = true;

  if (expect.expectedAction) {
    c.check(
      "action_matches_expected",
      action === expect.expectedAction,
      `Se esperaba acción '${expect.expectedAction}', pero el modelo eligió '${action}'.`
    );
  }

  if (action === "abort") {
    c.soft(
      "has_abort_reason",
      typeof parsed.reason === "string" && parsed.reason.trim().length > 0,
      "Acción es 'abort' pero falta 'reason' descriptivo (producción usa un motivo genérico)."
    );
    c.soft(
      "abort_steps_empty",
      Array.isArray(parsed.steps) && parsed.steps.length === 0,
      "Acción es 'abort' pero 'steps' no es un array vacío (producción ignora 'steps' en abort)."
    );
    return c.finish(parsed);
  }

  c.soft(
    "has_objective",
    typeof parsed.objective === "string" && parsed.objective.trim().length > 0,
    "Acción es 'continue' pero falta 'objective' (producción usa el objetivo previo como respaldo)."
  );

  const stepsRes = parsePlanSteps(parsed.steps, 1, false);
  if ("error" in stepsRes) {
    c.check("valid_steps_structure", false, `Error en los pasos del replan: ${stepsRes.error}`);
    return c.finish(parsed);
  }
  c.metrics.valid_steps_structure = true;

  const steps = stepsRes.steps;
  checkSteps(c, steps, expect, " de replan");

  const goalsText = steps.map((s) => s.instruction).join(" ");

  if (expect.mustNotRepeatEffects && expect.effects && expect.effects.length > 0) {
    const repeated = findPresent(goalsText, expect.effects);
    c.check(
      "respects_effects",
      repeated.length === 0,
      `Replan repite acciones que ya constaban como EFFECTS aplicados: ${repeated.join("; ")}`
    );
  }

  if (expect.mustNotRepeatCompleted && expect.completedSteps && expect.completedSteps.length > 0) {
    const repeated = findPresent(goalsText, expect.completedSteps);
    c.check(
      "respects_completed",
      repeated.length === 0,
      `Replan repite pasos ya completados: ${repeated.join("; ")}`
    );
  }

  return c.finish(parsed);
}

export function evaluateArguments(
  rawOutput: string,
  schema: Record<string, any> | undefined,
  expect: ArgumentsEvaluationExpectation,
  ctx?: EvaluationContext
): EvaluationOutcome {
  const parsedRaw = parseJsonObject(rawOutput);
  if (!parsedRaw) return parseFailure(rawOutput, ctx);

  const c = createCollector();
  c.metrics.valid_json = true;

  // Igual que producción: null en un parámetro opcional equivale a "no usado".
  const required: string[] = Array.isArray(schema?.required) ? (schema?.required as string[]) : [];
  const parsed: Record<string, unknown> = { ...parsedRaw };
  for (const k of Object.keys(parsed)) {
    if (parsed[k] === null && !required.includes(k)) delete parsed[k];
  }

  if (schema) {
    const valErr = validateArgs(parsed, schema);
    c.check("schema_valid", !valErr, `Violación de schema: ${valErr}`);
  }

  if (expect.requiredFields) {
    const missing = expect.requiredFields.filter((f) => parsed[f] === undefined || parsed[f] === null);
    c.check(
      "required_fields_present",
      missing.length === 0,
      `Faltan campos esperados en args: ${missing.join(", ")}`
    );
  }

  if (expect.noInventedFields) {
    const props =
      schema && schema.properties && typeof schema.properties === "object"
        ? Object.keys(schema.properties)
        : null;
    if (props) {
      const invented = Object.keys(parsed).filter((k) => !props.includes(k));
      c.check(
        "no_invented_fields",
        invented.length === 0,
        `Campos inventados fuera del schema: ${invented.join(", ")}`
      );
    } else {
      c.check(
        "no_invented_fields",
        false,
        "El caso exige noInventedFields pero no define schema.properties; no se pudo evaluar."
      );
    }
  }

  if (expect.exactFieldValues) {
    for (const [key, val] of Object.entries(expect.exactFieldValues)) {
      const got = stableStringify(parsed[key]);
      const want = stableStringify(val);
      c.check(`field_${key}_match`, got === want, `Campo '${key}': esperado ${want}, recibido ${got}`);
    }
  }

  if (expect.allowedRefTokens) {
    const allowed = expect.allowedRefTokens;
    const usedRefs: string[] = JSON.stringify(parsed).match(/\{\{ref:r\d+\}\}/g) || [];
    const invalidRefs = usedRefs.filter((r) => !allowed.includes(r));
    c.check(
      "valid_refs",
      invalidRefs.length === 0,
      `Uso de tokens ref no permitidos o inventados: ${invalidRefs.join(", ")}`
    );
  }

  if (expect.forbiddenHardcodedValues) {
    const found = findPresent(JSON.stringify(parsed), expect.forbiddenHardcodedValues);
    c.check(
      "no_forbidden_values",
      found.length === 0,
      `Valores hardcodeados prohibidos encontrados: ${found.join(", ")}`
    );
  }

  for (const chk of expect.jsonStringFields ?? []) {
    const raw = parsed[chk.field];
    let value: unknown;
    let valid = false;
    if (typeof raw === "string") {
      try {
        value = JSON.parse(raw);
        valid = true;
      } catch {
        // JSON inválido
      }
    }
    c.check(`field_${chk.field}_json`, valid, `Campo '${chk.field}' no es un string JSON válido.`);
    if (!valid) continue;

    const is2d = (v: unknown) => Array.isArray(v) && v.length > 0 && v.every((r) => Array.isArray(r));
    if (chk.shape === "array2d") {
      c.check(`field_${chk.field}_array2d`, is2d(value), `Campo '${chk.field}' no es un array 2D de filas.`);
    } else if (chk.shape === "sheets") {
      const o = value as Record<string, unknown> | null;
      const ok =
        !!o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).length > 0 && Object.values(o).every(is2d);
      c.check(`field_${chk.field}_sheets`, ok, `Campo '${chk.field}' no es un objeto {Hoja: [[...]]}.`);
    }
    if (chk.includes && chk.includes.length > 0) {
      const missing = findMissing(raw as string, chk.includes);
      c.check(
        `field_${chk.field}_includes`,
        missing.length === 0,
        `Campo '${chk.field}' no incluye: ${missing.join("; ")}`
      );
    }
  }

  return c.finish(parsed);
}

export function evaluateFinalResponse(
  rawOutput: string,
  expect: FinalResponseEvaluationExpectation,
  ctx?: EvaluationContext
): EvaluationOutcome {
  const c = createCollector();
  const text = stripThink(rawOutput).trim();
  c.measurements.length_chars = text.length;

  if (!c.check("non_empty", text.length > 0, `Respuesta final vacía (finish_reason=${ctx?.finishReason ?? "desconocido"}).`)) {
    return c.finish(text);
  }

  c.check(
    "not_truncated",
    ctx?.finishReason !== "length",
    "Respuesta final truncada por límite de tokens (finish_reason=length)."
  );

  if (expect.minChars !== undefined) {
    c.check(
      "min_chars_met",
      text.length >= expect.minChars,
      `Respuesta demasiado corta (${text.length} caracteres, mínimo ${expect.minChars}).`
    );
  }

  if (expect.mustContainFacts) {
    const missing = findMissing(text, expect.mustContainFacts);
    c.check(
      "facts_retained",
      missing.length === 0,
      `La respuesta final no incluye hechos obligatorios: ${missing.join("; ")}`
    );
  }

  if (expect.mustMentionEffects) {
    const missing = findMissing(text, expect.mustMentionEffects);
    c.check(
      "effects_mentioned",
      missing.length === 0,
      `La respuesta final no menciona efectos esperados en el sistema: ${missing.join("; ")}`
    );
  }

  if (expect.forbiddenHallucinations) {
    const found = findPresent(text, expect.forbiddenHallucinations);
    c.check(
      "no_hallucinations",
      found.length === 0,
      `Alucinaciones o datos falsos detectados en respuesta final: ${found.join("; ")}`
    );
  }

  return c.finish(text);
}

export function evaluateTestCase(
  testCase: LlmTestCase,
  rawOutput: string,
  ctx?: EvaluationContext
): EvaluationOutcome {
  if (ctx?.finishReason === "length" && testCase.stage !== "final_response") {
    return truncatedFailure(rawOutput, ctx);
  }

  const argsSchema =
    testCase.input.prompt?.stage === "arguments"
      ? testCase.input.prompt.data.tool.inputSchema
      : testCase.input.schema;

  switch (testCase.stage) {
    case "plan":
      return evaluatePlan(rawOutput, testCase.expect.plan || {}, ctx);
    case "replan":
      return evaluateReplan(rawOutput, testCase.expect.replan || {}, ctx);
    case "arguments":
      return evaluateArguments(rawOutput, argsSchema, testCase.expect.arguments || {}, ctx);
    case "final_response":
      return evaluateFinalResponse(rawOutput, testCase.expect.final_response || {}, ctx);
    default:
      return {
        passed: false,
        metrics: {},
        measurements: {},
        errors: [`Etapa desconocida: ${(testCase as any).stage}`],
        warnings: [],
      };
  }
}