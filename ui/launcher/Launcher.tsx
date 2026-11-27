import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Square, X, ArrowUp, Loader2, CheckCircle2, AlertCircle, Zap, ListChecks, Volume2, Settings } from "lucide-react";
import { SettingsPanel } from "./SettingsPanel.tsx";
import { useJarvis } from "../hooks/useJarvis.ts";
import { GuardBanner } from "../components/GuardBanner/GuardBanner.tsx";
import { MarkdownRenderer } from "../components/Shared/MarkdownRenderer.tsx";
import { StepStatusIcon } from "../components/Shared/StepStatusIcon.tsx";
import { buildSteps, headline, isTerminal, type StepView } from "./activity.ts";

function StepRow({ step }: { step: StepView }) {
  const active = step.state === "running";
  return (
    <li className="flex items-start gap-2.5 px-4 py-1.5">
      <span className="mt-0.5">
        <StepStatusIcon state={step.state} size="sm" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-[13px] leading-5 ${active ? "text-slate-100" : "text-slate-300"}`}>{step.title}</p>
        {step.detail && <p className="truncate text-xs leading-4 text-slate-500">{step.detail}</p>}
      </div>
    </li>
  );
}

function IconToggle({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`cursor-pointer rounded-md p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? "bg-accent-500/15 text-accent-300" : "text-slate-500 hover:bg-slate-800 hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

export function Launcher() {
  const j = useJarvis();
  const { task, waiting } = j;
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(true);

  const steps = useMemo(() => (task ? buildSteps(task) : []), [task]);
  const done = isTerminal(task?.task.state);
  const busy = Boolean(task) && !done;
  const taskId = task?.task.id;

  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    setOpen(true);
  }, [taskId]);
  useEffect(() => {
    inputRef.current?.focus();
  }, [busy]);

  const submit = () => {
    const text = value.trim();
    if (!text || busy) return;
    setValue("");
    void j.runTask(text, j.mode).then((ok) => {
      if (ok === false) setValue((cur) => cur || text);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape" && task) setOpen((o) => !o);
  };

  const completed = steps.filter((s) => s.state === "completed").length;
  // Desplegada la lista ya muestra el paso en curso: la cabecera solo da el estado general, para no repetirlo.
  const listShown = open && steps.length > 0;
  const label = task ? (listShown && !done && !waiting && !task.paused ? "Trabajando…" : headline(task, steps)) : "";
  const failed = task?.task.state === "failed";

  return (
    <div className="mx-auto w-full max-w-[640px] p-3">
      <div className="launcher-panel overflow-hidden rounded-2xl border border-slate-800">
        <div className="flex items-center gap-2 px-4 py-3">
          <input
            ref={inputRef}
            value={busy ? (task?.task.request ?? "") : value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={busy}
            placeholder="¿Qué hacemos?"
            aria-label="Instrucción para JARVIS"
            className="min-w-0 flex-1 select-text bg-transparent text-[15px] text-slate-100 placeholder:text-slate-500 focus:outline-none disabled:text-slate-400"
          />
          <div className="flex shrink-0 items-center gap-0.5">
            <IconToggle
              label={j.mode === "deliberative" ? "Modo deliberativo (planifica y pide confirmar)" : "Modo reactivo (ejecuta directo)"}
              active={j.mode === "deliberative"}
              disabled={busy}
              onClick={() => j.setMode(j.mode === "reactive" ? "deliberative" : "reactive")}
            >
              {j.mode === "deliberative" ? <ListChecks className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />}
            </IconToggle>
            <IconToggle label="Ajustes" active={settingsOpen} onClick={() => setSettingsOpen((s) => !s)}>
              <Settings className="h-3.5 w-3.5" />
            </IconToggle>
          </div>
          {busy ? (
            <button
              type="button"
              onClick={() => void j.cancelTask()}
              title="Cancelar"
              aria-label="Cancelar tarea"
              className="cursor-pointer rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!value.trim()}
              title="Enviar"
              aria-label="Enviar"
              className="cursor-pointer rounded-md bg-accent-500 p-1.5 text-slate-950 hover:bg-accent-400 disabled:cursor-default disabled:bg-slate-800 disabled:text-slate-600"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {settingsOpen && (
          <div className="border-t border-slate-800/80">
            <SettingsPanel onChanged={() => void j.refreshConfig()} />
          </div>
        )}

        {task && (
          <div className="border-t border-slate-800/80">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-2 text-left hover:bg-slate-900/60"
            >
              {done ? (
                failed ? (
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-500" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                )
              ) : (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent-400" />
              )}
              <span className="min-w-0 flex-1 truncate text-[13px] text-slate-200">{label}</span>
              {steps.length > 0 && (
                <span className="shrink-0 text-xs tabular-nums text-slate-500">
                  {completed}/{steps.length}
                </span>
              )}
              <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>

            <div className="launcher-steps" data-open={open && steps.length > 0}>
              <div>
                <ul className="max-h-64 overflow-y-auto pb-2">
                  {steps.map((s) => (
                    <StepRow key={s.id} step={s} />
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {waiting?.kind === "plan" && (
          <div className="flex flex-col gap-2 border-t border-slate-800/80 px-4 py-3">
            <ol className="list-decimal pl-4 text-[13px] text-slate-300">
              {waiting.request.steps.map((s) => (
                <li key={s.id}>{s.instruction}</li>
              ))}
            </ol>
            <div className="flex gap-2">
              <button type="button" onClick={() => void j.confirmPlan()} className="cursor-pointer rounded-md bg-accent-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-accent-400">
                Confirmar plan
              </button>
              <button type="button" onClick={() => void j.rejectPlan()} className="cursor-pointer rounded-md bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700">
                Rechazar
              </button>
            </div>
          </div>
        )}

        {waiting && waiting.kind !== "plan" && (
          <div className="max-h-72 overflow-y-auto border-t border-slate-800/80 p-2">
            <GuardBanner
              waiting={waiting}
              onApprove={j.approvePending}
              onApproveAlways={() => j.approvePending(undefined, undefined, true)}
              onDeny={j.denyPending}
              onAnswer={j.provideUserAnswer}
            />
          </div>
        )}

        {task?.result && (
          <div className="relative max-h-80 select-text overflow-y-auto border-t border-slate-800/80 px-4 py-3">
            {(j.speechStatus === "playing" || j.speechStatus === "loading") && (
              <button
                type="button"
                onClick={() => j.stopSpeech()}
                title="Detener lectura"
                aria-label="Detener lectura"
                className="absolute right-8 top-2 cursor-pointer rounded p-1 text-accent-400 hover:bg-slate-800"
              >
                <Volume2 className="h-3.5 w-3.5 animate-pulse" />
              </button>
            )}
            <button
              type="button"
              onClick={() => j.clearTaskView()}
              title="Cerrar"
              aria-label="Cerrar"
              className="absolute right-2 top-2 cursor-pointer rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <MarkdownRenderer content={task.result.text} />
          </div>
        )}

        {j.speechStatus === "disconnected" && (
          <p className="border-t border-slate-800/80 px-4 py-2 text-xs text-yellow-400" role="status">
            El servidor de voz no responde (puede estar iniciando). Probá de nuevo en unos segundos.
          </p>
        )}

        {j.error && (
          <p className="border-t border-slate-800/80 px-4 py-2 text-xs text-rose-400" role="alert">
            {j.error}
          </p>
        )}
      </div>
    </div>
  );
}
