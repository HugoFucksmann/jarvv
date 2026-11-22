import type React from "react";
import { CheckCheck, Info, Activity, Volume2, VolumeX, Loader2, AlertTriangle, AlertCircle, XCircle } from "lucide-react";
import type { TaskResult, TaskState } from "../../../types/api.ts";
import type { SpeechStatus } from "../../../hooks/useSpeech.ts";
import { MarkdownRenderer } from "../../Shared/MarkdownRenderer.tsx";
import { CopyButton } from "../../Shared/CopyButton.tsx";

interface FinalResponseViewProps {
  result: TaskResult;
  taskState?: TaskState;
  onOpenTrace?: () => void;
  /** Leer la respuesta en voz alta / parar; solo se muestran con la voz activada. */
  onSpeak?: (text: string) => void;
  onStopSpeech?: () => void;
  speechStatus?: SpeechStatus;
}

/** Acción secundaria: sin borde ni fondo hasta pasar el ratón, para no competir con la respuesta. */
const ACTION =
  "gap-1.5 rounded-md px-2.5 py-1.5 text-xs sm:text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60";

function getHeaderMeta(taskState?: TaskState): {
  title: string;
  cardBorder: string;
  icon: React.ReactNode;
} {
  switch (taskState) {
    case "partial":
      return {
        title: "Respuesta parcial",
        cardBorder: "border-yellow-800/50",
        icon: <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-400" />,
      };
    case "failed":
      return {
        title: "Resultado con fallo",
        cardBorder: "border-rose-900/60",
        icon: <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />,
      };
    case "cancelled":
      return {
        title: "Tarea cancelada",
        cardBorder: "border-slate-800",
        icon: <XCircle className="h-4 w-4 shrink-0 text-slate-400" />,
      };
    case "completed":
    default:
      return {
        title: "Respuesta final",
        cardBorder: "border-slate-800",
        icon: <CheckCheck className="h-4 w-4 shrink-0 text-emerald-400" />,
      };
  }
}

export const FinalResponseView: React.FC<FinalResponseViewProps> = ({
  result,
  taskState,
  onOpenTrace,
  onSpeak,
  onStopSpeech,
  speechStatus = "idle",
}) => {
  const { title, cardBorder, icon } = getHeaderMeta(taskState);

  return (
    <section
      id="final-response"
      aria-label={title}
      className={`flex flex-col gap-4 rounded-xl border ${cardBorder} bg-slate-900/50 p-5 shadow-sm`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          {result.origin === "fallback" && (
            <span
              className="flex items-center gap-1 text-xs text-yellow-300 bg-yellow-950/30 border border-yellow-800/40 px-2 py-0.5 rounded"
              title="La respuesta se generó sin consultar un modelo"
            >
              <Info className="h-3.5 w-3.5" />
              Respaldo automático
            </span>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          {onSpeak &&
            (speechStatus === "disconnected" ? (
              <button
                type="button"
                disabled
                title="Servidor de voz desconectado"
                aria-label="Servidor de voz desconectado"
                className={`flex items-center ${ACTION} !cursor-not-allowed opacity-50`}
              >
                <Volume2 className="h-4 w-4" />
                <span>Desconectado</span>
              </button>
            ) : speechStatus === "idle" ? (
              <button
                type="button"
                onClick={() => onSpeak(result.text)}
                title="Leer la respuesta en voz alta"
                aria-label="Leer la respuesta en voz alta"
                className={`flex items-center ${ACTION}`}
              >
                <Volume2 className="h-4 w-4" />
                <span>Leer</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onStopSpeech}
                title="Detener la lectura"
                aria-label="Detener la lectura"
                className={`flex items-center ${ACTION} !text-accent-300`}
              >
                {speechStatus === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <VolumeX className="h-4 w-4" />}
                <span>{speechStatus === "loading" ? "Preparando…" : "Detener"}</span>
              </button>
            ))}
          {onOpenTrace && (
            <button
              type="button"
              onClick={onOpenTrace}
              title="Ver la traza de auditoría: decisiones D0 a D5, consultas y duraciones"
              className={`flex items-center ${ACTION}`}
            >
              <Activity className="h-4 w-4" />
              <span>Ver traza</span>
            </button>
          )}
          <CopyButton
            text={result.text}
            label="Copiar"
            title="Copiar la respuesta completa en Markdown"
            ariaLabel="Copiar respuesta completa"
            iconSize="w-4 h-4"
            className={ACTION}
          />
        </div>
      </div>

      <MarkdownRenderer content={result.text} large />
    </section>
  );
};