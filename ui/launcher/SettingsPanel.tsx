import { useCallback, useEffect, useState } from "react";
import { jarvisApi } from "../services/jarvisApi.ts";
import type { JarvisConfig } from "../types/api.ts";

function Switch({ label, hint, checked, disabled, onChange }: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className={`flex items-center gap-3 ${disabled ? "opacity-50" : ""}`}>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-slate-200">{label}</p>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors disabled:cursor-not-allowed ${checked ? "bg-accent-500" : "bg-slate-700"}`}
      >
        <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-slate-50 transition-transform ${checked ? "translate-x-4" : ""}`} />
      </button>
    </div>
  );
}

/** Ajustes del usuario: solo lo que se usa a diario. La configuración técnica queda en el dashboard de depuración. */
export function SettingsPanel({ onChanged }: { onChanged: () => void }) {
  const [cfg, setCfg] = useState<JarvisConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    jarvisApi.getConfig().then(setCfg).catch(() => setError("No se pudo leer la configuración."));
  }, []);

  const update = useCallback(
    async (patch: Partial<Pick<JarvisConfig, "telegramEnabled" | "autoMode" | "voiceEnabled" | "telegramVoice">>) => {
      setError(null);
      try {
        const next = await jarvisApi.updateConfig(patch);
        setCfg((prev) => ({ ...prev, ...next }));
        onChanged();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo guardar.");
      }
    },
    [onChanged],
  );

  if (!cfg) return <p className="px-4 py-3 text-xs text-slate-500">{error ?? "Cargando…"}</p>;

  const telegramAvailable = cfg.telegramAvailable !== false;
  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <Switch
        label="Telegram"
        hint={telegramAvailable ? "Recibir y responder tareas por Telegram" : "Falta TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID en .env"}
        checked={telegramAvailable && cfg.telegramEnabled !== false}
        disabled={!telegramAvailable}
        onChange={(telegramEnabled) => void update({ telegramEnabled })}
      />
      <Switch
        label="Leer respuestas en voz alta"
        hint="Lee la respuesta final con la voz local"
        checked={Boolean(cfg.voiceEnabled)}
        onChange={(voiceEnabled) => void update({ voiceEnabled })}
      />
      <Switch
        label="Notas de voz en Telegram"
        hint="Además del texto, Telegram recibe la respuesta en audio"
        checked={telegramAvailable && Boolean(cfg.telegramVoice)}
        disabled={!telegramAvailable}
        onChange={(telegramVoice) => void update({ telegramVoice })}
      />
      <Switch
        label="Modo automático"
        hint="Aprueba solo lo seguro; lo delicado siempre lo confirma"
        checked={Boolean(cfg.autoMode)}
        onChange={(autoMode) => void update({ autoMode })}
      />
      {error && (
        <p className="text-xs text-rose-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
