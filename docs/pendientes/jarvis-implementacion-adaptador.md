# Jarvis: adaptador de salida de comandos

## Idea
Una capa dentro de `run_command` que controla qué ve Jarvis de la salida de un comando:

- **Resultado mínimo y exacto:** el modelo recibe solo lo que necesita para su siguiente paso, en texto comprimido con etiquetas fijas.
- **Tacha secretos** antes de que la salida llegue al modelo.
- **Guarda la salida completa** con un id.
- **Avisa cuando se recortó** y da la llamada exacta para pedir el resto.
- **Tool `read_output`** para leer partes de una salida guardada.

Se implementa en TypeScript, dentro de `src/tools/terminal/`. Todo se engancha en `settle()` de `terminalProvider.ts`.

## Contexto
- `run_command` lanza `powershell.exe` por comando; cada llamada devuelve solo la salida nueva.
- `settle()` toma la salida (`buffer.take()`), la recorta con `headTailNeutral` (`summaryMax` 2500, cabeza 20 %) y arma el resultado con `toolResult({ text, raw, data, meta })`.
- El resultado ya expone `data.truncated`. Lo que no existe: tachado de la salida, almacén con id y forma de pedir lo recortado.
- Convención de tools: nombre e `inputSchema` en inglés, `additionalProperties: false`, helper `fail()`.

## Formato de salida

### Objeto estructurado
El adaptador arma primero un objeto, que es la fuente de verdad. Va en `data` del `toolResult` y sirve a validadores, logs y tests.

```ts
{
  status: "finished" | "running" | "waiting_input" | "cancelled",
  ok: boolean,                    // exitCode === 0 (solo si finished)
  exitCode: number | null,
  durationMs: number,
  pid: number,
  cwd?: string,                   // solo en comandos nuevos
  output: { id: string, totalLines: number, omittedLines: number, clipped: boolean },
  errors: { count: number, lines: string[] },   // solo si falló
  head: string[],
  tail: string[],
  notes: string[],                // prompt, proceso vivo, modo no interactivo, etc.
  next?: { tool: "read_output", args: { id: string, offset?: number, limit?: number, query?: string } }
}
```

### Texto para el modelo
Un único renderizador (`renderResult`) convierte el objeto en texto. Nunca se arma texto a mano en otro lado.

Orden fijo y etiquetas que no cambian:

1. **Header:** `status: … · exit code: … · duration: … · pid: …` y `· cwd: …` solo en comandos nuevos. `exit code` solo si terminó.
2. **Veredicto:** `The command finished successfully.` o `The command failed (exit code N).`
3. **Notas:** las que apliquen (proceso vivo, espera de input, modo no interactivo).
4. **Descripción de la salida:** `Output o12: 340 lines. Showing …`, solo si se recortó.
5. **Cuerpo:** según la regla de abajo.
6. **`Next:`** con la llamada exacta, solo si hay algo recortado o si falló con errores identificados.

### Reglas del cuerpo
- **Éxito corto:** la salida pasa tal cual. Sin descripción de salida ni `Next:`.
- **Éxito largo:** inicio + final, con marcador `[… omitted: N lines]`.
- **Fallo:** primero las líneas de error (máximo 10), después el final de la salida.
- **Líneas de error** por patrón: `error`, `FAIL`, `TS\d+`, `Exception`. Es heurístico: nunca reemplaza al final de la salida. `errors.count` informa cuántas líneas se encontraron.
- El marcador de omisión declara **líneas** y está en inglés, como el resto del texto que ve el modelo.
- Los topes de caracteres para éxito y fallo son configurables; por defecto, el actual (`summaryMax`).

### Ejemplos

Éxito corto (sin extras):
```
status: finished · exit code: 0 · duration: 0.4s · pid: 4188 · cwd: E:\colo\jarvv
The command finished successfully.
On branch main
nothing to commit, working tree clean
```

Fallo con salida larga:
```
status: finished · exit code: 1 · duration: 8.4s · pid: 4120 · cwd: E:\colo\jarvv
The command failed (exit code 1).
Output o12: 340 lines. Showing 3 error lines and the last 4 lines.
src/core/budget.ts(12,3): error TS2322: Type 'string' is not assignable to type 'number'.
src/core/config.ts(40,7): error TS2304: Cannot find name 'BlacklistEntry'.
src/core/config.ts(41,9): error TS2304: Cannot find name 'BlacklistEntry'.
[… omitted: 333 lines]
Found 3 errors in 2 files.
Watch mode disabled.
Next: read_output {"id":"o12","query":"error"} lists every error line.
```

Éxito largo:
```
status: finished · exit code: 0 · duration: 0.3s · pid: 4201
The command finished successfully.
Output o13: 500 lines. Showing the first 8 and the last 30.
…
[… omitted: 462 lines]
…
Next: read_output {"id":"o13","offset":9,"limit":50} reads the omitted part, or add "query" to search it.
```

### Vistas del mismo objeto
- `full` (por defecto): el texto de arriba.
- `verdict`: header y veredicto, para consumidores que solo necesitan eso.
- `compact` (opcional): una línea para resultados viejos del historial, por ejemplo `run_command o12: failed (exit 1), 3 errors`.

## Implementación

### 1. Tachado de secretos
- Módulo nuevo `src/tools/terminal/redact.ts` con `redactSecrets(text)`.
- Se aplica en `settle()` justo después de `buffer.take()` y **antes** del recorte. Así `text`, `raw`, el objeto y el almacén salen limpios, y un secreto no queda partido por el recorte.
- Qué tachar:
  - Valores de las variables en `envRemove` (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `HF_TOKEN`), leídos de `process.env` al iniciar.
  - Regex Telegram `\d{10}:AA[A-Za-z0-9_-]{33}` y prefijo `hf_`.
- Ignorar valores de menos de 8 caracteres para no tachar números comunes.
- Aplicarlo también a `meta.command`.
- Es una capa extra, no una garantía.

### 2. Almacén de salidas
- `OutputStore` en memoria, propiedad del `TerminalProvider`.
- En `settle()`, después de tachar, agrega la salida de cada llamada a la entrada del proceso. Una sesión con varias continuaciones (`{ pid }`) acumula la salida completa.
- id propio con contador (por ejemplo `o12`), no el `pid`, porque los pid se reutilizan.
- Topes configurables: caracteres por entrada, cantidad de entradas y vencimiento (mismo criterio que `RETAIN_FINISHED_MS`). Al superarlos, se descarta lo más viejo.
- Los procesos huérfanos no guardan salida, igual que hoy.

### 3. Renderizador
- Módulo nuevo `src/tools/terminal/render.ts` con `buildResultObject(...)` y `renderResult(obj, view)`.
- `settle()` calcula estado, salida y flags como hoy, y delega en estas funciones el armado del objeto y del texto.
- Aplica las reglas de la sección "Formato de salida".

### 4. Tool `read_output`

```ts
{
  name: "read_output",
  description: "Read part of the full output of an earlier run_command, by output id.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Output id returned by run_command." },
      offset: { type: "integer", description: "1-based starting line (default 1)." },
      limit: { type: "integer", description: "Maximum lines to return." },
      query: { type: "string", description: "Only return lines containing this text." }
    },
    required: ["id"],
    additionalProperties: false
  }
}
```

- Segunda tool del mismo `TerminalProvider`, para compartir el almacén. Es de solo lectura, sin confirmación.
- `callTool` pasa a despachar por `name`.
- La respuesta usa el mismo formato (header, descripción de la salida, cuerpo, `Next:` si hay más), respeta `summaryMax` y usa `fail()` y `toolResult` como las demás tools.

### 5. Lista negra
Cargar `blacklist` en `jarvis-config.json` con los comandos peligrosos (`Remove-Item -Recurse` sobre raíces, `Format-Volume`, `Stop-Computer`).

## Orden de trabajo
1. `redact.ts` e inserción en `settle()`.
2. `OutputStore` e id.
3. `render.ts`: objeto, texto y reglas del cuerpo, con las capturas de los casos actuales para comparar.
4. Tool `read_output`: registro en el manifiesto y clasificación como lectura.
5. Probar con ~10 comandos reales: `npm run build`, `tsc --noEmit`, `git diff` grande, `Get-Content -Tail` de un log largo, `Get-Process`, una salida de más de 1M de caracteres.
6. Ajustar topes y proporción de cabeza/cola según lo observado.
7. Cargar `blacklist`.
8. Opcional: vista `compact` para el historial; resúmenes por tipo de comando.