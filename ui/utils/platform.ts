/** Detección de plataforma para mostrar el atajo de teclado correcto (ERR-02). */
export const isApplePlatform =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** Etiqueta del atajo global que enfoca la línea de comando. El listener acepta Cmd y Ctrl en ambas plataformas. */
export const FOCUS_SHORTCUT_LABEL = isApplePlatform ? "⌘K" : "Ctrl+K";