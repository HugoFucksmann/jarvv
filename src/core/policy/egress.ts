/**
 * JARVIS Core — Datos sensibles en lo que una herramienta envía a internet.
 *
 * Una consulta de `web_search` (la pregunta, las palabras clave, las URL, los dominios) sale de la PC hacia buscadores y sitios web: es un canal de salida. Si el modelo
 * la arma con datos que la tarea leyó (una clave, un token, la ruta de una carpeta del usuario), eso saldría con ella. Esta regla determinista lo detecta y
 * `Guard` pide la confirmación del usuario AUNQUE esté encendido `autoMode` (`GuardDecision.mandatory`), con la consulta a la vista. No deniega: una pregunta
 * legítima puede nombrar una ruta.
 *
 * Qué NO hace: validar las URL (esquema, redes privadas, credenciales): son comprobaciones duras de la propia herramienta, que rechaza la llamada.
 */

import type { PathFinding } from "./sensitivePaths.ts";

/** Herramientas cuyos argumentos salen a internet, como `servidor:herramienta` en minúsculas. */
const EGRESS_TOOLS: ReadonlySet<string> = new Set(["jarvis_web:web_search"]);

export const isEgressTool = (mcp: string, tool: string): boolean => EGRESS_TOOLS.has(`${mcp}:${tool}`.toLowerCase());

interface EgressRule {
  readonly id: string;
  readonly reason: string;
  readonly re: RegExp;
  /** `false`: no se aplica a las URL (una URL válida puede tener un trozo largo o ser de cualquier sitio). */
  readonly inUrls: boolean;
}

const RULES: readonly EgressRule[] = [
  { id: "api-key", reason: "parece una clave de API o un token de acceso", re: /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{30,}|\bxox[baprs]-[A-Za-z0-9-]{10,}/, inUrls: true },
  { id: "jwt", reason: "parece un token JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/, inUrls: true },
  { id: "private-key", reason: "contiene una clave privada", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, inUrls: true },
  { id: "credential", reason: "asigna una contraseña, un secreto o un token", re: /\b(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|bearer)\s*[:=]\s*\S{6,}/i, inUrls: false },
  { id: "long-blob", reason: "contiene una cadena larga de caracteres que parece una clave o datos codificados", re: /[A-Za-z0-9+/=]{40,}/, inUrls: false },
  { id: "user-path", reason: "nombra una ruta de una carpeta del usuario de esta PC", re: /(?:^|[\s"'(=])(?:[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s]+|\/home\/[^/\s]+|~[\\/])/i, inUrls: false },
];

const isUrlArg = (key: string): boolean => key === "urls";

/** Textos de los argumentos de una llamada (un texto o los textos de una lista), con su clave. */
function texts(args: Readonly<Record<string, unknown>>): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") out.push({ key, text: value });
    else if (Array.isArray(value)) for (const item of value) if (typeof item === "string") out.push({ key, text: item });
  }
  return out;
}

/** El primer dato sensible en lo que la llamada envía a internet, o `null` (también si la herramienta no sale a internet). */
export function egressFinding(mcp: string, tool: string, args: Readonly<Record<string, unknown>>): PathFinding | null {
  if (!isEgressTool(mcp, tool)) return null;
  for (const { key, text } of texts(args)) {
    for (const rule of RULES) {
      if (isUrlArg(key) && !rule.inUrls) continue;
      if (rule.re.test(text)) return { id: rule.id, reason: rule.reason };
    }
  }
  return null;
}
