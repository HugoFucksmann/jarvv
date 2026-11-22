import type React from "react";
import type { JarvisConfig } from "../../../types/api.ts";
import { GroupHeading, SectionHeader, TextField, ToggleRow, UrlField } from "../components/FieldPrimitives.tsx";

interface VoiceSectionProps {
  config: JarvisConfig;
  onUpdate: (patch: Partial<JarvisConfig>) => void;
}

export const VoiceSection: React.FC<VoiceSectionProps> = ({ config, onUpdate }) => (
  <div className="flex flex-col gap-5">
    <SectionHeader
      title="Voz y síntesis TTS local"
      description="Configura el servidor de voz compatible con OpenAI y dónde se reproducen automáticamente las respuestas."
    />

    <div className="flex flex-col gap-2.5">
      <GroupHeading title="Canales habilitados" />
      <ToggleRow
        id="cfg-voice-enabled"
        title="Leer respuestas en voz alta en la web"
        codeKey="voiceEnabled"
        checked={Boolean(config.voiceEnabled)}
        onChange={(voiceEnabled) => onUpdate({ voiceEnabled })}
        statusText={{ on: "Activo", off: "Desactivado" }}
        description="Reproduce automáticamente cada respuesta final al terminar una tarea en esta interfaz."
      />
      <ToggleRow
        id="cfg-telegram-voice"
        title="Responder con nota de voz en Telegram"
        codeKey="telegramVoice"
        checked={Boolean(config.telegramVoice)}
        onChange={(telegramVoice) => onUpdate({ telegramVoice })}
        statusText={{ on: "Activo", off: "Solo texto" }}
        description={
          <>
            Además de texto, el bot de Telegram envía nota de voz (requiere <code className="font-mono text-slate-200">ffmpeg</code> en el PATH y las variables <code className="font-mono text-slate-200">TELEGRAM_BOT_TOKEN</code> / <code className="font-mono text-slate-200">TELEGRAM_CHAT_ID</code> en <code className="font-mono text-slate-200">.env</code>).
          </>
        }
      />
    </div>

    <div className="flex flex-col gap-3 pt-2 border-t border-slate-800/80">
      <GroupHeading title="Servidor TTS local" subtitle="scripts/phonon_server.py" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <UrlField
          id="cfg-voice-url"
          label="URL base del servidor TTS"
          value={config.voiceUrl}
          placeholder="http://127.0.0.1:8880"
          onChange={(voiceUrl) => onUpdate({ voiceUrl })}
        />
        <TextField
          id="cfg-voice-name"
          label="Nombre de la voz"
          value={config.voiceName}
          placeholder="default"
          hint='"default" usa la voz predeterminada del servidor'
          onChange={(voiceName) => onUpdate({ voiceName })}
        />
      </div>
    </div>
  </div>
);
