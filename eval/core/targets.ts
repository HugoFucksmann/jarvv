/**
 * eval/core/targets.ts
 *
 * Reparte los modelos de `--model`, `--llm-model` y `--d-model` en "targets": cada target es una pasada completa
 * (variante × dataset) contra un modelo o una configuración.
 *
 * - `--model` (o ninguno): una configuración = un modelo generativo + uno de decisión → un target `all` con todas
 *   las etapas. Varias configuraciones (`--model=a+x,b+y`) → un target `all` por configuración.
 * - `--llm-model` / `--d-model`: un target por modelo, que corre solo las etapas de su tipo.
 * - Si `--stages` deja solo etapas de un tipo, el modelo del otro tipo no se usa y los targets pasan a ser uno por
 *   modelo distinto del tipo que corre.
 *
 * En todos los casos un caso se ejecuta una vez por target y los resultados de modelos distintos nunca comparten celda.
 */

import { DECISION_STAGES, GENERATIVE_STAGES } from "./case.ts";
import type { EvalConfig } from "./config.ts";
import type { StageName } from "./types.ts";

export type TargetScope = "all" | "generative" | "decision";

export interface ModelTarget {
  /** Sufijo de la carpeta de la celda y etiqueta del modelo en los reportes. `undefined` = target único `all`. */
  id: string | undefined;
  scope: TargetScope;
  /** Modelo generativo del target; null si el target no corre etapas generativas. */
  model: string | null;
  /** Modelo de decisión del target; null si no corre etapas de decisión. */
  decisionModel: string | null;
  stages: StageName[];
}

export function buildTargets(cfg: EvalConfig, stageFilter: StageName[]): ModelTarget[] {
  const gen = stageFilter.filter((s) => (GENERATIVE_STAGES as readonly string[]).includes(s));
  const dec = stageFilter.filter((s) => (DECISION_STAGES as readonly string[]).includes(s));
  const unique = (list: string[]): string[] => [...new Set(list)];
  const genModels = gen.length > 0 ? unique(cfg.models) : [];
  const decModels = dec.length > 0 ? unique(cfg.decisionModels) : [];

  // Modo común con ambos tipos de etapa: una configuración completa por target.
  if (cfg.modelScope === "all" && gen.length > 0 && dec.length > 0) {
    const many = cfg.pairs.length > 1;
    return cfg.pairs.map((p): ModelTarget => ({
      id: many ? `all-${p.model}+${p.decisionModel}` : undefined,
      scope: "all",
      model: p.model,
      decisionModel: p.decisionModel,
      stages: stageFilter,
    }));
  }

  if (genModels.length <= 1 && decModels.length <= 1) {
    return [{
      id: undefined,
      scope: gen.length > 0 && dec.length > 0 ? "all" : gen.length > 0 ? "generative" : "decision",
      model: gen.length > 0 ? genModels[0] : null,
      decisionModel: dec.length > 0 ? decModels[0] : null,
      stages: stageFilter,
    }];
  }

  return [
    ...genModels.map((m): ModelTarget => ({ id: `gen-${m}`, scope: "generative", model: m, decisionModel: null, stages: gen })),
    ...decModels.map((m): ModelTarget => ({ id: `dec-${m}`, scope: "decision", model: null, decisionModel: m, stages: dec })),
  ];
}

/** Config de un target: los clientes y el runner leen `model` / `decisionModel`. */
export function targetConfig(cfg: EvalConfig, t: ModelTarget): EvalConfig {
  return { ...cfg, model: t.model ?? cfg.model, decisionModel: t.decisionModel ?? cfg.decisionModel };
}

/** Nombre de modelo sin el prefijo `gen-` / `dec-` de `id`, para mostrar. */
export function targetModelName(t: ModelTarget, cfg: EvalConfig): string {
  if (t.scope === "generative") return t.model as string;
  if (t.scope === "decision") return t.decisionModel as string;
  return [t.model, t.decisionModel].filter((m): m is string => m !== null && m !== undefined).join(" + ") || cfg.model;
}
