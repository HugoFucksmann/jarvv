import React, { useEffect } from "react";
import { X, Laptop, Folder, Clock, Globe, Shield, Gauge, Copy, Check } from "lucide-react";
import type { UserEnvironment, EngineLimits } from "../../../types/api.ts";

interface EnvironmentModalProps {
  environment: UserEnvironment | null;
  limits: EngineLimits | null;
  onClose: () => void;
}

const LIMIT_LABELS: Record<keyof EngineLimits, { label: string; desc: string }> = {
  maxSteps: {
    label: "Tope de pasos",
    desc: "Cantidad máxima de iteraciones o pasos antes de detener la tarea.",
  },
  maxCallsPerStep: {
    label: "Ejecuciones por paso",
    desc: "Máximo de llamadas que llegan a una herramienta en un solo paso.",
  },
  maxAttemptsPerStep: {
    label: "Intentos por paso",
    desc: "Techo de intentos del modelo en un paso, incluidos los que no llegaron a la herramienta (repetidos, argumentos inválidos).",
  },
  maxNotAccomplishedPerRoute: {
    label: "Rechazos por ruta",
    desc: "Veces que la verificación puede decir 'no cumple lo pedido' sobre una ruta en un paso antes de dejar de ofrecerla.",
  },
  maxReplans: {
    label: "Tope de replanificaciones",
    desc: "Límite de nuevos planes automáticos tras fallas consecutivas.",
  },
  maxEscalations: {
    label: "Escalaciones de modelo",
    desc: "Límite de cambios de estrategia o nivel de modelo.",
  },
  maxItemFailures: {
    label: "Fallos por ítem",
    desc: "Intentos fallidos seguidos sobre una misma acción antes de abandonarla.",
  },
  maxRepeatsPerStep: {
    label: "Repeticiones en bucle",
    desc: "Llamadas repetidas bloqueadas (loop_blocked) permitidas antes de fallar.",
  },
  maxReviewRejectionsPerStep: {
    label: "Rechazos de revisión",
    desc: "Argumentos inválidos rechazados por Decisión 3 permitidos antes de fallar.",
  },
  maxVerifyRejectionsPerStep: {
    label: "Rechazos de verificación",
    desc: "Resultados rechazados por Decisión 4 permitidos en un paso antes de que el paso falle y se reescriba la tarea.",
  },
  maxUserRejectionsPerStep: {
    label: "Rechazos del usuario",
    desc: "Veces que el usuario puede rechazar una operación en un paso antes de que el paso falle.",
  },
  maxQuestionsPerStep: {
    label: "Preguntas por paso",
    desc: "Máximo de aclaraciones solicitadas al usuario por iteración.",
  },
};

export const EnvironmentModal: React.FC<EnvironmentModalProps> = ({
  environment,
  limits,
  onClose,
}) => {
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const copyPath = async (key: string, path?: string) => {
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch (e) {
      console.warn("Failed to copy:", e);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="env-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-slate-100 animate-in fade-in zoom-in-95 duration-150">
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5 bg-slate-950/70">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-md bg-accent-500/10 text-accent-400 border border-accent-500/30">
              <Laptop className="w-4 h-4" />
            </div>
            <div className="flex flex-col">
              <h2 id="env-modal-title" className="text-sm font-semibold text-slate-100">
                Entorno del sistema y límites del motor
              </h2>
              <span className="text-xs text-slate-400">
                Rutas locales de esta PC y presupuesto operativo de JARVIS
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ventana de entorno"
            className="p-1.5 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer rounded hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Cuerpo */}
        <div className="flex-1 p-5 overflow-y-auto flex flex-col gap-6 text-xs bg-slate-950/40">
          {/* SECCIÓN 1: DATOS DE LA PC */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-slate-100 font-semibold text-[13px] border-b border-slate-800 pb-2">
              <Globe className="w-3.5 h-3.5 text-accent-400" />
              <span>Identidad de la PC y carpetas conocidas</span>
            </div>

            {environment ? (
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                    <span className="text-[11px] text-slate-500 uppercase tracking-wide">Sistema operativo</span>
                    <p className="text-sm font-semibold text-slate-100 capitalize mt-0.5">
                      {environment.platform}
                    </p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                    <span className="text-[11px] text-slate-500 uppercase tracking-wide">Zona horaria</span>
                    <p className="text-sm font-semibold text-slate-100 mt-0.5 truncate" title={environment.timeZone}>
                      {environment.timeZone}
                    </p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 col-span-2 sm:col-span-1">
                    <span className="text-[11px] text-slate-500 uppercase tracking-wide flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-500" />
                      <span>Hora del servidor</span>
                    </span>
                    <p className="text-sm font-semibold text-slate-100 mt-0.5 tabular-nums">
                      {new Date(environment.now).toLocaleTimeString()}
                    </p>
                  </div>
                </div>

                {/* Rutas conocidas */}
                <div className="flex flex-col gap-1.5 mt-2">
                  <span className="text-xs text-slate-400 font-medium">
                    Carpetas locales resueltas para las herramientas:
                  </span>

                  {[
                    { key: "home", label: "Directorio personal (HOME)", path: environment.home },
                    { key: "desktop", label: "Escritorio (Desktop)", path: environment.desktop },
                    { key: "documents", label: "Documentos (Documents)", path: environment.documents },
                    { key: "downloads", label: "Descargas (Downloads)", path: environment.downloads },
                  ].map(({ key, label, path }) => (
                    <div
                      key={key}
                      className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-950 border border-slate-800 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Folder className="w-3.5 h-3.5 text-accent-400 shrink-0" />
                        <span className="text-slate-400 shrink-0">{label}:</span>
                        <span className="text-slate-200 truncate select-all font-mono">{path || "No disponible"}</span>
                      </div>
                      {path && (
                        <button
                          type="button"
                          onClick={() => copyPath(key, path)}
                          title="Copiar ruta"
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                        >
                          {copiedKey === key ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          <span>{copiedKey === key ? "Copiado" : "Copiar"}</span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-slate-500 text-xs">Cargando información del entorno…</p>
            )}
          </div>

          {/* SECCIÓN 2: LÍMITES Y PRESUPUESTO */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-slate-100 font-semibold text-[13px] border-b border-slate-800 pb-2">
              <Gauge className="w-3.5 h-3.5 text-accent-400" />
              <span>Presupuesto operativo del motor</span>
            </div>

            {limits ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(Object.keys(LIMIT_LABELS) as Array<keyof EngineLimits>).map((k) => {
                  const val = limits[k];
                  const info = LIMIT_LABELS[k];
                  return (
                    <div
                      key={k}
                      className="flex items-start justify-between gap-2 p-2.5 rounded-lg bg-slate-950 border border-slate-800"
                    >
                      <div className="flex flex-col gap-0.5">
                        <span className="font-semibold text-slate-200 text-xs">{info.label}</span>
                        <span className="text-[11px] text-slate-500 leading-snug">{info.desc}</span>
                      </div>
                      <span className="text-sm font-semibold font-mono text-accent-300 px-2 py-0.5 bg-accent-500/10 border border-accent-500/25 rounded shrink-0 tabular-nums">
                        {val}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-slate-500 text-xs">Consultando límites del motor…</p>
            )}
          </div>
        </div>

        {/* Pie */}
        <div className="flex items-center justify-between border-t border-slate-800 px-5 py-3 bg-slate-950/80 text-xs">
          <span className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
            <span>
              Datos provistos por <span className="font-mono">/api/jarvis/environment</span> y{" "}
              <span className="font-mono">/limits</span>
            </span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs text-slate-200 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-md transition-colors cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};