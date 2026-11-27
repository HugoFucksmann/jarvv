/**
 * PowerShell trata las comillas tipográficas (`‘ ’ ‚ “ ” „`) como comillas de verdad. Los analizadores de comandos las llevan a `'` y `"`
 * antes de leer el texto: así `Remove-Item ‘C:\x’; ...` no esconde el `;` ni el destino detrás de unas comillas que ellos no reconocían.
 */
export function foldQuotes(text: string): string {
  return text.replace(/[\u2018\u2019\u201A\u201B]/g, "'").replace(/[\u201C\u201D\u201E\u201F]/g, '"');
}
