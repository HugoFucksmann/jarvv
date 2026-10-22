import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_KEY = "default";

/**
 * Copia texto al portapapeles y expone un feedback temporal por clave.
 *
 * Uso con un solo botón:
 *   const { copy, isCopied } = useClipboardCopy();
 *   <button onClick={() => copy(text)}>{isCopied() ? "Copiado" : "Copiar"}</button>
 *
 * Uso con varios botones en el mismo componente:
 *   copy(text, "input");  isCopied("input");
 *   copy(text, "output"); isCopied("output");
 */
export function useClipboardCopy(duration = 2000) {
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    // Evita setState sobre un componente desmontado.
    useEffect(() => {
        return () => clearTimeout(timerRef.current);
    }, []);

    const copy = useCallback(
        async (text: string, key: string = DEFAULT_KEY): Promise<boolean> => {
            try {
                await navigator.clipboard.writeText(text);
            } catch {
                // Contexto no seguro (http fuera de localhost) o permiso denegado.
                return false;
            }
            clearTimeout(timerRef.current);
            setCopiedKey(key);
            timerRef.current = setTimeout(() => setCopiedKey(null), duration);
            return true;
        },
        [duration],
    );

    const isCopied = useCallback(
        (key: string = DEFAULT_KEY) => copiedKey === key,
        [copiedKey],
    );

    return { copy, isCopied, copiedKey };
}
