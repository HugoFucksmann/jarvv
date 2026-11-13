/**
 * `web_search`: validación de los argumentos. Son comprobaciones duras de la herramienta: lo que no cumple se rechaza, no se corrige.
 * Los datos sensibles dentro de una consulta válida los decide el Guard (`core/policy/egress.ts`), no esta validación.
 */

export const FRESHNESS = ["day", "week", "month", "year"] as const;
export type Freshness = (typeof FRESHNESS)[number];

export const MAX_NEED_CHARS = 300;
export const MAX_URLS = 5;
export const MAX_URL_CHARS = 500;
export const MAX_DOMAINS = 5;

export interface WebArgs {
  readonly need: string;
  readonly urls: readonly string[];
  readonly freshness?: Freshness;
  readonly domains: readonly string[];
}

export type ArgsResult = { readonly ok: true; readonly args: WebArgs } | { readonly ok: false; readonly message: string };

const fail = (message: string): ArgsResult => ({ ok: false, message });

/**
 * Hosts que nunca se leen: la propia PC y las redes internas. Solo por nombre y por dirección literal: no se resuelve ningún nombre (un dominio público que
 * apunte a una IP privada lo frena la protección SSRF de Free Search, no esta función). Un nombre de una sola etiqueta (`intranet`, `nas`) solo existe en
 * una red local; el punto final (`localhost.`) no cambia el host.
 */
export function isInternalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (host === "" || host === "localhost" || /\.(?:localhost|local|internal|lan|home\.arpa|intranet|corp)$/.test(host)) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 || // "esta red", privadas, loopback, multicast y reservadas
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) // red de pruebas de equipos
    );
  }
  if (host.includes(":")) return host === "::1" || host === "::" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith("::ffff:");
  return !host.includes("."); // una sola etiqueta: un nombre de la red local
}

/** Verbo de búsqueda al inicio. Solo verbos que no son también sustantivos de una consulta ("Google Chrome", "Search Console", "consulta SQL" quedan como están). */
const SEARCH_VERB =
  /^(?:(?:por favor|please)[\s,]+)?(?:busc(?:a|á|ar|ame|áme)|encontr(?:a|á|ar)|averigu(?:a|á|ar)|investig(?:a|á|ar)|search\s+for|search\s+(?:the\s+)?(?:web|internet)|find\s+out|look\s+up)(?![\p{L}\p{N}])[\s,:]*/iu;
/** El medio mencionado justo después del verbo ("en internet", "on the web", "en Google"). */
const MEDIUM = /^(?:en|on|in)\s+(?:(?:la|the)\s+)?(?:internet|web|google)(?![\p{L}\p{N}])[\s,:]*/iu;
/** El medio al final de la orden ("… en internet", "… online"). */
const TRAILING_MEDIUM = /[\s,]+(?:(?:en|on|in)\s+(?:(?:la|the)\s+)?(?:internet|web|google)|online)\s*(?=[.?!]*$)/iu;

/**
 * La pregunta para buscar, sin la orden que la envuelve: "Buscá en internet cuándo salió Node 22" → "cuándo salió Node 22". Los modelos chicos escriben
 * el `need` como instrucción a pesar de la nota, y "buscar", "internet" o "find" estorban al buscador, a BM25 y al juez. Es determinista y conservador: solo actúa
 * si el `need` EMPIEZA con un verbo de búsqueda (una pregunta como "How do cookies work on the web?" o "free JSON formatter online" no se toca); entonces quita el
 * verbo, el medio que lo sigue ("en internet") y el medio al final. "en Google" seguido de una palabra con mayúscula inicial es un producto ("en Google Maps"), no
 * el medio, y se conserva. Si no queda una pregunta razonable, se usa el `need` tal cual.
 */
export function searchQuestion(need: string): string {
  const verb = SEARCH_VERB.exec(need);
  if (verb === null) return need;
  let rest = need.slice(verb[0].length);
  const medium = MEDIUM.exec(rest);
  if (medium !== null && !(/google/i.test(medium[0]) && /^\p{Lu}/u.test(rest.slice(medium[0].length)))) rest = rest.slice(medium[0].length);
  const stripped = rest.replace(TRAILING_MEDIUM, "").trim();
  return stripped.replace(/[\s.?!¿¡]/g, "").length >= 3 ? stripped : need;
}

function listOf(value: unknown, name: string, max: number): string[] | string {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) return `'${name}' must be a list of texts.`;
  if (value.length > max) return `'${name}' accepts at most ${max} items.`;
  return value.map((v) => (v as string).trim()).filter((v) => v !== "");
}

export function parseArgs(raw: Record<string, unknown>): ArgsResult {
  const need = typeof raw.need === "string" ? raw.need.trim() : "";
  if (need === "") return fail("'need' is required: the question to answer, in natural language.");
  if (need.length > MAX_NEED_CHARS) return fail(`'need' is too long (${need.length} characters, max ${MAX_NEED_CHARS}). Make it shorter.`);

  const urls = listOf(raw.urls, "urls", MAX_URLS);
  if (typeof urls === "string") return fail(urls);
  for (const url of urls) {
    if (url.length > MAX_URL_CHARS) return fail(`A URL is too long (max ${MAX_URL_CHARS} characters).`);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return fail(`'${url.slice(0, 80)}' is not a valid URL.`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return fail(`Only http and https URLs can be read ('${parsed.protocol}' given).`);
    if (parsed.username !== "" || parsed.password !== "") return fail("URLs with credentials are not allowed.");
    if (isInternalHost(parsed.hostname)) return fail(`The host '${parsed.hostname}' is on this computer or an internal network and cannot be read.`);
  }

  const domains = listOf(raw.domains, "domains", MAX_DOMAINS);
  if (typeof domains === "string") return fail(domains);
  if (domains.some((d) => !/^[a-z0-9]([a-z0-9.-]{0,98}[a-z0-9])?$/i.test(d))) return fail("'domains' must be host names such as 'example.com'.");

  let freshness: Freshness | undefined;
  if (raw.freshness !== undefined) {
    if (typeof raw.freshness !== "string" || !(FRESHNESS as readonly string[]).includes(raw.freshness)) return fail(`'freshness' must be one of: ${FRESHNESS.join(", ")}.`);
    freshness = raw.freshness as Freshness;
  }
  return { ok: true, args: { need, urls, freshness, domains } };
}
