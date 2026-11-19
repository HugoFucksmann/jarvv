/**
 * `missingPrerequisite`: la regla determinista que reconoce un prerrequisito faltante en el error de un paso fallido. Pura, sin modelos.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { StepFailureCause } from "../src/core/engine/outcomes.ts";
import { hardStop, missingPrerequisite, recoveryRule } from "../src/core/engine/recoveryRules.ts";

const read = (text: string) => missingPrerequisite({ kind: "read", text });
const write = (text: string) => missingPrerequisite({ kind: "write", text });

test("puerto ocupado → port_in_use", () => {
  assert.equal(write("Error: listen EADDRINUSE: address already in use :::3000"), "port_in_use");
});

test("formato no soportado → unsupported_format", () => {
  assert.equal(read("Error: Unsupported image format: .heic (supported: png, jpg, webp)"), "unsupported_format");
  assert.equal(read("Error: Unsupported file type: .m4a (supported: txt, md, pdf)"), "unsupported_format");
});

test("programa no reconocido → program_not_found; un cmdlet mal escrito NO", () => {
  assert.equal(write("node : The term 'node' is not recognized as the name of a cmdlet, function, script file, or operable program."), "program_not_found");
  assert.equal(write("'pip' is not recognized as an internal or external command, operable program or batch file."), "program_not_found");
  assert.equal(read("Get-ChildItm : The term 'Get-ChildItm' is not recognized as the name of a cmdlet, function, script file, or operable program."), null);
});

test("ruta destino que no existe → missing_destination", () => {
  assert.equal(write("Move-Item : Could not find a part of the path 'C:/Users/x/Documents/Archivo/2024'."), "missing_destination");
  assert.equal(write("Error: ENOENT: no such file or directory, open 'C:/Users/x/Desktop/Clientes/lista.txt'"), "missing_destination");
});

test("casos que parecen prerrequisito pero se arreglan reescribiendo: null", () => {
  assert.equal(write("grep : The term 'grep' is not recognized as the name of a cmdlet, function, script file, or operable program."), null, "grep no existe en PowerShell: Select-String");
  assert.equal(write("'head' is not recognized as an internal or external command, operable program or batch file."), null);
  assert.equal(write("Error: ENOENT: parent directory 'C:/x/Facturas 2026' does not exist. Pass recursive: true to create missing parents."), null, "el mensaje dice el argumento");
});

test("un prerrequisito que sigue faltando al tercer intento no se vuelve a replanificar", () => {
  const input = { kind: "write", text: "node : The term 'node' is not recognized as the name of a cmdlet, function, script file, or operable program.", cause: "tool_failed" } as const;
  assert.equal(recoveryRule({ ...input, attempts: 1 }), "replan");
  assert.equal(recoveryRule({ ...input, attempts: 2 }), "replan");
  assert.equal(recoveryRule({ ...input, attempts: 3 }), null);
});

test("ENOENT al LEER es ambiguo (tipeo o archivo en otro lugar): null", () => {
  assert.equal(read("Error: ENOENT: no such file or directory, open 'C:/Users/x/Documents/Presupesto.xlsx'"), null);
});

test("errores arreglables o sin arreglo: null", () => {
  assert.equal(write("Error: Write rejected to prevent accidental data loss: a.txt already exists with content (3 bytes), and no 'mode' was specified."), null);
  assert.equal(read("Get-ChildItem : A positional parameter cannot be found that accepts argument 'Proyectos'."), null);
  assert.equal(write("Error: EACCES: permission denied, open 'C:/Program Files/app/config.ini'"), null);
  assert.equal(read("Error: connect ENETUNREACH 142.250.0.1:443 (network is unreachable)"), null);
  assert.equal(read(""), null);
});

// ───────────────────────── paradas duras (`close`) ─────────────────────────

const stop = (text: string, attempts: number, cause: StepFailureCause | null = "tool_failed", command?: string) =>
  hardStop({ kind: "read", text, attempts, cause, ...(command !== undefined ? { command } : {}) });

test("el usuario, la política o el anti-bucle dijeron que no → refused, con cualquier texto y desde el primer intento", () => {
  for (const cause of ["user_rejected", "denied", "repeat_blocked"] as const) assert.equal(stop("lo que sea", 1, cause), "refused");
  assert.equal(recoveryRule({ kind: "read", text: "EADDRINUSE", attempts: 1, cause: "denied" }), "close", "una causa de rechazo cierra antes que un prerrequisito");
});

test("permiso denegado, tests o compilación que fallan → close desde el primer intento", () => {
  assert.equal(stop("Error: EACCES: permission denied, open 'C:/Program Files/app/config.ini'", 1), "permission_denied");
  assert.equal(stop("Remove-Item : Access to the path is denied.", 1), "permission_denied");
  assert.equal(stop("FAIL src/api.test.js · 3 tests failed", 1), "tests_or_build_failed");
  assert.equal(stop("error[E0308]: mismatched types · could not compile `rs`", 1), "tests_or_build_failed");
});

test("red, servicio, disco, archivo corrupto o bloqueado → close solo con 2 o más intentos", () => {
  const cases: readonly [string, string][] = [
    ["Error: connect ENETUNREACH 142.250.0.1:443 (network is unreachable)", "network_or_service"],
    ["Error: HTTP 503 Service Unavailable", "network_or_service"],
    ["Error: request timed out after 30000 ms", "network_or_service"],
    ["Error: ENOSPC: no space left on device, write", "disk"],
    ["Error: Invalid PDF structure: missing xref table", "corrupt_or_locked"],
    ["Error: EBUSY: resource busy or locked, open 'a.db'", "corrupt_or_locked"],
  ];
  for (const [text, signal] of cases) {
    assert.equal(stop(text, 1), null, `1 intento: puede ser transitorio (${text})`);
    assert.equal(stop(text, 2), signal);
  }
});

test("aplicación que no existe: solo `Start-Process <nombre>` sin ruta ni extensión y con 2 intentos; un archivo que falta no", () => {
  const err = "Start-Process : This command cannot be run due to the error: The system cannot find the file specified.";
  assert.equal(stop(err, 2, "tool_failed", "Start-Process photoshop"), "app_not_installed");
  assert.equal(stop(err, 1, "tool_failed", "Start-Process photoshop"), null);
  assert.equal(stop(err, 2, "tool_failed", "Start-Process C:/Users/x/Desktop/factura.pdf"), null);
  assert.equal(stop(err, 2, "tool_failed", "Start-Process factura.pdf"), null);
  assert.equal(stop(err, 2, "tool_failed"), null, "sin el comando no se sabe");
});

test("sin datos: close solo desde el tercer intento; la primera búsqueda se reformula", () => {
  const text = "status: no_data · no passages matched the question";
  assert.equal(stop(text, 1), null);
  assert.equal(stop(text, 2), null);
  assert.equal(stop(text, 3), "no_data_repeated");
});

test("`recoveryRule`: prerrequisito → replan; parada dura → close; el resto, al modelo", () => {
  const base = { kind: "write", attempts: 1, cause: "tool_failed" } as const;
  assert.equal(recoveryRule({ ...base, text: "Error: listen EADDRINUSE: address already in use :::3000" }), "replan");
  assert.equal(recoveryRule({ ...base, text: "Error: EACCES: permission denied, open 'x'" }), "close");
  assert.equal(recoveryRule({ ...base, text: "Error: Write rejected: a.txt already exists, and no 'mode' was specified." }), null);
});
