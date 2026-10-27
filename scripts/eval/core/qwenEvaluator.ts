import {
  parseJsonObject,
  parsePlanSteps,
  validateArgs,
  stripThink,
} from "../../../src/core/reasoner/qwen.ts";
import type {
  QwenTestCase,
  QwenEvalStage,
  PlanEvaluationExpectation,
  ReplanEvaluationExpectation,
  ArgumentsEvaluationExpectation,
  FinalResponseEvaluationExpectation,
} from "./qwenTypes.ts";

export interface EvaluationOutcome {
  passed: boolean;
  parsedOutput?: any;
  metrics: Record<string, boolean | number | string | undefined>;
  errors: string[];
}

export function evaluatePlan(rawOutput: string, expect: PlanEvaluationExpectation): EvaluationOutcome {
  const metrics: Record<string, boolean | number | string | undefined> = {};
  const errors: string[] = [];

  const parsed = parseJsonObject(rawOutput);
  if (!parsed) {
    return {
      passed: false,
      metrics: { valid_json: false },
      errors: ["No se pudo extraer o parsear un objeto JSON válido del output."],
    };
  }
  metrics.valid_json = true;

  if (typeof parsed.objective !== "string" || !parsed.objective.trim()) {
    errors.push("Falta 'objective' o está vacío.");
    metrics.has_objective = false;
  } else {
    metrics.has_objective = true;
  }

  const stepsRes = parsePlanSteps(parsed.steps, 1, expect.allowEmpty ?? true);
  if ("error" in stepsRes) {
    errors.push(`Error al validar pasos del plan: ${stepsRes.error}`);
    metrics.valid_steps_structure = false;
    return { passed: false, parsedOutput: parsed, metrics, errors };
  }
  metrics.valid_steps_structure = true;

  const steps = stepsRes.steps;
  metrics.steps_count = steps.length;

  if (expect.minSteps !== undefined && steps.length < expect.minSteps) {
    errors.push(`Cantidad de pasos (${steps.length}) menor al mínimo esperado (${expect.minSteps}).`);
    metrics.min_steps_met = false;
  } else {
    metrics.min_steps_met = true;
  }

  if (expect.maxSteps !== undefined && steps.length > expect.maxSteps) {
    errors.push(`Cantidad de pasos (${steps.length}) supera el máximo permitido (${expect.maxSteps}).`);
    metrics.max_steps_met = false;
  } else {
    metrics.max_steps_met = true;
  }

  if (expect.allowedRoutes && expect.allowedRoutes.length > 0) {
    const invalidRouteSteps = steps.filter((s) => !expect.allowedRoutes!.includes(s.route));
    if (invalidRouteSteps.length > 0) {
      errors.push(
        `Pasos con rutas no permitidas: ${invalidRouteSteps.map((s) => `${s.id}:${s.route}`).join(", ")}`
      );
      metrics.routes_allowed = false;
    } else {
      metrics.routes_allowed = true;
    }
  }

  if (expect.requiredKeywordsInGoal && expect.requiredKeywordsInGoal.length > 0) {
    const allGoals = steps.map((s) => s.instruction.toLowerCase()).join(" ");
    const missing = expect.requiredKeywordsInGoal.filter((k) => !allGoals.includes(k.toLowerCase()));
    if (missing.length > 0) {
      errors.push(`Faltan palabras clave requeridas en los pasos del plan: ${missing.join(", ")}`);
      metrics.required_keywords_met = false;
    } else {
      metrics.required_keywords_met = true;
    }
  }

  return {
    passed: errors.length === 0,
    parsedOutput: parsed,
    metrics,
    errors,
  };
}

export function evaluateReplan(rawOutput: string, expect: ReplanEvaluationExpectation): EvaluationOutcome {
  const metrics: Record<string, boolean | number | string | undefined> = {};
  const errors: string[] = [];

  const parsed = parseJsonObject(rawOutput);
  if (!parsed) {
    return {
      passed: false,
      metrics: { valid_json: false },
      errors: ["No se pudo extraer o parsear un objeto JSON válido del output."],
    };
  }
  metrics.valid_json = true;

  const action = parsed.action;
  metrics.action = typeof action === "string" ? action : "unknown";

  if (action !== "continue" && action !== "abort") {
    errors.push(`Acción inválida '${action}'; debe ser 'continue' o 'abort'.`);
    metrics.valid_action = false;
    return { passed: false, parsedOutput: parsed, metrics, errors };
  }
  metrics.valid_action = true;

  if (expect.expectedAction && action !== expect.expectedAction) {
    errors.push(`Se esperaba acción '${expect.expectedAction}', pero el modelo eligió '${action}'.`);
    metrics.action_matches_expected = false;
  } else {
    metrics.action_matches_expected = true;
  }

  if (action === "abort") {
    if (typeof parsed.reason !== "string" || !parsed.reason.trim()) {
      errors.push("Acción es 'abort' pero falta 'reason' descriptivo.");
      metrics.has_abort_reason = false;
    } else {
      metrics.has_abort_reason = true;
    }
    const stepsArray = Array.isArray(parsed.steps) ? parsed.steps : null;
    if (!stepsArray || stepsArray.length > 0) {
      errors.push("Acción es 'abort' pero 'steps' no está vacío.");
      metrics.abort_steps_empty = false;
    } else {
      metrics.abort_steps_empty = true;
    }
  } else if (action === "continue") {
    if (typeof parsed.objective !== "string" || !parsed.objective.trim()) {
      errors.push("Acción es 'continue' pero falta 'objective'.");
      metrics.has_objective = false;
    } else {
      metrics.has_objective = true;
    }

    const stepsRes = parsePlanSteps(parsed.steps, 1, false);
    if ("error" in stepsRes) {
      errors.push(`Error en los pasos del replan: ${stepsRes.error}`);
      metrics.valid_steps_structure = false;
    } else {
      metrics.valid_steps_structure = true;
      const steps = stepsRes.steps;
      metrics.steps_count = steps.length;

      if (expect.minSteps !== undefined && steps.length < expect.minSteps) {
        errors.push(`Cantidad de pasos de replan (${steps.length}) menor al mínimo (${expect.minSteps}).`);
        metrics.min_steps_met = false;
      } else {
        metrics.min_steps_met = true;
      }

      if (expect.maxSteps !== undefined && steps.length > expect.maxSteps) {
        errors.push(`Cantidad de pasos de replan (${steps.length}) excede el máximo (${expect.maxSteps}).`);
        metrics.max_steps_met = false;
      } else {
        metrics.max_steps_met = true;
      }

      if (expect.allowedRoutes && expect.allowedRoutes.length > 0) {
        const invalid = steps.filter((s) => !expect.allowedRoutes!.includes(s.route));
        if (invalid.length > 0) {
          errors.push(`Pasos con rutas no permitidas en replan: ${invalid.map((s) => s.route).join(", ")}`);
          metrics.routes_allowed = false;
        } else {
          metrics.routes_allowed = true;
        }
      }

      if (expect.mustNotRepeatEffects && expect.effects && expect.effects.length > 0) {
        const allGoals = steps.map((s) => s.instruction.toLowerCase()).join(" ");
        const repeated = expect.effects.filter((eff) => allGoals.includes(eff.toLowerCase()));
        if (repeated.length > 0) {
          errors.push(`Replan repite acciones que ya constaban como EFFECTS aplicados: ${repeated.join("; ")}`);
          metrics.respects_effects = false;
        } else {
          metrics.respects_effects = true;
        }
      }

      if (expect.mustNotRepeatCompleted && expect.completedSteps && expect.completedSteps.length > 0) {
        const allGoals = steps.map((s) => s.instruction.toLowerCase()).join(" ");
        const repeated = expect.completedSteps.filter((cs) => allGoals.includes(cs.toLowerCase()));
        if (repeated.length > 0) {
          errors.push(`Replan repite pasos ya completados: ${repeated.join("; ")}`);
          metrics.respects_completed = false;
        } else {
          metrics.respects_completed = true;
        }
      }
    }
  }

  return {
    passed: errors.length === 0,
    parsedOutput: parsed,
    metrics,
    errors,
  };
}

export function evaluateArguments(
  rawOutput: string,
  schema: Record<string, any> | undefined,
  expect: ArgumentsEvaluationExpectation
): EvaluationOutcome {
  const metrics: Record<string, boolean | number | string | undefined> = {};
  const errors: string[] = [];

  const parsed = parseJsonObject(rawOutput);
  if (!parsed) {
    return {
      passed: false,
      metrics: { valid_json: false },
      errors: ["Argumentos no forman un objeto JSON válido."],
    };
  }
  metrics.valid_json = true;

  if (schema) {
    const valErr = validateArgs(parsed, schema);
    if (valErr) {
      errors.push(`Violación de schema: ${valErr}`);
      metrics.schema_valid = false;
    } else {
      metrics.schema_valid = true;
    }
  }

  if (expect.requiredFields) {
    const missing = expect.requiredFields.filter((f) => parsed[f] === undefined || parsed[f] === null);
    if (missing.length > 0) {
      errors.push(`Faltan campos esperados en args: ${missing.join(", ")}`);
      metrics.required_fields_present = false;
    } else {
      metrics.required_fields_present = true;
    }
  }

  if (expect.exactFieldValues) {
    for (const [key, val] of Object.entries(expect.exactFieldValues)) {
      if (JSON.stringify(parsed[key]) !== JSON.stringify(val)) {
        errors.push(`Campo '${key}': esperado ${JSON.stringify(val)}, recibido ${JSON.stringify(parsed[key])}`);
        metrics[`field_${key}_match`] = false;
      } else {
        metrics[`field_${key}_match`] = true;
      }
    }
  }

  if (expect.allowedRefTokens) {
    const stringified = JSON.stringify(parsed);
    const usedRefs = stringified.match(/\{\{ref:r\d+\}\}/g) || [];
    const invalidRefs = usedRefs.filter((r) => !expect.allowedRefTokens!.includes(r));
    if (invalidRefs.length > 0) {
      errors.push(`Uso de tokens ref no permitidos o inventados: ${invalidRefs.join(", ")}`);
      metrics.valid_refs = false;
    } else {
      metrics.valid_refs = true;
    }
  }

  if (expect.forbiddenHardcodedValues) {
    const stringified = JSON.stringify(parsed).toLowerCase();
    const foundForbidden = expect.forbiddenHardcodedValues.filter((v) =>
      stringified.includes(v.toLowerCase())
    );
    if (foundForbidden.length > 0) {
      errors.push(`Valores harcodeados prohibidos encontrados: ${foundForbidden.join(", ")}`);
      metrics.no_forbidden_values = false;
    } else {
      metrics.no_forbidden_values = true;
    }
  }

  return {
    passed: errors.length === 0,
    parsedOutput: parsed,
    metrics,
    errors,
  };
}

export function evaluateFinalResponse(
  rawOutput: string,
  expect: FinalResponseEvaluationExpectation
): EvaluationOutcome {
  const metrics: Record<string, boolean | number | string | undefined> = {};
  const errors: string[] = [];

  const text = stripThink(rawOutput).trim();
  metrics.length_chars = text.length;

  if (expect.minChars && text.length < expect.minChars) {
    errors.push(`Respuesta demasiado corta (${text.length} caracteres, mínimo ${expect.minChars}).`);
    metrics.min_chars_met = false;
  } else {
    metrics.min_chars_met = true;
  }

  const lower = text.toLowerCase();

  if (expect.mustContainFacts) {
    const missing = expect.mustContainFacts.filter((fact) => !lower.includes(fact.toLowerCase()));
    if (missing.length > 0) {
      errors.push(`La respuesta final no incluye hechos obligatorios: ${missing.join("; ")}`);
      metrics.facts_retained = false;
    } else {
      metrics.facts_retained = true;
    }
  }

  if (expect.mustMentionEffects) {
    const missing = expect.mustMentionEffects.filter((eff) => !lower.includes(eff.toLowerCase()));
    if (missing.length > 0) {
      errors.push(`La respuesta final no menciona efectos esperados en el sistema: ${missing.join("; ")}`);
      metrics.effects_mentioned = false;
    } else {
      metrics.effects_mentioned = true;
    }
  }

  if (expect.forbiddenHallucinations) {
    const hallucinations = expect.forbiddenHallucinations.filter((h) => lower.includes(h.toLowerCase()));
    if (hallucinations.length > 0) {
      errors.push(`Alucinaciones o datos falsos detectados en respuesta final: ${hallucinations.join("; ")}`);
      metrics.no_hallucinations = false;
    } else {
      metrics.no_hallucinations = true;
    }
  }

  return {
    passed: errors.length === 0,
    parsedOutput: text,
    metrics,
    errors,
  };
}

export function evaluateTestCase(testCase: QwenTestCase, rawOutput: string): EvaluationOutcome {
  switch (testCase.stage) {
    case "plan":
      return evaluatePlan(rawOutput, testCase.expect.plan || {});
    case "replan":
      return evaluateReplan(rawOutput, testCase.expect.replan || {});
    case "arguments":
      return evaluateArguments(rawOutput, testCase.input.schema, testCase.expect.arguments || { tool: "" });
    case "final_response":
      return evaluateFinalResponse(rawOutput, testCase.expect.final_response || {});
    default:
      return {
        passed: false,
        metrics: {},
        errors: [`Etapa desconocida: ${(testCase as any).stage}`],
      };
  }
}
