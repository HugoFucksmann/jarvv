import React from "react";
import type { JarvisConfig } from "../../../types/api.ts";
import {
  CollapsibleGroup,
  GroupHeading,
  NumberField,
  SectionHeader,
  TextField,
  ToggleRow,
  UrlField,
} from "../components/FieldPrimitives.tsx";

interface SectionProps {
  config: JarvisConfig;
  onUpdate: (patch: Partial<JarvisConfig>) => void;
  onValidityChange: (id: string, isValid: boolean) => void;
  forceOpenAdvanced?: boolean;
}

export const ModelsSection: React.FC<SectionProps> = ({
  config,
  onUpdate,
  onValidityChange,
  forceOpenAdvanced = false,
}) => {
  const updateMaxTokens = (key: keyof JarvisConfig["qwenMaxTokens"], value: number) => {
    onUpdate({
      qwenMaxTokens: {
        ...config.qwenMaxTokens,
        [key]: value,
      },
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title="Modelos de inferencia local"
        description="Endpoints, identificadores de modelo, tiempos de espera y parámetros avanzados de contexto."
      />

      {/* Qwen */}
      <div className="flex flex-col gap-3">
        <GroupHeading title="Modelo principal (Qwen)" subtitle="Planificación, argumentos y respuesta" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <UrlField
            id="cfg-qwen-url"
            label="URL de Ollama / endpoint"
            value={config.qwenUrl}
            placeholder="http://127.0.0.1:11434"
            onChange={(qwenUrl) => onUpdate({ qwenUrl })}
          />
          <TextField
            id="cfg-qwen-model"
            label="Tag del modelo"
            value={config.qwenModel}
            placeholder="qwen3.5:4b"
            onChange={(qwenModel) => onUpdate({ qwenModel })}
          />
        </div>

        <ToggleRow
          id="cfg-thinking"
          title="Thinking en la respuesta final"
          codeKey="thinking"
          checked={Boolean(config.thinking)}
          onChange={(thinking) => onUpdate({ thinking })}
          statusText={{ on: "Activo (think: true)", off: "Directo (más rápido)" }}
          description="El plan y la replanificación siempre usan thinking; este ajuste controla únicamente la redacción de la respuesta final."
        />
      </div>

      {/* Decision */}
      <div className="flex flex-col gap-3 pt-2 border-t border-slate-800/80">
        <GroupHeading title="Modelo de decisión (Decision 2.0)" subtitle="Ruteo, revisión D3 y verificación D4" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <UrlField
            id="cfg-decision-url"
            label="URL del servicio de decisión"
            value={config.decisionUrl}
            placeholder="http://127.0.0.1:11434"
            onChange={(decisionUrl) => onUpdate({ decisionUrl })}
          />
          <TextField
            id="cfg-decision-model"
            label="Tag del modelo"
            value={config.decisionModel}
            placeholder="d3:2b"
            onChange={(decisionModel) => onUpdate({ decisionModel })}
          />
        </div>
      </div>

      {/* Timeouts & Resiliencia */}
      <div className="flex flex-col gap-3 pt-2 border-t border-slate-800/80">
        <GroupHeading title="Timeouts de modelos y pausa ante caída" subtitle="Valores en milisegundos" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <NumberField
            id="cfg-decision-timeout"
            label="Decision 2.0"
            unit="ms"
            value={config.decisionTimeoutMs}
            onChange={(decisionTimeoutMs) => onUpdate({ decisionTimeoutMs })}
            onValidityChange={onValidityChange}
          />
          <NumberField
            id="cfg-qwen-timeout"
            label="Qwen (directo)"
            unit="ms"
            value={config.qwenTimeoutMs}
            onChange={(qwenTimeoutMs) => onUpdate({ qwenTimeoutMs })}
            onValidityChange={onValidityChange}
          />
          <NumberField
            id="cfg-qwen-thinking-timeout"
            label="Qwen (thinking)"
            unit="ms"
            value={config.qwenThinkingTimeoutMs}
            onChange={(qwenThinkingTimeoutMs) => onUpdate({ qwenThinkingTimeoutMs })}
            onValidityChange={onValidityChange}
          />
          <NumberField
            id="cfg-model-pause-max"
            label="Pausa modelo caído"
            unit="ms"
            min={0}
            hint="0 = sin pausa"
            value={config.modelUnavailablePauseMaxMs ?? 600000}
            onChange={(modelUnavailablePauseMaxMs) => onUpdate({ modelUnavailablePauseMaxMs })}
            onValidityChange={onValidityChange}
          />
        </div>
      </div>

      {/* Parámetros avanzados */}
      <CollapsibleGroup
        title="Contexto, keep-alive y límite de tokens"
        subtitle="Ajustes avanzados del motor"
        forceOpen={forceOpenAdvanced}
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <NumberField
            id="cfg-qwen-ctx"
            label="Ventana Qwen (num_ctx)"
            unit="tokens"
            value={config.qwenNumCtx}
            onChange={(qwenNumCtx) => onUpdate({ qwenNumCtx })}
            onValidityChange={onValidityChange}
          />
          <NumberField
            id="cfg-decision-ctx"
            label="Ventana Decision 2.0"
            unit="tokens"
            value={config.decisionMaxContext}
            onChange={(decisionMaxContext) => onUpdate({ decisionMaxContext })}
            onValidityChange={onValidityChange}
          />
          <TextField
            id="cfg-keep-alive"
            label="Keep-alive en Ollama"
            value={config.modelKeepAlive ?? "30m"}
            placeholder="30m"
            hint="Ej: 30m, 2h, -1 (fijo), 0 (descargar)"
            onChange={(modelKeepAlive) => onUpdate({ modelKeepAlive })}
          />
        </div>

        <GroupHeading title="Tope de tokens de salida por etapa (qwenMaxTokens)" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <NumberField
            id="cfg-max-tok-args"
            label="Argumentos"
            value={config.qwenMaxTokens.arguments}
            onChange={(v) => updateMaxTokens("arguments", v)}
            onValidityChange={onValidityChange}
          />
          <NumberField
            id="cfg-max-tok-plan"
            label="Plan"
            value={config.qwenMaxTokens.plan}
            onChange={(v) => updateMaxTokens("plan", v)}
            onValidityChange={onValidityChange}
          />
          <NumberField
            id="cfg-max-tok-replan"
            label="Replan"
            value={config.qwenMaxTokens.replan}
            onChange={(v) => updateMaxTokens("replan", v)}
            onValidityChange={onValidityChange}
          />
          <NumberField
            id="cfg-max-tok-final"
            label="Respuesta final"
            value={config.qwenMaxTokens.final}
            onChange={(v) => updateMaxTokens("final", v)}
            onValidityChange={onValidityChange}
          />
        </div>
      </CollapsibleGroup>
    </div>
  );
};
