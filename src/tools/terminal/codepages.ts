/**
 * `run_command`: páginas de códigos del sistema (Windows). Las herramientas de consola (`ipconfig`, `ping`) escriben en la OEM y algunas (`chcp`) en la
 * ANSI; `output.ts` las usa para decodificar lo que no llega en UTF-8. Se leen una vez del registro; si no se puede, las de Windows en español e inglés
 * occidental (850 y 1252), que es lo que tenía la PC donde se validó.
 */

import { spawnSync } from "node:child_process";

export interface CodePages {
  readonly oem: number;
  readonly ansi: number;
}

export const DEFAULT_CODE_PAGES: CodePages = { oem: 850, ansi: 1252 };

let cached: CodePages | undefined;

function readValue(output: string, name: string): number | null {
  const match = new RegExp(`${name}\\s+REG_SZ\\s+(\\d+)`, "i").exec(output);
  const value = match ? Number(match[1]) : NaN;
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** Páginas OEM y ANSI del sistema (`HKLM\…\Nls\CodePage`), leídas una sola vez. */
export function systemCodePages(): CodePages {
  if (cached !== undefined) return cached;
  cached = DEFAULT_CODE_PAGES;
  if (process.platform !== "win32") return cached;
  try {
    const result = spawnSync("reg", ["query", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage"], {
      windowsHide: true,
      encoding: "latin1",
      timeout: 5000,
    });
    const out = typeof result.stdout === "string" ? result.stdout : "";
    cached = { oem: readValue(out, "OEMCP") ?? DEFAULT_CODE_PAGES.oem, ansi: readValue(out, "ACP") ?? DEFAULT_CODE_PAGES.ansi };
  } catch {
    // se quedan las de por defecto
  }
  return cached;
}
