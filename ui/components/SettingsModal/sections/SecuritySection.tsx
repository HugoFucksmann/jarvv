import React, { useState } from "react";
import { FolderLock, Plus, ShieldAlert, Trash2, X } from "lucide-react";
import type { BlacklistEntry, JarvisConfig } from "../../../types/api.ts";
import { GroupHeading, INPUT_BASE, SectionHeader, ToggleRow } from "../components/FieldPrimitives.tsx";

interface SecuritySectionProps {
  config: JarvisConfig;
  onUpdate: (patch: Partial<JarvisConfig>) => void;
  onUpdateAllowedDirs: (dirs: string[]) => void;
}

export const SecuritySection: React.FC<SecuritySectionProps> = ({
  config,
  onUpdate,
  onUpdateAllowedDirs,
}) => {
  const [newAllowedDir, setNewAllowedDir] = useState("");
  const [showBlacklistForm, setShowBlacklistForm] = useState(false);
  const [newTool, setNewTool] = useState("");
  const [newPattern, setNewPattern] = useState("");
  const [newReason, setNewReason] = useState("");

  const allowedDirs = config.desktopCommanderMcp?.allowedDirectories || [];
  const blacklist = config.blacklist || [];

  const handleAddAllowedDir = () => {
    const dir = newAllowedDir.trim();
    if (!dir) return;
    if (!allowedDirs.includes(dir)) {
      onUpdateAllowedDirs([...allowedDirs, dir]);
    }
    setNewAllowedDir("");
  };

  const handleRemoveAllowedDir = (index: number) => {
    onUpdateAllowedDirs(allowedDirs.filter((_, i) => i !== index));
  };

  const handleAddBlacklist = () => {
    if (!newTool.trim() || !newReason.trim()) return;
    const entry: BlacklistEntry = {
      tool: newTool.trim(),
      reason: newReason.trim(),
      ...(newPattern.trim() ? { pattern: newPattern.trim() } : {}),
    };
    onUpdate({ blacklist: [...blacklist, entry] });
    setNewTool("");
    setNewPattern("");
    setNewReason("");
    setShowBlacklistForm(false);
  };

  const handleRemoveBlacklist = (index: number) => {
    onUpdate({ blacklist: blacklist.filter((_, i) => i !== index) });
  };

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title="Seguridad, Guard y políticas de acceso"
        description="Controla cuándo JARVIS pide confirmación manual, qué carpetas son accesibles y qué operaciones restringir."
      />

      {/* Políticas principales */}
      <div className="flex flex-col gap-2.5">
        <ToggleRow
          id="cfg-auto-mode"
          title="Modo automático"
          codeKey="autoMode"
          tone="yellow"
          checked={Boolean(config.autoMode)}
          onChange={(autoMode) => onUpdate({ autoMode })}
          statusText={{ on: "Activado", off: "Interactivo" }}
          description={
            <>
              Con niveles de riesgo encendidos, las operaciones amarillas pasan por Decisión 3 sin pedirte aprobación manual; las operaciones rojas (sobrescribir, eliminar, comandos o procesos) y rutas sensibles{" "}
              <strong className="text-slate-200">siguen pidiendo confirmación</strong>.
            </>
          }
        />

        <ToggleRow
          id="cfg-approval-tiers"
          title="Niveles de riesgo"
          codeKey="approvalTiers"
          tone="emerald"
          checked={Boolean(config.approvalTiers)}
          onChange={(approvalTiers) => onUpdate({ approvalTiers })}
          statusText={{ on: "Activado", off: "Desactivado" }}
          description="Verde (lecturas y creaciones reversibles en carpetas del usuario) ejecuta directo; amarillo usa Decisión 3 estricta con modo automático; rojo siempre solicita aprobación al usuario."
        />
      </div>

      {/* Carpetas permitidas */}
      <div className="flex flex-col gap-2.5 pt-2 border-t border-slate-800/80">
        <GroupHeading
          title="Carpetas permitidas (allowedDirectories)"
          subtitle={allowedDirs.length > 0 ? `${allowedDirs.length} activa${allowedDirs.length > 1 ? "s" : ""}` : "Sin restricción"}
        />
        <p className="text-[11px] text-slate-400 leading-relaxed">
          Aplica en vivo a todas las herramientas, incluido <code className="font-mono text-slate-200">run_command</code> (valida <code className="font-mono text-slate-200">cwd</code> y rutas detectadas). Lista vacía = sin restricción; rutas que no puedan resolverse piden confirmación.
        </p>

        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Ruta absoluta o ~ (ej: C:\Users\Ana\Proyectos)"
            aria-label="Nueva carpeta permitida"
            value={newAllowedDir}
            onChange={(e) => setNewAllowedDir(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddAllowedDir();
              }
            }}
            className={`flex-1 px-3 py-1.5 ${INPUT_BASE} font-mono`}
          />
          <button
            type="button"
            disabled={!newAllowedDir.trim()}
            onClick={handleAddAllowedDir}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer shrink-0 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Agregar</span>
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          {allowedDirs.length > 0 ? (
            allowedDirs.map((dir, idx) => (
              <div
                key={`${dir}-${idx}`}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-950/70 border border-slate-800 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FolderLock className="w-3.5 h-3.5 text-accent-400 shrink-0" />
                  <span className="font-mono text-slate-200 truncate">{dir}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveAllowedDir(idx)}
                  aria-label={`Quitar carpeta permitida ${dir}`}
                  className="p-1 text-slate-500 hover:text-rose-400 transition-colors cursor-pointer shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          ) : (
            <p className="text-slate-500 text-xs italic">
              Sin carpetas configuradas (sin restricción de directorios).
            </p>
          )}
        </div>
      </div>

      {/* Lista negra */}
      <div className="flex flex-col gap-2.5 pt-2 border-t border-slate-800/80">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            <span className="text-xs font-semibold text-slate-200">
              Lista negra de herramientas modificadoras ({blacklist.length})
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowBlacklistForm((v) => !v)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-rose-300 bg-rose-950/40 hover:bg-rose-900/50 border border-rose-800/60 transition-colors cursor-pointer shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Agregar regla</span>
          </button>
        </div>

        <p className="text-[11px] text-slate-400 leading-relaxed">
          Reglas para herramientas que modifican el sistema: con modo automático activado rechazan automáticamente (<code className="font-mono text-slate-300">tool_rejected</code>); en modo interactivo solicitan confirmación al usuario.
        </p>

        {showBlacklistForm && (
          <div className="p-3 rounded-lg bg-slate-950 border border-rose-900/60 flex flex-col gap-2.5">
            <div className="flex items-center justify-between text-xs text-rose-300 font-semibold">
              <span>Nueva regla de lista negra</span>
              <button
                type="button"
                onClick={() => setShowBlacklistForm(false)}
                aria-label="Cerrar formulario de regla"
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                type="text"
                placeholder="Herramienta (ej: run_command)"
                aria-label="Herramienta"
                value={newTool}
                onChange={(e) => setNewTool(e.target.value)}
                className={`px-2.5 py-1.5 ${INPUT_BASE} font-mono`}
              />
              <input
                type="text"
                placeholder="Patrón regex (opcional)"
                aria-label="Patrón regex"
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                className={`px-2.5 py-1.5 ${INPUT_BASE} font-mono`}
              />
              <input
                type="text"
                placeholder="Motivo para el modelo"
                aria-label="Motivo"
                value={newReason}
                onChange={(e) => setNewReason(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddBlacklist();
                  }
                }}
                className={`px-2.5 py-1.5 ${INPUT_BASE}`}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowBlacklistForm(false)}
                className="px-2.5 py-1 text-slate-400 text-xs hover:text-slate-200 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!newTool.trim() || !newReason.trim()}
                onClick={handleAddBlacklist}
                className="px-3 py-1 bg-rose-500 hover:bg-rose-400 text-slate-950 font-semibold rounded-md text-xs cursor-pointer disabled:cursor-not-allowed disabled:opacity-45"
              >
                Añadir regla
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          {blacklist.length > 0 ? (
            blacklist.map((rule, idx) => (
              <div
                key={`${rule.tool}-${idx}`}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-950/70 border border-slate-800 text-xs"
              >
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <span className="font-mono font-semibold text-rose-300">{rule.tool}</span>
                  {rule.pattern && (
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-yellow-300 text-[11px] font-mono">
                      /{rule.pattern}/
                    </span>
                  )}
                  <span className="text-slate-300 truncate max-w-md" title={rule.reason}>
                    {rule.reason}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveBlacklist(idx)}
                  title="Eliminar regla"
                  aria-label={`Eliminar regla de ${rule.tool}`}
                  className="p-1 text-slate-500 hover:text-rose-400 transition-colors cursor-pointer shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          ) : (
            <p className="text-slate-500 text-xs italic">
              No hay reglas personalizadas en la lista negra (todas las herramientas permitidas por Guard están habilitadas).
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
