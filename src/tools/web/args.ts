/**
 * `web_search`: validación de los argumentos. Son comprobaciones duras de la herramienta: lo que no cumple se rechaza, no se corrige.
 * Los datos sensibles dentro de una consulta válida los decide el Guard (`core/policy/egress.ts`), no esta validación.
 */

export const FRESHNESS = ["day", "week", "month", "year"] as const;
export type Freshness = (typeof FRESHNESS)[number];

export const MAX_NEED_CHARS = 300;
export const MAX_TERMS = 10;
export const MAX_TERM_CHARS = 60;
export const MAX_URLS = 5;
export const MAX_URL_CHARS = 500;
export const MAX_DOMAINS = 5;

export interface WebArgs {
  readonly need: string;
  readonly terms: readonly string[];
  readonly urls: readonly string[];
  readonly freshness?: Freshness;
  readonly domains: readonly string[];
}

export type ArgsResult = { readonly ok: true; readonly args: WebArgs } | { readonly ok: false; readonly message: string };

const fail = (message: string): ArgsResult => ({ ok: false, message });

/** Hosts que nunca se leen: la propia PC y las redes internas. Solo por nombre y por dirección literal: no se resuelve ningún nombre. */
export function isInternalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (host.includes(":")) return host === "::1" || host === "::" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith("::ffff:");
  return false;
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

  const terms = listOf(raw.terms, "terms", MAX_TERMS);
  if (typeof terms === "string") return fail(terms);
  if (terms.some((t) => t.length > MAX_TERM_CHARS)) return fail(`Each item of 'terms' must be at most ${MAX_TERM_CHARS} characters.`);

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
  return { ok: true, args: { need, terms, urls, freshness, domains } };
}
