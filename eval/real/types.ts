/**
 * eval/real/types.ts
 *
 * Contratos tipados del modo real (`--source=real-stage` y `--source=real-task`),
 * alineados estrictamente con `src/core/contracts.ts` y `src/core/ctx/index.ts`.
 */

import type { ContextData, JsonObject, TaskMode } from "../../src/core/ctx/index.ts";
import type { PreviousTask, ProbeQuery } from "../../src/core/contracts.ts";
import type { UserEnvironment } from "../../src/core/environment.ts";
import type { MCPTool } from "../../src/core/types.ts";
import type { ExecutableRoute } from "../../src/core/types/routes.ts";
import type { ToolInputSchema } from "../core/contract.ts";
import type { StageName } from "../core/types.ts";

/** Puntero al punto exacto de captura para reconstruir el request real de una etapa desde un snapshot. */
export interface StageTarget {
  /** `route`: rutas disponibles tras filtrado. */
  routes?: readonly ExecutableRoute[];
  /** `tool_choice`, `args_review`, `arguments`: ruta elegida. */
  route?: ExecutableRoute;
  /** `tool_choice`: nombres o definiciones completas de herramientas descubiertas. */
  tools?: readonly (string | MCPTool)[];
  /** `args_review`, `arguments`: herramienta elegida (nombre del manifest o definición MCP completa). */
  tool?: string | MCPTool;
  /** Schema de entrada cuando `tool` se pasa solo por nombre. */
  inputSchema?: ToolInputSchema;
  /** `args_review`: argumentos propuestos por el modelo. */
  args?: JsonObject;
  /** `arguments`: override de intentos previos (por defecto se deriva de `ctx`). */
  priorAttempts?: number;
  /** `arguments`: líneas de memoria relevantes. */
  memory?: readonly string[];
  /** `arguments`: entorno del usuario (carpetas sandbox o reales). */
  environment?: UserEnvironment;
  /** `result_verification`, `probe`: id de la llamada evaluada en `snapshot.calls`. */
  callId?: string;
  /** `plan`: instrucción de feedback del usuario si es `user_feedback`. */
  feedback?: string | null;
  /** `pending`: lista anterior de pendientes. */
  previous?: readonly string[];
  /** `continuation`: tarea previa del hilo. */
  previousTask?: PreviousTask;
  /** `pending`, `final`: hilo activo si la tarea continúa otra anterior. */
  thread?: PreviousTask;
  /** `fragment_judge`: necesidad de búsqueda y fragmentos a puntuar. */
  need?: string;
  fragments?: readonly string[];
  /** `probe`: consulta explícita o selector de sonda sobre `callId`. */
  probeQuery?: ProbeQuery;
  probe?: string;
  probeStage?: number;
  /** Fecha fija para constructores dependientes de `TODAY`. */
  now?: string | number | Date;
}

export interface FrozenStageCapture {
  stage: StageName;
  snapshot: ContextData;
  target: StageTarget;
  sourceInfo?: {
    kind: "trace" | "executable" | "snapshot";
    tracePath?: string;
    seq?: number;
    n?: number;
  };
}

/** Especificación declarativa para correr una tarea real hasta un punto de captura y congelar su estado. */
export interface ExecutableStopSpec {
  request: string;
  mode: TaskMode;
  /** Punto de captura: primera u ocurrencia `occurrence` (1-based) de la etapa. */
  stopAt: {
    stage: StageName;
    occurrence?: number;
  };
  /** Archivos iniciales sembrados dentro del sandbox (`sandbox/documents/...` o rutas relativas al home del sandbox). */
  files?: Record<string, string>;
  /** Tarea previa en hilo, si aplica. */
  previousTask?: PreviousTask;
  /** Hechos de memoria del usuario. */
  memory?: Array<{ key: string; value: string; source?: string }>;
  /** Fecha fija opcional (`ISO-8601`). */
  now?: string;
  /** Guión determinista para responder etapas previas al punto de parada cuando corre sin red. */
  script?: {
    firstQueryKind?: "chat" | "single" | "multi";
    continuationFollows?: boolean;
    pendingLists?: string[][];
    planSteps?: Array<Array<{ goal: string; suggested_mcp: ExecutableRoute; expected_outcome: string }>>;
    routes?: ExecutableRoute[];
    tools?: string[];
    arguments?: Array<Record<string, unknown>>;
    reviews?: Array<"approved" | "args_invalid" | "info_missing">;
    verifyCumple?: boolean[];
    probeYes?: boolean[];
    completion?: boolean[];
    questions?: string[];
    answers?: string[];
    planApprovals?: Array<{ approved: boolean; instruction?: string }>;
    toolApprovals?: Array<{ approved: boolean; instruction?: string }>;
  };
}

export interface RealStageSpecBase {
  id: string;
  stage?: StageName;
  tags?: string[];
  isRaw?: boolean;
  expect?: Record<string, unknown>;
  target?: StageTarget;
}

export type RealStageSpec =
  | (RealStageSpecBase & {
      kind: "trace";
      tracePath: string;
      seq?: number;
      atN?: number;
    })
  | (RealStageSpecBase & {
      kind: "frozen";
      snapshot: Record<string, unknown>;
    })
  | (RealStageSpecBase & {
      kind: "executable";
      executable: ExecutableStopSpec;
    });
