import type React from "react";
import type { JarvisConfig } from "../../../types/api.ts";
import {
  CollapsibleGroup,
  GroupHeading,
  NumberField,
  ReadOnlyField,
  SectionHeader,
  ToggleRow,
} from "../components/FieldPrimitives.tsx";

interface ExecutionSectionProps {
  config: JarvisConfig;
  onUpdate: (patch: Partial<JarvisConfig>) => void;
  onValidityChange: (id: string, isValid: boolean) => void;
  forceOpenExperimental?: boolean;
  forceOpenMcp?: boolean;
}

const formatArgs = (args?: string[]): string =>
  (args ?? []).map((arg) => (arg === "" || /\s/.test(arg) ? `"${arg}"` : arg)).join(" ");

export const ExecutionSection: React.FC<ExecutionSectionProps> = ({
  config,
  onUpdate,
  onValidityChange,
  forceOpenExperimental = false,
  forceOpenMcp = false,
}) => (
  <div className="flex flex-col gap-5">
    <SectionHeader
      title="Ejecución, herramientas y MCP"
      description="Controla plazos de espera de herramientas, búsqueda web, opciones de revisión y comando de servidores MCP."
    />

    {/* Plazos de herramientas y terminal */}
    <div className="flex flex-col gap-3">
      <GroupHeading title="Timeouts y espera de terminal" subtitle="Se aplican en vivo por llamada" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <NumberField
          id="cfg-mcp-timeout"
          label="MCPs (stdio)"
          unit="ms"
          value={config.mcpTimeoutMs}
          onChange={(mcpTimeoutMs) => onUpdate({ mcpTimeoutMs })}
          onValidityChange={onValidityChange}
        />
        <NumberField
          id="cfg-web-judge-timeout"
          label="Juez búsqueda web"
          unit="ms"
          value={config.webJudgeTimeoutMs ?? 15000}
          onChange={(webJudgeTimeoutMs) => onUpdate({ webJudgeTimeoutMs })}
          onValidityChange={onValidityChange}
        />
        <NumberField
          id="cfg-runcmd-default"
          label="run_command base"
          unit="seg"
          value={config.runCommandDefaultWaitSec ?? 5}
          onChange={(runCommandDefaultWaitSec) => onUpdate({ runCommandDefaultWaitSec })}
          onValidityChange={onValidityChange}
        />
        <NumberField
          id="cfg-runcmd-max"
          label="run_command tope"
          unit="seg"
          value={config.runCommandMaxWaitSec ?? 60}
          onChange={(runCommandMaxWaitSec) => onUpdate({ runCommandMaxWaitSec })}
          onValidityChange={onValidityChange}
        />
      </div>
    </div>

    {/* Búsqueda web y revisión */}
    <div className="flex flex-col gap-2.5 pt-2 border-t border-slate-800/80">
      <GroupHeading title="Búsqueda web y guardias del flujo" />
      <ToggleRow
        id="cfg-web-judge"
        title="Juez de fragmentos en búsqueda web"
        codeKey="webSearchUseJudge"
        checked={Boolean(config.webSearchUseJudge ?? true)}
        onChange={(webSearchUseJudge) => onUpdate({ webSearchUseJudge })}
        statusText={{ on: "Activo", off: "Solo BM25" }}
        description="Puntúa los fragmentos devueltos por web_search usando el modelo de decisión (2B). Apagado usa únicamente orden léxico (BM25)."
      />
    </div>

    {/* Opciones experimentales */}
    <CollapsibleGroup
      title="Guardias experimentales de revisión y cierre"
      subtitle="Apagadas por defecto; se leen en cada llamada"
      forceOpen={forceOpenExperimental}
    >
      <ToggleRow
        id="cfg-review-full-view"
        title="Vista extendida para Decisión 3"
        codeKey="reviewFullView"
        checked={Boolean(config.reviewFullView)}
        onChange={(reviewFullView) => onUpdate({ reviewFullView })}
        description="Decisión 3 recibe además las últimas lecturas y datos del entorno al revisar argumentos."
      />
      <ToggleRow
        id="cfg-review-reads"
        title="Revisar también lecturas en Decisión 3"
        codeKey="reviewReads"
        checked={Boolean(config.reviewReads)}
        onChange={(reviewReads) => onUpdate({ reviewReads })}
        description="Pasa las herramientas de solo lectura por Decisión 3 antes de ejecutarlas."
      />
      <ToggleRow
        id="cfg-coverage-guard"
        title="Guardia de cobertura al cerrar tarea"
        codeKey="completionCoverageGuard"
        checked={Boolean(config.completionCoverageGuard)}
        onChange={(completionCoverageGuard) => onUpdate({ completionCoverageGuard })}
        description="Impide cerrar la tarea en Decisión 5 si la instrucción menciona un archivo que ninguna llamada consultó o modificó."
      />
    </CollapsibleGroup>

    {/* Servidores MCP locales (solo lectura) */}
    <CollapsibleGroup
      title="Comandos de arranque MCP (solo lectura)"
      subtitle="Free Search"
      forceOpen={forceOpenMcp}
    >
      <p className="text-[11px] text-slate-400 leading-relaxed">
        El comando y los argumentos de arranque son de solo lectura por seguridad. Para modificarlos, edite <code className="font-mono text-slate-200">jarvis-config.json</code> y reinicie el backend.
      </p>
      <div className="grid grid-cols-1 gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <ReadOnlyField
            id="cfg-search-cmd"
            label="Free Search (cmd)"
            value={config.freeSearchMcp?.command || ""}
            placeholder="uvx"
          />
          <div className="sm:col-span-2">
            <ReadOnlyField
              id="cfg-search-args"
              label="Argumentos"
              value={formatArgs(config.freeSearchMcp?.args)}
              placeholder="--from free-search-mcp==0.18.0 free-search-mcp"
            />
          </div>
        </div>
      </div>
    </CollapsibleGroup>
  </div>
);
