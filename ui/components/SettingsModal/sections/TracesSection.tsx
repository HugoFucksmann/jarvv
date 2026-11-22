import type React from "react";
import { Laptop } from "lucide-react";
import type { JarvisConfig } from "../../../types/api.ts";
import {
  GroupHeading,
  NumberField,
  ReadOnlyField,
  SectionHeader,
  ToggleRow,
} from "../components/FieldPrimitives.tsx";

interface TracesSectionProps {
  config: JarvisConfig;
  onUpdate: (patch: Partial<JarvisConfig>) => void;
  onValidityChange: (id: string, isValid: boolean) => void;
  onOpenEnvironment?: () => void;
}

export const TracesSection: React.FC<TracesSectionProps> = ({
  config,
  onUpdate,
  onValidityChange,
  onOpenEnvironment,
}) => (
  <div className="flex flex-col gap-5">
    <SectionHeader
      title="Auditoría, trazas y retención en disco"
      description="Controla la generación de trazas D0–D5 por tarea y cuánto tiempo o espacio se conservan los datos locales."
    />

    <ToggleRow
      id="cfg-trace-enabled"
      title="Habilitar trazas de auditoría"
      codeKey="traceEnabled"
      checked={Boolean(config.traceEnabled)}
      onChange={(traceEnabled) => onUpdate({ traceEnabled })}
      statusText={{ on: "Activo", off: "Desactivado" }}
      description="Guarda una carpeta y snapshot de consultas, probabilidades y duraciones al finalizar cada tarea."
    />

    <div className="flex flex-col gap-3 pt-2 border-t border-slate-800/80">
      <GroupHeading title="Política de retención" subtitle="0 = sin límite" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <NumberField
          id="cfg-retention-days"
          label="Refs y trazas"
          unit="días"
          min={0}
          value={config.retentionDays ?? 0}
          onChange={(retentionDays) => onUpdate({ retentionDays })}
          onValidityChange={onValidityChange}
        />
        <NumberField
          id="cfg-log-retention-days"
          label="Logs de tareas"
          unit="días"
          min={0}
          value={config.logRetentionDays ?? 0}
          onChange={(logRetentionDays) => onUpdate({ logRetentionDays })}
          onValidityChange={onValidityChange}
        />
        <NumberField
          id="cfg-retention-max-mb"
          label="Tope de disco total"
          unit="MB"
          min={0}
          value={config.retentionMaxMb ?? 250}
          onChange={(retentionMaxMb) => onUpdate({ retentionMaxMb })}
          onValidityChange={onValidityChange}
        />
      </div>
    </div>

    <div className="flex flex-col gap-3 pt-2 border-t border-slate-800/80">
      <GroupHeading title="Ubicaciones en disco" subtitle="Se cambian en jarvis-config.json" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ReadOnlyField
          id="cfg-trace-dir"
          label="Carpeta de trazas (traceDir)"
          value={config.traceDir || ""}
          placeholder="jarvis-traces"
        />
        <ReadOnlyField
          id="cfg-refs-dir"
          label="Carpeta de referencias (refsDir)"
          value={config.refsDir || ""}
          placeholder="data/refs"
        />
      </div>
    </div>

    {onOpenEnvironment && (
      <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-3 flex-wrap">
        <span className="text-xs text-slate-400">
          Consulta carpetas resueltas del sistema operativo y presupuestos del motor.
        </span>
        <button
          type="button"
          onClick={onOpenEnvironment}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors cursor-pointer shrink-0"
        >
          <Laptop className="w-3.5 h-3.5 text-accent-400" />
          <span>Ver entorno PC y límites</span>
        </button>
      </div>
    )}
  </div>
);
