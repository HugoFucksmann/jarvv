/**
 * Formatea una duración en milisegundos de forma concisa y legible para la UI.
 * Ejemplos: 450 -> "450ms", 1250 -> "1.3s", 65000 -> "1m 5s".
 */
export function formatDuration(ms: number): string {
  if (ms < 0 || !Number.isFinite(ms)) return "0ms";
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const mins = Math.floor(seconds / 60);
  const remainingSecs = Math.round(seconds % 60);
  return remainingSecs > 0 ? `${mins}m ${remainingSecs}s` : `${mins}m`;
}
