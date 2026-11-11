/**
 * JARVIS Core — Comandos de terminal que se pueden volver a correr (RC-21).
 *
 * El anti-bucle no deja repetir una escritura idéntica (`strict`): repetirla pudo duplicar sus efectos (`Add-Content`, `git commit`). Pero hay comandos
 * cuya repetición es justamente lo pedido y no acumula nada: correr las pruebas o compilar otra vez después de un cambio. Para esos, `run_command`
 * declara la política `rerun` (`repeatByArgs` del manifiesto): el contexto deja repetirlos solo si hubo un efecto en el medio (algo cambió;
 * `ctx/derive.ts`, `isRepeat`). Sin cambio en el medio se bloquean igual que antes.
 *
 * Qué es "se puede volver a correr" se decide leyendo el texto, con el mismo criterio fail-closed que `readOnly.ts` (sin redirecciones, llamadas,
 * bloques ni variables; ninguna regla de comando lo marca). Cada segmento tiene que ser:
 * - una lectura (`isReadOnlySegment`) o un cambio de carpeta (`cd`, `Set-Location`, `Push-Location`, `Pop-Location`); o
 * - un comando de comprobación o de compilación de la lista cerrada `RUNNERS`: pruebas, linters, chequeos de tipos y compilaciones. Repetirlos
 *   reescribe sus salidas (no las acumula) y no envía nada afuera.
 * y al menos un segmento tiene que ser de `RUNNERS` (si todo lee, ya es una lectura).
 *
 * Lo que NO entra, a propósito: lo que agrega (`Add-Content`, `Out-File -Append`, `>>`: las redirecciones ya descartan el comando), lo que registra
 * o publica (`git commit`, `git push`, `npm publish`), lo que instala o borra (`npm install`, `Remove-Item`), y los scripts de npm con otros nombres
 * (`npm run deploy`: el nombre no dice qué hace). Esos siguen `strict`.
 */

import { analyzableSegments, isReadOnlySegment, noCommandRule } from "./readOnly.ts";

/** Nombres de scripts de npm/pnpm/yarn que comprueban o compilan (con un sufijo opcional: `test:unit`, `build:prod`). */
const SCRIPT_NAMES = /^(test|build|lint|check|typecheck|type-check)(:[\w.-]+)?$/i;

const sub =
  (...names: string[]) =>
  (args: readonly string[]): boolean =>
    args.length > 0 && names.includes(args[0].toLowerCase());

/** Gestores de paquetes de Node: `npm test`, `npm t`, `npm run build`, `yarn lint`, `pnpm run test:unit`. */
function packageScript(args: readonly string[]): boolean {
  if (args.length === 0) return false;
  const first = args[0].toLowerCase();
  if (first === "test" || first === "t" || first === "tst") return true;
  if ((first === "run" || first === "run-script") && args.length > 1) return SCRIPT_NAMES.test(args[1]);
  return SCRIPT_NAMES.test(first); // `yarn lint`, `pnpm build`
}

const NODE_TOOLS = new Set(["tsc", "eslint", "jest", "vitest", "mocha"]);

/** Programas de comprobación o compilación, por nombre en minúsculas sin `.exe`/`.cmd` → ¿estos argumentos comprueban o compilan? */
const RUNNERS: ReadonlyMap<string, (args: readonly string[]) => boolean> = new Map([
  ["npm", packageScript],
  ["pnpm", packageScript],
  ["yarn", packageScript],
  ["npx", (args: readonly string[]) => args.length > 0 && NODE_TOOLS.has(args[0].toLowerCase())],
  ["tsc", () => true],
  ["eslint", () => true],
  ["jest", () => true],
  ["vitest", () => true],
  ["mocha", () => true],
  ["pytest", () => true],
  ["node", (args: readonly string[]) => args[0] === "--test"],
  ["python", (args: readonly string[]) => args[0] === "-m" && ["pytest", "unittest", "mypy"].includes((args[1] ?? "").toLowerCase())],
  ["py", (args: readonly string[]) => args[0] === "-m" && ["pytest", "unittest", "mypy"].includes((args[1] ?? "").toLowerCase())],
  ["dotnet", sub("build", "test")],
  ["cargo", sub("build", "test", "check", "clippy")],
  ["go", sub("build", "test", "vet")],
  ["mvn", sub("compile", "test", "verify", "package")],
  ["gradle", sub("build", "test", "check")],
  ["gradlew", sub("build", "test", "check")],
  ["git", sub("status", "diff", "log", "show")],
]);

const NAVIGATION = new Set(["cd", "chdir", "set-location", "sl", "push-location", "pushd", "pop-location", "popd"]);

const programOf = (token: string): string =>
  token
    .toLowerCase()
    .replace(/^\.[\\/]/, "")
    .replace(/\.(exe|cmd|bat)$/, "");

/** ¿El segmento corre un comando de `RUNNERS` con argumentos de comprobación o compilación? */
function isRunnerSegment(segment: string): boolean {
  const tokens = segment.split(/\s+/).map((t) => t.replace(/^["']|["']$/g, ""));
  const check = RUNNERS.get(programOf(tokens[0] ?? ""));
  return check !== undefined && check(tokens.slice(1));
}

/** ¿El comando se puede volver a correr tras un cambio sin duplicar efectos? Ver el criterio en la cabecera. */
export function isRerunnableCommand(command: string): boolean {
  const segments = analyzableSegments(command);
  if (segments === null) return false;
  let runs = false;
  for (const segment of segments) {
    if (isRunnerSegment(segment)) {
      runs = true;
      continue;
    }
    const name = (segment.split(/\s+/)[0] ?? "").toLowerCase();
    if (!NAVIGATION.has(name) && !isReadOnlySegment(segment)) return false;
  }
  return runs && noCommandRule(command);
}
