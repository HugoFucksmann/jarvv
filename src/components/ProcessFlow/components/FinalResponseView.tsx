import React, { useState } from "react";
import { CheckCheck, Copy, Check, Terminal } from "lucide-react";

interface FinalResponseViewProps {
  response: string;
}

interface ContentSegment {
  type: "text" | "code";
  content: string;
  language?: string;
}

/**
 * Parsea el texto detectando bloques de código ```lang ... ```
 * de forma segura y sin dependencias externas pesadas.
 */
function parseSegments(text: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const textChunk = text.slice(lastIndex, match.index);
      if (textChunk.trim()) {
        segments.push({ type: "text", content: textChunk });
      }
    }
    const lang = match[1]?.trim() || "texto";
    const code = match[2] || "";
    segments.push({ type: "code", content: code, language: lang });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex);
    if (remaining.trim()) {
      segments.push({ type: "text", content: remaining });
    }
  }

  if (segments.length === 0 && text) {
    segments.push({ type: "text", content: text });
  }

  return segments;
}

export const FinalResponseView: React.FC<FinalResponseViewProps> = ({ response }) => {
  const [copiedFull, setCopiedFull] = useState(false);
  const [copiedBlockIndex, setCopiedBlockIndex] = useState<number | null>(null);

  const handleCopyFull = async () => {
    try {
      await navigator.clipboard.writeText(response);
      setCopiedFull(true);
      setTimeout(() => setCopiedFull(false), 2000);
    } catch (err) {
      console.error("Error al copiar respuesta:", err);
    }
  };

  const handleCopyBlock = async (code: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedBlockIndex(idx);
      setTimeout(() => setCopiedBlockIndex(null), 2000);
    } catch (err) {
      console.error("Error al copiar bloque de código:", err);
    }
  };

  const segments = parseSegments(response);

  return (
    <div className="flex flex-col gap-3 p-4 bg-slate-900/60 border border-slate-800 rounded-lg shadow-sm">
      {/* Cabecera con título y acción de copiado completo */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
        <div className="flex items-center gap-2 text-xs font-mono font-medium text-emerald-400">
          <CheckCheck className="w-4 h-4 shrink-0" />
          <span>RESPUESTA FINAL SINTETIZADA</span>
        </div>
        <button
          type="button"
          onClick={handleCopyFull}
          title="Copiar respuesta completa al portapapeles"
          aria-label="Copiar respuesta completa"
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700/80 border border-slate-700/60 rounded transition-colors cursor-pointer"
        >
          {copiedFull ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400">Copiado</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 text-slate-400" />
              <span>Copiar todo</span>
            </>
          )}
        </button>
      </div>

      {/* Contenido con formateo limpio de texto y bloques de código */}
      <div className="flex flex-col gap-3 text-sm text-slate-200 leading-relaxed">
        {segments.map((seg, idx) => {
          if (seg.type === "code") {
            const isBlockCopied = copiedBlockIndex === idx;
            return (
              <div
                key={idx}
                className="flex flex-col rounded-md border border-slate-800 bg-slate-950 overflow-hidden font-mono text-xs"
              >
                <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900/90 border-b border-slate-800/80 text-[11px] text-slate-400">
                  <div className="flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-sky-400" />
                    <span className="font-semibold text-slate-300 uppercase">{seg.language}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopyBlock(seg.content, idx)}
                    aria-label={`Copiar fragmento de código ${seg.language}`}
                    className="flex items-center gap-1 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                  >
                    {isBlockCopied ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400">Copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copiar</span>
                      </>
                    )}
                  </button>
                </div>
                <pre className="p-3 overflow-x-auto text-slate-200 text-xs leading-relaxed font-mono whitespace-pre">
                  <code>{seg.content}</code>
                </pre>
              </div>
            );
          }

          return (
            <div key={idx} className="whitespace-pre-wrap text-slate-200 text-sm">
              {seg.content}
            </div>
          );
        })}
      </div>
    </div>
  );
};
