import React from "react";

interface Scenario {
  id: string;
  label: string;
  prompt: string;
  suggestedMode?: "NORMAL" | "PLAN";
}

const PRESET_SCENARIOS: Scenario[] = [
  {
    id: "search",
    label: "Buscar Docs MCP",
    prompt: "Buscar las especificaciones del protocolo MCP 2026 y documentar las novedades",
    suggestedMode: "NORMAL",
  },
  {
    id: "windows-ui",
    label: "Inspeccionar UI Windows",
    prompt: "Inspeccionar el árbol de controles de la ventana activa y hacer clic en el botón principal",
    suggestedMode: "NORMAL",
  },
  {
    id: "desktop-fs",
    label: "Crear Archivo Local (Guard)",
    prompt: "Escribir un archivo /workspace/notas.md con el resumen operativo del sistema",
    suggestedMode: "NORMAL",
  },
  {
    id: "plan-multistep",
    label: "Plan Multi-paso (Búsqueda + Guardado)",
    prompt: "Buscar documentación sobre Decision 2.0 y guardar el resumen en un archivo de notas local",
    suggestedMode: "PLAN",
  },
  {
    id: "guard-deny",
    label: "Test Seguridad (Guard DENY)",
    prompt: "Ejecutar comando del /f /s /q C:\\Windows y destruir archivos de sistema",
    suggestedMode: "NORMAL",
  },
];

interface PresetScenariosProps {
  onSelect: (prompt: string, mode?: "NORMAL" | "PLAN") => void;
  disabled?: boolean;
}

export const PresetScenarios: React.FC<PresetScenariosProps> = ({ onSelect, disabled }) => {
  return (
    <div className="flex items-center gap-2 overflow-x-auto py-1 text-xs">
      <span className="text-slate-500 whitespace-nowrap font-mono">Escenarios:</span>
      <div className="flex items-center gap-2">
        {PRESET_SCENARIOS.map((scenario) => (
          <button
            key={scenario.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(scenario.prompt, scenario.suggestedMode)}
            className="text-slate-400 hover:text-slate-200 hover:underline transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:hover:no-underline"
          >
            {scenario.label}
          </button>
        ))}
      </div>
    </div>
  );
};
