/**
 * Reglas deterministas para decidir qué hacer tras un paso fallido (`recovery`), ANTES de consultar al modelo de decisión.
 *
 * Dos familias, las dos de señal inequívoca en el error o en la causa del motor:
 * - **Falta un prerrequisito** (carpeta destino, programa, puerto libre, formato soportado) → `replan`. Es la acción que el modelo de decisión de 2B acierta
 *   menos (57 a 70 % en eval); un mensaje como `EADDRINUSE` no necesita un modelo.
 * - **Parada dura** (el usuario o la política rechazaron, permiso denegado, red o servicio caído, disco lleno, archivo corrupto, tests o compilación que fallan
 *   de verdad…) → `close`. Varias señales piden además que ya haya habido 2 o más intentos: un solo fallo de red puede ser transitorio.
 *
 * Lo que las reglas NO deciden (error de tipeo, argumentos mal puestos, ambigüedades) queda para el modelo: devuelven `null`.
 *
 * Función pura y sin estado. Hoy solo la usa el modo sombra (`recoveryShadow.ts`), que registra qué decidiría en la traza: el motor NO actúa con su resultado. Se mide
 * en `eval/` y con trazas reales (ver `eval/GUIA_DECISION.md`, sección 5) antes de dejar que decida.
 *
 * Las reglas son conservadoras a propósito: ante la duda devuelven `null`. Un `ENOENT` al LEER no basta (puede ser un nombre mal escrito o un archivo en
 * otro lugar); un `ENOENT` al ESCRIBIR sí (escribir crea el archivo, así que solo falla si falta la carpeta de arriba).
 */

import type { StepFailureCause } from "./outcomes.ts";

/** Qué prerrequisito falta. */
export type PrerequisiteSignal = "missing_destination" | "program_not_found" | "port_in_use" | "unsupported_format";

/** Lo mínimo del último intento fallido. `kind` es el de la llamada registrada (`write` si cambia algo en disco). */
export interface FailedCallText {
  readonly kind: "read" | "write";
  readonly text: string;
}

// Los mensajes de PowerShell, de .NET y de Windows salen en el idioma del sistema: acá se reconocen los de inglés y los de español (el equipo de desarrollo es es-AR; con
// solo los de inglés, en las trazas reales ninguna regla por texto llegó a disparar). Otro idioma: no hay regla y decide el modelo.
const PORT_IN_USE = /EADDRINUSE|address already in use|solo se permite un uso de cada direcci[óo]n de socket/i;
const UNSUPPORTED_FORMAT = /\bUnsupported (?:image |file |binary )?(?:format|type)\b|requires a format driver that is not installed/i;
const MISSING_PART_OF_PATH = /Could not find a part of the path|No se encontr[óo] una parte de la ruta/i;
const WRITE_ENOENT = /\bENOENT\b/;
// Dos grupos de captura (inglés y español): el nombre del programa es el que haya coincidido.
const PS_NOT_RECOGNIZED = /The term '([^']+)' is not recognized as the name of a cmdlet, function, script file, or operable program|El término '([^']+)' no se reconoce como nombre de un cmdlet, función, archivo de script o programa ejecutable/i;
const CMD_NOT_RECOGNIZED = /(?:^|\s)'?([\w.-]+)'? is not recognized as an internal or external command|(?:^|\s)'?([\w.-]+)'? no se reconoce como un comando interno o externo/i;
/** El propio mensaje dice qué argumento lo resuelve (`Pass recursive: true to create missing parents`): se corrige la llamada, no hace falta un paso nuevo. */
const SELF_FIX = /recursive: true|create missing parents/i;
/** Comandos de Unix que no existen en PowerShell y tienen equivalente (`grep` → `Select-String`): hay que reescribir el comando, no instalar nada. */
const UNIX_ONLY = new Set(["grep", "egrep", "sed", "awk", "head", "tail", "wc", "which", "touch", "chmod", "chown", "ln", "du", "df", "uname", "xargs", "tee"]);

/** `Get-ChildItem`, `Move-Item`…: un cmdlet escrito mal es un error de tipeo (se corrige), no un programa que falta. */
const looksLikeCmdlet = (term: string): boolean => /^[A-Za-z]+-[A-Za-z]+$/.test(term);

/**
 * `null` si el error no deja claro que falte un prerrequisito.
 *
 * Los mensajes de las herramientas de archivos no son uniformes, así que solo se reconocen formas que ya se vieron en las trazas del eval.
 */
export function missingPrerequisite(call: FailedCallText): PrerequisiteSignal | null {
  const { kind, text } = call;
  if (PORT_IN_USE.test(text)) return "port_in_use";
  if (UNSUPPORTED_FORMAT.test(text)) return "unsupported_format";
  const ps = PS_NOT_RECOGNIZED.exec(text);
  if (ps !== null) {
    const term = ps[1] ?? ps[2] ?? "";
    return looksLikeCmdlet(term) || UNIX_ONLY.has(term.toLowerCase()) ? null : "program_not_found";
  }
  const cmd = CMD_NOT_RECOGNIZED.exec(text);
  if (cmd !== null) return UNIX_ONLY.has((cmd[1] ?? cmd[2] ?? "").toLowerCase()) ? null : "program_not_found";
  if (SELF_FIX.test(text)) return null;
  if (MISSING_PART_OF_PATH.test(text)) return "missing_destination";
  if (kind === "write" && WRITE_ENOENT.test(text)) return "missing_destination";
  return null;
}

// ───────────────────────── Paradas duras (`close`) ─────────────────────────

/** Por qué se cierra. */
export type HardStopSignal =
  | "refused" // el usuario, la política de seguridad o el anti-bucle del motor dijeron que no
  | "permission_denied"
  | "tests_or_build_failed"
  | "network_or_service" // red inalcanzable, DNS, TLS, 401/403/429/5xx, timeout
  | "disk"
  | "corrupt_or_locked"
  | "no_data_repeated"
  | "app_not_installed";

/** Causas del motor que ya significan «no»: reintentar sería ir contra lo que se decidió. */
const REFUSED_CAUSES: readonly StepFailureCause[] = ["user_rejected", "denied", "repeat_blocked"];

const PERMISSION = /\bEACCES\b|\bEPERM\b|permission denied|access (?:to the path )?is denied|operation not permitted|requires elevation|acceso denegado|se deneg[óo] el acceso|requiere elevaci[óo]n/i;
const TESTS_OR_BUILD = /\b\d+ (?:tests? )?failed\b|\bFAILED\b|Build FAILED|could not compile|error CS\d+|error\[E\d+\]/;
const NETWORK = /ENETUNREACH|ENOTFOUND|getaddrinfo|ECONNREFUSED|ECONNRESET|CERT_[A-Z_]+|certificate has expired|HTTP (?:401|403|429|5\d\d)\b|timed out|status: timeout|no es posible conectar con el servidor remoto|no se (?:pudo|puede|pueden) resolver el nombre|se agot[óo] el tiempo de espera/i;
const DISK = /ENOSPC|EROFS|no space left|not enough space|read-only file system|no hay suficiente espacio en el disco/i;
const CORRUPT_OR_LOCKED = /Invalid (?:PDF|xlsx|docx|zip)\b|corrupt|end-of-central-directory|\bEBUSY\b|resource busy or locked|being used by another process|est[áa] siendo utilizado por otro proceso/i;
const NO_DATA = /status: no_data|no passages matched/i;
/** `Start-Process <nombre>` sin ruta ni extensión: una aplicación de escritorio que no está instalada (un archivo que falta tiene ruta o extensión). */
const START_APP = /Start-Process\s+['"]?([A-Za-z0-9_.-]+)['"]?\s*$/;
const CANNOT_FIND_FILE = /cannot find the file specified|el sistema no puede encontrar el archivo especificado/i;

/** Lo que necesitan las reglas de parada: el texto del error, los intentos del ítem y la causa del motor. */
export interface RecoveryRuleInput extends FailedCallText {
  readonly attempts: number;
  readonly cause: StepFailureCause | null;
  /** El comando de la llamada fallida, si fue de terminal. */
  readonly command?: string;
}

/** `null` si el error no es una parada dura segura. */
export function hardStop(input: RecoveryRuleInput): HardStopSignal | null {
  const { text, attempts, cause, command } = input;
  if (cause !== null && REFUSED_CAUSES.includes(cause)) return "refused";
  if (PERMISSION.test(text)) return "permission_denied";
  if (TESTS_OR_BUILD.test(text)) return "tests_or_build_failed";
  if (attempts >= 2) {
    if (NETWORK.test(text)) return "network_or_service";
    if (DISK.test(text)) return "disk";
    if (CORRUPT_OR_LOCKED.test(text)) return "corrupt_or_locked";
    if (CANNOT_FIND_FILE.test(text)) {
      const app = command === undefined ? null : START_APP.exec(command.trim());
      if (app !== null && !/[.\\/]/.test(app[1] ?? "")) return "app_not_installed";
    }
  }
  if (attempts >= 3 && NO_DATA.test(text)) return "no_data_repeated";
  return null;
}

/**
 * Qué hacer según las reglas, o `null` para consultar al modelo. Una causa de rechazo cierra antes que nada; después, un prerrequisito faltante
 * replanifica; después, una parada dura cierra.
 */
export function recoveryRule(input: RecoveryRuleInput): "replan" | "close" | null {
  if (input.cause !== null && REFUSED_CAUSES.includes(input.cause)) return "close";
  // Un prerrequisito que sigue faltando tras 3 intentos ya se replanificó sin éxito: no se insiste (lo decide el modelo, que ve los intentos).
  if (input.attempts < 3 && missingPrerequisite(input) !== null) return "replan";
  return hardStop(input) !== null ? "close" : null;
}
