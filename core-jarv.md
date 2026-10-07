# JARVIS — Arquitectura del Núcleo + Core Contracts v1.0

**Estado:** Normativo  
**Versión:** 1.0  
**Propósito:** Single Source of Truth de la arquitectura interna de JARVIS y de los contratos propios de Core.

> **Nota sobre Decision 2.0**
>
> Este documento **no redefine la especificación de Decision 2.0**.
>
> La documentación oficial de Decision 2.0 es la única fuente de verdad para:
>
> - tipos de preguntas;
> - `DecisionQuestion`;
> - `criteria`;
> - `instructions`;
> - formato exacto de request/response;
> - semántica de `choice`, `noul`, `score`;
> - runtime;
> - límites propios del modelo;
> - y cualquier otro detalle interno de Decision 2.0.
>
> Este documento únicamente define cómo **JARVIS Core integra y utiliza Decision 2.0**.

---

# 1. Objetivo

JARVIS es un agente local controlado por un **Core determinista**.

El objetivo de esta arquitectura es separar claramente:

- control de estado;
- planificación;
- routing;
- descubrimiento de herramientas;
- selección de herramientas;
- generación de argumentos;
- autorización;
- ejecución;
- verificación;
- evidencia;
- memoria temporal de tarea;
- respuesta final.

El sistema debe ser:

- determinista donde corresponde;
- pequeño;
- predecible;
- auditable;
- resistente a loops;
- resistente a instrucciones provenientes de herramientas o contenido externo;
- independiente de un proveedor específico de MCP;
- y controlado por Core.

---

# 2. Principio central

La regla fundamental es:

> **Core controla. Decision 2.0 decide. Qwen interpreta. Discovery determina las herramientas disponibles. MCP ejecuta. Policy Registry clasifica. Guard autoriza. Result Processor reduce y normaliza. Evidence representa evidencia. Scratchpad conserva estado estructurado. Verify determina el estado de verificación.**

Ningún modelo controla la arquitectura.

Ningún modelo ejecuta herramientas directamente.

Ningún resultado externo puede modificar las políticas del Core.

---

# 3. Componentes

## 3.1 Core

Core es la autoridad del sistema.

Responsabilidades:

- recibir la intención del usuario;
- crear y mantener `Task`;
- mantener `currentStep`;
- controlar `StepState`;
- controlar `TaskState`;
- aplicar límites;
- solicitar decisiones a Decision 2.0;
- solicitar planificación/argumentos/respuesta a Qwen;
- realizar Discovery;
- validar schemas;
- consultar Policy Registry;
- ejecutar Guard;
- solicitar aprobación al usuario cuando corresponda;
- ejecutar MCPs;
- procesar resultados;
- actualizar Evidence;
- actualizar Scratchpad;
- controlar Verify;
- manejar retries;
- manejar timeout;
- manejar cancelación;
- impedir loops;
- producir la respuesta final.

Core es quien determina las transiciones.

---

## 3.2 Qwen 9B

Qwen se utiliza para:

- interpretación de lenguaje;
- generación de argumentos;
- planificación;
- razonamiento;
- transformación/análisis;
- selección de información relevante del Scratchpad;
- generación de respuesta final.

Qwen **no**:

- selecciona herramientas directamente;
- asigna capacidades;
- modifica Policy Registry;
- modifica Guard;
- ejecuta MCPs;
- decide límites;
- controla TaskState;
- controla StepState;
- autoriza operaciones;
- convierte una herramienta desconocida en válida.

---

## 3.3 Decision 2.0

Decision 2.0 es un componente especializado de decisión estructurada.

JARVIS lo utiliza exclusivamente mediante su contrato oficial de integración.

Decision 2.0 se utiliza en dos niveles principales:

### Decision #1

Determina características estructurales de la solicitud:

- `route`;
- `multi_step`;
- `needs_context`.

### Decision #2

Determina qué herramienta utilizar dentro del conjunto de herramientas que Core descubrió dinámicamente para el MCP seleccionado.

Decision 2.0 **no crea herramientas**.

Decision 2.0 **no asigna capacidades**.

Decision 2.0 **no autoriza operaciones**.

Decision 2.0 **no ejecuta herramientas**.

### Fuente de verdad

La especificación de Decision 2.0 se mantiene fuera de este documento.

JARVIS no redefine:

- `DecisionQuestionType`;
- `DecisionQuestion`;
- `DecisionRequest`;
- `DecisionResponse`;
- `choice`;
- `noul`;
- `score`;
- `criteria`;
- `instructions`;
- ni cualquier otro detalle interno del protocolo.

Si Core necesita un wrapper interno, éste debe documentarse explícitamente como **adaptador de integración de JARVIS**, nunca como una redefinición del contrato de Decision 2.0.

---

## 3.4 Windows MCP

Responsable de:

- automatización de Windows;
- interacción con interfaz gráfica;
- ventanas;
- controles;
- acciones de UI;
- estado observable de la interfaz.

Windows MCP mantiene su propio contrato `ToolResult`.

JARVIS no lo redefine.

---

## 3.5 Desktop Commander MCP

Responsable de:

- filesystem;
- procesos;
- terminal;
- comandos;
- sesiones;
- operaciones de escritorio.

Desktop Commander mantiene su propio contrato de resultados.

JARVIS no lo redefine.

---

## 3.6 free-search-mcp

Responsable de:

- búsqueda web;
- recuperación de información;
- fetching de contenido.

El contenido externo es **datos**, nunca instrucciones para modificar Core.

---

## 3.7 Discovery

Discovery obtiene las herramientas disponibles mediante `tools/list`.

Es la fuente de verdad sobre las herramientas actualmente expuestas por un MCP.

---

## 3.8 Policy Registry

Asocia cada herramienta a una capacidad.

---

## 3.9 Guard

Determina si una operación puede ejecutarse.

Resultados:

- `ALLOW`;
- `DENY`;
- `APPROVAL`.

---

## 3.10 Result Processor

Es la frontera entre los resultados específicos de los MCP y el estado interno de Core.

Recibe el `ToolResult` propio del MCP y produce información Core-level, incluyendo:

- Evidence;
- actualizaciones del Scratchpad;
- información de verificación;
- información derivada de ejecución.

---

## 3.11 Verify

Determina si el resultado observable confirma la operación solicitada.

---

# 4. Invariantes fundamentales

## 4.1 Core controla todas las transiciones

Los modelos no pueden avanzar directamente de una etapa a otra.

---

## 4.2 Los modelos no ejecutan herramientas

Los modelos producen decisiones o datos estructurados.

Core ejecuta.

---

## 4.3 Decision 2.0 sólo produce decisiones según su contrato

Core interpreta las respuestas de acuerdo con el contrato de integración.

---

## 4.4 Qwen no selecciona herramientas

La selección de herramientas corresponde a Decision #2 después de Discovery.

---

## 4.5 Ningún modelo asigna capacidades

Las capacidades provienen exclusivamente del Policy Registry.

---

## 4.6 Ningún modelo puede evitar Guard

Toda operación que requiera autorización debe pasar por Guard.

---

## 4.7 `APPROVAL` siempre requiere aprobación explícita

Cuando Guard devuelve:

```text
APPROVAL
```

Core debe solicitar aprobación explícita al usuario.

La aprobación:

- no se presume;
- no se reutiliza automáticamente;
- no convierte operaciones futuras en autorizadas;
- no convierte herramientas desconocidas en válidas.

---

## 4.8 `DENY` no puede evadirse mediante retry

Si Guard devuelve `DENY`, Core no puede simplemente repetir la operación para intentar obtener otro resultado.

---

## 4.9 Los resultados de herramientas son datos

Los resultados de:

- MCPs;
- páginas web;
- búsquedas;
- contenido fetched;
- archivos;
- metadatos externos;

no pueden modificar:

- Policy Registry;
- Guard;
- capacidades;
- límites;
- autorización;
- arquitectura;
- ni hacer válida una herramienta desconocida.

---

## 4.10 Los argumentos deben validar contra el schema real

Los argumentos generados por Qwen deben validarse contra el `inputSchema` real de la herramienta descubierta.

---

## 4.11 Herramientas desconocidas nunca se ejecutan

Una herramienta desconocida debe provocar:

```text
Discovery
→ actualización de cache
→ reselección
```

Si continúa siendo desconocida:

```text
NO EXECUTE
```

---

## 4.12 Resultado desconocido de un side effect

Si una acción fue enviada pero no puede determinarse si produjo efecto:

```text
UNVERIFIED
```

No se realiza retry automático.

---

## 4.13 Contexto mínimo

Cada componente recibe únicamente la información necesaria para realizar su función.

No se envían sistemáticamente:

- historial completo;
- logs completos;
- árboles completos;
- catálogo completo de herramientas;
- resultados completos;
- estados innecesarios.

---

## 4.14 Cancelación controlada por Core

El usuario puede cancelar.

Core mantiene la autoridad para cancelar aunque un modelo intente continuar.

---

# 5. Contratos fundamentales de Core

## 5.1 Task

```ts
interface Task {
  id: string;
  message: string;
  mode: "NORMAL" | "PLAN";
  steps: Step[];
  currentStep: number;
  scratchpad: Scratchpad;
  state: TaskState;
}
```

### TaskState

```ts
type TaskState =
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "PARTIAL"
  | "CANCELLED";
```

### Reglas

`currentStep` identifica el paso activo dentro de la tarea.

`scratchpad` contiene estado estructurado temporal asociado a la tarea.

Una tarea puede finalizar como `PARTIAL` cuando algunos pasos fueron completados y otros fallaron o quedaron sin verificar.

---

# 6. Step

```ts
interface Step {
  id: string;
  route: StepRoute;
  instruction: string;
  mcp?: string;
  tool?: string;
  args?: Record<string, unknown>;
  state: StepState;
}
```

### StepRoute

```ts
type StepRoute =
  | "chat"
  | "windows"
  | "desktop_commander"
  | "free_search";
```

### StepState

```ts
type StepState =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "UNVERIFIED"
  | "BLOCKED";
```

`instruction` representa la intención operacional del paso.

`mcp`, `tool` y `args` son opcionales porque pueden determinarse durante el flujo.

---

# 7. Plan

```ts
interface Plan {
  steps: PlanStep[];
}

interface PlanStep {
  id: string;
  route: StepRoute;
  instruction: string;
}
```

Schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["steps"],
  "properties": {
    "steps": {
      "type": "array",
      "minItems": 1,
      "maxItems": 15,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "route", "instruction"],
        "properties": {
          "id": {
            "type": "string"
          },
          "route": {
            "type": "string",
            "enum": [
              "chat",
              "windows",
              "desktop_commander",
              "free_search"
            ]
          },
          "instruction": {
            "type": "string",
            "minLength": 1
          }
        }
      }
    }
  }
}
```

## Regla importante

`PlanStep` **no contiene referencias a Scratchpad** en v1.

El Scratchpad pertenece a `Task`.

Core puede utilizar el Scratchpad durante la ejecución de cada `PlanStep`, pero el contrato de `PlanStep` no introduce ningún mecanismo adicional de referencia al Scratchpad.

No existen referencias formales a Scratchpad dentro del schema del Plan en v1.

---

# 8. Scratchpad

```ts
interface Scratchpad {
  search_results?: unknown[];
  selected_result?: unknown;
  url?: string;
  path?: string;
  process_id?: string;
  window_handle?: string;
  element_id?: string;
  text?: string;
}
```

El Scratchpad es:

- pequeño;
- estructurado;
- temporal;
- extensible.

Puede almacenar información necesaria para pasos posteriores.

Core determina qué campos son relevantes para cada paso.

No se debe convertir el Scratchpad en un historial completo de ejecución.

---

# 9. Evidence

```ts
interface Evidence {
  ok: boolean;
  summary?: string;
  flags?: string[];
  ref?: string;
}
```

Evidence representa información observada o derivada que puede utilizarse para determinar el estado de una operación.

---

# 10. VerificationState

```ts
type VerificationState =
  | "VERIFIED"
  | "NOT_REQUIRED"
  | "UNVERIFIED";
```

### Significado

`VERIFIED`:

Existe evidencia suficiente de que el resultado esperado ocurrió.

`NOT_REQUIRED`:

No era necesaria una verificación adicional.

`UNVERIFIED`:

La operación pudo haberse ejecutado, pero Core no dispone de evidencia suficiente para confirmar el resultado.

---

# 11. ExecutionOutcome

```ts
interface ExecutionOutcome {
  success?: boolean;
  isError?: boolean;
  actionDispatched?: boolean;
  outcomeVerified?: boolean;
}
```

`ExecutionOutcome` es información **derivada por Core**.

No reemplaza el `ToolResult` del MCP.

Cada MCP mantiene su propio contrato de resultado.

La relación correcta es:

```text
MCP-specific ToolResult
        ↓
Result Processor
        ↓
ExecutionOutcome / Evidence / Scratchpad / Verification
```

---

# 12. FinalResponse

```ts
type FinalResponse = string;
```

Core determina cuándo debe producirse la respuesta final.

Puede utilizar:

- una respuesta directa;
- información del Scratchpad;
- Evidence;
- Qwen para generación lingüística.

No existe un tipo especial obligatorio de "closing step".

Un `chat` puede ser el último Step.

---

# 13. Límites globales

```ts
const MAX_STEPS = 15;
const MAX_TOOL_CALLS_PER_STEP = 4;
const MAX_PLAN_GENERATION_ATTEMPTS = 1;
const MAX_ARG_RETRIES = 1;
```

## MAX_STEPS

Máximo absoluto de pasos por tarea.

Aplica a:

- NORMAL;
- PLAN.

No representa un objetivo ni un mínimo.

---

## MAX_TOOL_CALLS_PER_STEP

Máximo de invocaciones de herramientas por Step.

Incluye:

- llamada inicial;
- retries;
- regeneraciones que terminen en una nueva invocación.

---

## MAX_PLAN_GENERATION_ATTEMPTS

```text
1
```

Sólo existe un intento de generación de plan.

Si el plan es inválido:

```text
Task FAILED
```

No se permite generación recursiva automática.

---

## MAX_ARG_RETRIES

```text
1
```

Permite una regeneración de argumentos después de un error específico de validación de schema.

Si falla nuevamente:

```text
Step FAILED
```

---

# 14. Modos

## 14.1 NORMAL

Modo predeterminado.

Core puede ejecutar una secuencia de pasos.

Si Decision #1 indica:

```text
multi_step = true
```

Qwen puede generar un mini-plan.

---

## 14.2 PLAN

El usuario selecciona explícitamente PLAN desde UI.

Flujo:

```text
Usuario
→ Core
→ Qwen genera Plan
→ Core valida
→ UI muestra Plan
→ Usuario confirma
→ Core ejecuta
```

Guard continúa aplicándose individualmente durante la ejecución.

---

## 14.3 AGENT

No pertenece a v1.

Queda reservado para una futura evolución.

---

# 15. Decision #1 — Routing

Decision #1 responde a tres decisiones estructurales utilizadas por Core:

```text
route
multi_step
needs_context
```

### `route`

Determina la ruta funcional:

```text
chat
windows
desktop_commander
free_search
```

### `multi_step`

Determina si la solicitud requiere una secuencia de pasos.

### `needs_context`

Determina si Core debe ampliar temporalmente el contexto entregado para interpretar la solicitud.

---

## 15.1 `needs_reasoning`

`needs_reasoning` **NO forma parte del request real de Decision #1 en JARVIS v1**.

No debe implementarse como una pregunta operacional independiente.

El razonamiento de Qwen se activa según las necesidades concretas del flujo:

- generación de argumentos;
- planificación;
- análisis;
- respuesta;
- etc.

---

# 16. Contexto de Decision #1

Por defecto:

```text
mensaje actual
+
mensaje anterior
```

Si `needs_context = true`:

```text
hasta 5 mensajes
```

Si todavía resulta insuficiente:

```text
hasta 10 mensajes
```

El contexto ampliado es temporal.

No se acumula indefinidamente.

---

# 17. Integración con Decision 2.0

Core envía a Decision 2.0 únicamente la información necesaria según el contrato oficial.

El documento oficial de Decision 2.0 define:

- estructura exacta;
- preguntas;
- tipos;
- criteria;
- instructions;
- respuesta;
- runtime;
- semántica interna.

JARVIS sólo define:

### Decision #1

Core solicita:

```text
route
multi_step
needs_context
```

Core interpreta el resultado para decidir el siguiente flujo.

### Decision #2

Core solicita selección de herramienta.

Las opciones de Decision #2 proceden exclusivamente de Discovery.

Core interpreta la respuesta como la selección de una herramienta candidata.

La herramienta debe seguir siendo validada por Core antes de ejecutarse.

---

# 18. Decision #2 — Tool Selection

Decision #2 recibe exclusivamente herramientas descubiertas para el MCP seleccionado.

Cada opción disponible procede de:

```text
tools/list
```

y puede incluir la información proporcionada por el MCP, como:

- nombre;
- descripción;
- `inputSchema`.

Decision #2:

- no crea herramientas;
- no modifica schemas;
- no asigna capacidades;
- no autoriza;
- no ejecuta.

Si la herramienta seleccionada ya no existe:

```text
Discovery
→ actualización de cache
→ nueva selección
```

Si continúa sin existir:

```text
NO EXECUTE
```

---

# 19. Discovery

Discovery utiliza:

```text
tools/list
```

como fuente de verdad.

La cache puede actualizarse cuando:

- un MCP inicia;
- un MCP se conecta;
- cambia el hash de `tools/list`;
- ocurre una reconexión;
- Core detecta una herramienta desconocida.

La reconexión puede invalidar identificadores dinámicos, especialmente en Windows MCP.

---

# 20. Límite de opciones de Decision #2

Como política de Core:

- máximo recomendado de opciones: `255`;
- contexto objetivo: `8192` tokens.

Si el conjunto excede el presupuesto:

Core debe reducirlo o agruparlo de forma determinista.

Qwen no recibe automáticamente el catálogo completo de herramientas.

---

# 21. Qwen — Argument Generation

Qwen recibe únicamente lo necesario para generar argumentos:

- Step;
- herramienta seleccionada;
- `inputSchema` real;
- Scratchpad relevante;
- contexto mínimo necesario.

Los argumentos deben satisfacer el `inputSchema`.

Ejemplo conceptual:

```json
{}
```

es válido únicamente si el schema real de la herramienta lo permite.

---

# 22. Qwen — Plan Generation

Qwen puede generar un Plan cuando:

- NORMAL requiere `multi_step`;
- el usuario selecciona PLAN.

El plan máximo es:

```text
15 pasos
```

No existen planes recursivos en v1.

Core valida:

- estructura;
- cantidad de pasos;
- IDs;
- routes;
- instrucciones.

Qwen no ejecuta el plan.

---

# 23. Qwen — Chat

Qwen puede:

- interpretar;
- analizar;
- transformar;
- seleccionar información relevante del Scratchpad;
- escribir información permitida en Scratchpad;
- generar respuesta final.

Un Step:

```text
route = "chat"
```

no ejecuta herramientas.

---

# 24. Contrato de MCP Results

## Regla fundamental

> **JARVIS no redefine los `ToolResult` de los MCP.**

Cada MCP mantiene su propio contrato.

Ejemplos:

```text
Windows MCP ToolResult
Desktop Commander ToolResult
free-search-mcp ToolResult
future MCP-specific ToolResult
```

Core no reemplaza esos contratos por un `ToolResult` universal.

En cambio:

```text
MCP ToolResult
       ↓
Result Processor
       ↓
Core-level interpretation
       ↓
Evidence
Scratchpad
Verification
ExecutionOutcome
```

Esto permite mantener los detalles específicos de cada MCP sin contaminar el contrato central.

---

# 25. Windows MCP — Integration Boundary

Windows MCP mantiene su contrato propio.

Entre los datos que pueden formar parte de sus resultados se encuentran:

```text
success
actionDispatched
outcomeVerified
changes
postActionState
postActionElement
postActionSnapshotIncomplete
postActionWarning
snapshotIncomplete
snapshotWarning
search_incomplete
truncated
```

Estos campos siguen perteneciendo al contrato de Windows MCP.

Core puede utilizarlos mediante Result Processor.

---

## 25.1 `changes`

Representa cambios observados o reportados después de una acción.

Puede utilizarse como evidencia.

---

## 25.2 `postActionSnapshotIncomplete`

Indica que el estado posterior capturado está incompleto.

No implica automáticamente que la operación haya fallado.

Puede contribuir a:

```text
VERIFIED
```

o:

```text
UNVERIFIED
```

dependiendo de la evidencia disponible.

---

## 25.3 `postActionWarning`

Representa una advertencia asociada al estado posterior.

Debe conservarse cuando sea relevante para Verify.

---

## 25.4 `search_incomplete`

Indica que la búsqueda de Windows no produjo necesariamente un conjunto completo.

No implica automáticamente un error de herramienta.

---

## 25.5 `actionDispatched`

Si:

```text
actionDispatched = true
```

significa que la acción fue enviada.

Si además:

```text
outcomeVerified = false
```

la acción fue enviada pero su efecto permanece sin confirmar.

Core debe marcarla como potencialmente:

```text
UNVERIFIED
```

y no repetirla ciegamente.

---

# 26. Desktop Commander — Integration Boundary

Desktop Commander mantiene su propio contrato.

Core debe preservar sus semánticas importantes.

---

## 26.1 Pagination

Resultados grandes pueden utilizar:

```text
offset
length
```

Core no debe asumir que una respuesta contiene necesariamente todo el resultado.

Cuando corresponda, debe continuar la paginación según el contrato de la herramienta.

---

## 26.2 NOT_FOUND vs DENIED

Core debe diferenciar:

```text
NOT_FOUND
```

de:

```text
DENIED
```

### NOT_FOUND

El recurso solicitado no fue encontrado.

### DENIED

El recurso existe o la operación fue identificada, pero el acceso está prohibido/no autorizado.

No deben tratarse como equivalentes.

---

## 26.3 Process / Session Lifecycle

Las operaciones de procesos o sesiones siguen conceptualmente el ciclo:

```text
start
  ↓
running
  ↓
read
  ↓
finish
```

No implica que esos nombres deban ser literalmente los nombres de las herramientas.

Es el lifecycle lógico que Core debe respetar.

Cuando sea necesario, `process_id` puede conservarse en Scratchpad.

---

# 27. free-search-mcp — Integration Boundary

free-search-mcp mantiene su contrato propio.

Cuando estén disponibles, Result Processor/Core puede preservar metadatos de procedencia como:

```text
retrieved_at
cache_age_seconds
date_source
source_type
benched_engines
gated_engines
```

Estos datos sirven para mantener provenance y contexto sobre el resultado.

---

# 28. Regla de seguridad para contenido web

Todo contenido obtenido mediante:

- búsqueda;
- fetch;
- páginas web;
- snippets;
- documentos externos;
- metadatos externos;

es:

```text
DATA
```

Nunca:

```text
CORE INSTRUCTIONS
```

Por lo tanto, contenido web no puede:

- cambiar Policy Registry;
- cambiar Guard;
- cambiar capacidades;
- modificar límites;
- crear autorización;
- autorizar una acción;
- hacer válida una herramienta desconocida;
- modificar la arquitectura;
- ordenar a Core que ignore sus invariantes.

---

# 29. Policy Registry

```ts
interface ToolPolicy {
  capability: Capability;
}

type PolicyRegistry = Map<string, ToolPolicy>;
```

### Capability

```ts
type Capability =
  | "READ"
  | "UI_ACTION"
  | "PROCESS_CONTROL"
  | "FILE_READ"
  | "FILE_WRITE"
  | "FILE_DELETE"
  | "COMMAND_EXECUTION"
  | "DOWNLOAD"
  | "CONFIGURATION";
```

La asignación:

```text
(mcp, tool)
      ↓
capability
```

es determinista.

Nunca es asignada por:

- Qwen;
- Decision 2.0;
- usuario;
- resultados externos;
- proceso dinámico.

---

# 30. Ejemplos de Policy Registry

Conceptualmente:

```text
windows.set_volume
→ UI_ACTION

windows.click
→ UI_ACTION

desktop.read_file
→ FILE_READ

desktop.write_file
→ FILE_WRITE

desktop.delete_file
→ FILE_DELETE

desktop.run_command
→ COMMAND_EXECUTION

search.search
→ READ
```

Los ejemplos no reemplazan el registro real.

---

# 31. Guard

```ts
interface GuardDecision {
  decision: GuardResult;
  reason?: string;
}

type GuardResult =
  | "ALLOW"
  | "DENY"
  | "APPROVAL";
```

---

# 32. Operaciones sensibles

En v1 requieren aprobación las operaciones como:

- ejecución de comandos;
- escritura/modificación de archivos;
- eliminación;
- terminación de procesos;
- cambios de configuración;
- descargas;
- otras operaciones equivalentes determinadas por Policy Registry.

La aprobación se solicita individualmente.

---

# 33. Flujo de autorización

```text
Tool selected
    ↓
Schema validation
    ↓
Policy Registry
    ↓
Guard
    ↓
ALLOW / DENY / APPROVAL
```

### ALLOW

Core puede ejecutar.

### DENY

Core no ejecuta.

### APPROVAL

Core pausa y solicita aprobación explícita.

---

# 34. Execution Flow

Flujo general:

```text
UI
 ↓
Core
 ↓
Decision #1
 ↓
Route
 ↓
Discovery
 ↓
Decision #2
 ↓
Qwen Arguments / Chat / Plan
 ↓
Schema Validation
 ↓
Policy Registry
 ↓
Guard
 ↓
MCP Execute
 ↓
MCP-specific ToolResult
 ↓
Result Processor
 ↓
Evidence / Scratchpad / Verify
 ↓
Next Step
 ↓
Final Response
```

La representación es conceptual.

Qwen puede ser utilizado en diferentes puntos según la operación.

---

# 35. Execution State Machine

Una operación típica:

```text
PENDING
   ↓
RUNNING
   ↓
COMPLETED
```

Puede producir:

```text
FAILED
UNVERIFIED
BLOCKED
```

---

# 36. Side Effects

Los side effects requieren especial cuidado.

## Caso A — resultado conocido como exitoso

```text
COMPLETED
+
VERIFIED
```

---

## Caso B — acción enviada, resultado desconocido

```text
UNVERIFIED
```

No retry automático.

---

## Caso C — evidencia explícita de que la acción nunca fue enviada

```text
FAILED
```

Puede retryarse según la política.

---

## Caso D — DENY

```text
BLOCKED / FAILED
```

No retry para evadir la autorización.

---

# 37. Retry Policy

## READ + timeout

Puede:

```text
FAILED
→ retry
```

si la política de la operación lo permite.

---

## SIDE EFFECT + unknown result

```text
UNVERIFIED
→ NO automatic retry
```

---

## SIDE EFFECT + never dispatched

```text
FAILED
→ retry permitido según política
```

---

## DENY

```text
NO RETRY
```

---

# 38. Anti-loop

Core mantiene una firma operacional:

```text
hash(mcp + tool + args)
```

Esto permite detectar repetición de la misma operación.

Además:

```text
MAX_TOOL_CALLS_PER_STEP = 4
```

limita el número total de llamadas.

No existen retries infinitos.

`UNVERIFIED` no provoca retry automático.

---

# 39. Timeout

Cada operación puede tener timeout.

Si se produce timeout:

Core determina si:

- no hubo side effect;
- el side effect fue enviado;
- el resultado quedó desconocido.

No debe asumir automáticamente que timeout equivale a "no ocurrió nada".

---

# 40. Cancellation

La cancelación sigue:

```text
UI
 ↓
Core
 ↓
Step
 ↓
MCP / Tool
```

Core mantiene el control.

Si una cancelación ocurre durante un side effect cuyo resultado queda desconocido:

```text
Step = UNVERIFIED
```

No se repite automáticamente.

---

# 41. Unknown Tool Flow

Si Core recibe una herramienta desconocida:

```text
Unknown Tool
      ↓
tools/list
      ↓
Update Discovery Cache
      ↓
Re-select
```

Si la herramienta continúa sin existir:

```text
NO EXECUTE
```

La aprobación del usuario no convierte un identificador desconocido en una herramienta válida.

---

# 42. PLAN Execution

## Generación

```text
Qwen
 ↓
Plan
 ↓
Core validation
```

## Validación

Core valida:

- schema;
- número de pasos;
- routes;
- instrucciones;
- límites.

## Confirmación

En modo PLAN:

```text
Plan
 ↓
UI
 ↓
User approval
 ↓
Execution
```

La aprobación del plan no elimina las comprobaciones de Guard.

Una operación individual puede seguir requiriendo:

```text
APPROVAL
```

durante la ejecución.

---

# 43. Fallo de Plan

Si un Step del plan falla:

Core determina el estado de la tarea.

Puede terminar:

```text
PARTIAL
```

cuando algunos pasos fueron completados.

No se permite que Qwen:

- invente automáticamente una nueva herramienta;
- cambie Policy Registry;
- evada Guard;
- cree un plan recursivo;
- ejecute una herramienta no descubierta.

---

# 44. Result Processor

Result Processor es responsable de transformar resultados específicos de MCP en información útil para Core.

Funciones:

- normalización;
- reducción;
- truncado;
- extracción;
- preservación de evidencia;
- preservación de provenance;
- extracción de estados;
- actualización de Scratchpad;
- preparación de información para Verify.

No debe destruir información necesaria para determinar si una operación tuvo efecto.

---

# 45. Context Boundary

Qwen no debe recibir automáticamente:

- catálogo completo de herramientas;
- logs completos;
- historial completo;
- árboles completos de UI;
- todos los resultados de búsqueda;
- todos los archivos;
- todo el Scratchpad.

Core selecciona el contexto relevante.

---

# 46. Final Response

Core determina cuándo una tarea puede producir su respuesta final.

Para acciones simples:

```text
template → response
```

Para resultados informativos:

```text
Evidence / Scratchpad
        ↓
Qwen
        ↓
FinalResponse
```

Qwen recibe únicamente la información necesaria.

---

# 47. Reusable Infrastructure

La infraestructura existente puede reutilizarse cuando sea compatible.

Puede incluir:

```text
ITool
BaseTool
ToolResult
TaskToolContext
PermissionManager
audit log
SubagentManager
cancellation
timeouts
events
MCP registry
MCP adapters
```

`SubagentManager` puede existir como infraestructura, pero:

```text
NO SUBAGENTS IN V1
```

---

# 48. Infraestructura que no debe reutilizarse como Decision Core

No deben reutilizarse como núcleo decisional:

### AgentLoop ReAct

No debe controlar el flujo principal.

### ToolPlanner basado en keywords/trigrams

No debe sustituir Discovery + Decision #2.

### ContextBuilder monolítico

No debe acumular indiscriminadamente todo el contexto.

### Exposición indiscriminada de herramientas al LLM

No debe enviarse el catálogo completo sin necesidad.

### `messages[]` ilimitado

No debe existir acumulación infinita de historial.

---

# 49. Seguridad

## 49.1 Models are untrusted decision helpers

Los modelos no tienen autoridad arquitectónica.

---

## 49.2 Tool outputs are untrusted data

Un resultado de herramienta no puede modificar las políticas.

---

## 49.3 Web content is untrusted data

Una página web puede contener instrucciones maliciosas.

Esas instrucciones no tienen autoridad sobre JARVIS.

---

## 49.4 Schema validation

Ningún argumento se ejecuta sin validación contra el schema real.

---

## 49.5 Policy enforcement

Toda operación pasa por Policy Registry y Guard cuando corresponda.

---

## 49.6 Unknown tools

Nunca se ejecutan.

---

## 49.7 Approval

Siempre explícita.

No reusable automáticamente.

---

# 50. Métricas

## Decision 2.0

Medir:

- routing accuracy;
- tool selection accuracy;
- precisión en español;
- latencia;
- utilización de contexto.

---

## Qwen 9B

Medir:

- argument accuracy;
- schema errors;
- calidad de planes;
- retries;
- calidad de respuesta.

---

## MCP

Medir:

- latencia;
- errores;
- resultados incompletos;
- frecuencia de `UNVERIFIED`.

---

## Core

Medir:

- pasos por tarea;
- llamadas a herramientas;
- loops;
- tareas `PARTIAL`;
- cancelaciones;
- aprobaciones;
- denegaciones;
- retries.

---

# 51. Decisiones cerradas de v1

Las siguientes decisiones forman parte del contrato arquitectónico:

- NORMAL es el modo predeterminado.
- PLAN requiere selección explícita.
- AGENT no pertenece a v1.
- `MAX_STEPS = 15`.
- `MAX_TOOL_CALLS_PER_STEP = 4`.
- `MAX_PLAN_GENERATION_ATTEMPTS = 1`.
- `MAX_ARG_RETRIES = 1`.
- Decision #1 determina `route`, `multi_step` y `needs_context`.
- `needs_reasoning` no forma parte de Decision #1 v1.
- Decision #2 selecciona la herramienta.
- Decision #2 sólo puede seleccionar entre herramientas descubiertas.
- Discovery es la fuente de verdad de herramientas.
- Qwen no selecciona herramientas.
- Qwen no asigna capacidades.
- Policy Registry asigna capacidades.
- Guard controla permisos.
- `APPROVAL` siempre requiere aprobación explícita.
- La aprobación no se reutiliza automáticamente.
- `DENY` no puede evadirse mediante retry.
- `UNVERIFIED` no genera retry automático.
- Las herramientas desconocidas no se ejecutan.
- `Task` mantiene `currentStep`.
- `Task` mantiene `scratchpad`.
- `Step` mantiene `instruction`.
- Scratchpad es pequeño, estructurado y extensible.
- Core decide qué información recibe cada etapa.
- `chat` puede ser un Step.
- `chat` no ejecuta herramientas.
- `chat` puede leer/escribir información permitida en Scratchpad.
- La respuesta final puede producirse mediante un Step `chat`.
- No existen planes recursivos.
- No existen subagentes en v1.
- No existe fast-path obligatorio en v1.
- Cada MCP conserva su propio `ToolResult`.
- `ExecutionOutcome` es información derivada por Core y no reemplaza `ToolResult`.
- `PlanStep` no contiene referencias formales a Scratchpad.
- Decision 2.0 no es redefinido por esta arquitectura.

---

# 52. Arquitectura final

```text
                         ┌──────────────┐
                         │      UI      │
                         └──────┬───────┘
                                │
                                ▼
                         ┌──────────────┐
                         │     CORE     │
                         │              │
                         │ Task/State   │
                         │ Limits       │
                         │ Security     │
                         └──────┬───────┘
                                │
                         ┌──────▼───────┐
                         │ Decision #1  │
                         │ Decision 2.0 │
                         └──────┬───────┘
                                │
                         ┌──────▼───────┐
                         │   Routing    │
                         └──────┬───────┘
                                │
                         ┌──────▼───────┐
                         │  Discovery   │
                         │  tools/list  │
                         └──────┬───────┘
                                │
                         ┌──────▼───────┐
                         │ Decision #2  │
                         │ Tool Select  │
                         └──────┬───────┘
                                │
                    ┌───────────▼───────────┐
                    │         Qwen          │
                    │ Plan / Args / Chat    │
                    └───────────┬───────────┘
                                │
                         ┌──────▼───────┐
                         │    Schema    │
                         │  Validation  │
                         └──────┬───────┘
                                │
                         ┌──────▼───────┐
                         │    Policy    │
                         │   Registry   │
                         └──────┬───────┘
                                │
                         ┌──────▼───────┐
                         │    Guard     │
                         └──────┬───────┘
                                │
                    ┌───────────▼───────────┐
                    │          MCP          │
                    │                       │
                    │ Windows               │
                    │ Desktop Commander     │
                    │ free-search           │
                    └───────────┬───────────┘
                                │
                         MCP-specific
                          ToolResult
                                │
                         ┌──────▼───────┐
                         │    Result    │
                         │  Processor   │
                         └──────┬───────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
              ▼                 ▼                 ▼
         ┌────────┐       ┌───────────┐      ┌────────┐
         │Evidence│       │ Scratchpad│      │ Verify │
         └────┬───┘       └─────┬─────┘      └────┬───┘
              │                 │                  │
              └─────────────────┼──────────────────┘
                                │
                         ┌──────▼───────┐
                         │  Next Step   │
                         │ or Final     │
                         │  Response    │
                         └──────────────┘
```

---

# 53. Responsabilidades finales

| Componente | Responsabilidad |
|---|---|
| **Core** | Control total del flujo, estado, límites y seguridad |
| **Decision 2.0** | Decisiones estructuradas según su especificación oficial |
| **Qwen 9B** | Lenguaje, razonamiento, planes, argumentos y respuestas |
| **Discovery** | Determinar herramientas realmente disponibles |
| **Policy Registry** | Clasificar capacidades |
| **Guard** | Autorizar, denegar o solicitar aprobación |
| **Windows MCP** | Automatización Windows/UI |
| **Desktop Commander** | Procesos, terminal, filesystem y sesiones |
| **free-search-mcp** | Búsqueda y recuperación web |
| **Result Processor** | Transformar ToolResults específicos a información Core |
| **Evidence** | Representar evidencia |
| **Scratchpad** | Mantener estado estructurado temporal |
| **Verify** | Determinar si el resultado está verificado |
| **UI** | Mostrar estado, planes, progreso y solicitudes de aprobación |

---

# 54. Regla de evolución

Cualquier modificación futura debe mantener la separación de responsabilidades.

En particular:

1. No mover autoridad de Core a un modelo.
2. No permitir que Qwen seleccione directamente herramientas.
3. No permitir que resultados externos modifiquen políticas.
4. No convertir MCPs en agentes autónomos.
5. No redefinir contratos oficiales de dependencias externas dentro de este documento.
6. No agregar campos a `PlanStep` sólo para resolver necesidades internas sin actualizar formalmente el contrato.
7. No reemplazar los `ToolResult` específicos de MCP por un contrato universal falso.
8. No permitir retries ilimitados.
9. No convertir `UNVERIFIED` en éxito.
10. No reutilizar aprobaciones de forma implícita.
11. Mantener Discovery como fuente de verdad de herramientas.
12. Mantener Policy Registry como fuente de verdad de capacidades.
13. Mantener Guard como autoridad de autorización.
14. Mantener Decision 2.0 como dependencia cuya especificación oficial vive fuera de JARVIS.

---

# 55. Criterio de completitud de v1

JARVIS v1 se considera arquitectónicamente consistente cuando:

- Core controla todas las transiciones;
- Task conserva `currentStep` y `scratchpad`;
- Step conserva `instruction`;
- Decision #1 utiliza únicamente las decisiones definidas por la integración;
- `needs_reasoning` no forma parte del request real de Decision #1;
- Decision 2.0 no es redefinido por JARVIS;
- Decision #2 sólo recibe herramientas descubiertas;
- Discovery es fuente de verdad;
- Qwen genera argumentos contra schemas reales;
- Policy Registry clasifica herramientas;
- Guard controla autorización;
- `APPROVAL` requiere aprobación explícita;
- `DENY` no puede evadirse;
- MCPs conservan sus propios ToolResults;
- Result Processor transforma esos resultados en estado Core;
- Evidence y Scratchpad permanecen separados de los ToolResults;
- Verify controla `VERIFIED` / `UNVERIFIED`;
- `UNVERIFIED` no genera retry automático;
- existen límites de pasos y llamadas;
- no existen loops infinitos;
- no existen planes recursivos;
- no existen subagentes en v1;
- contenido web y resultados externos se consideran datos no confiables;
- Windows, Desktop Commander y free-search conservan sus semánticas específicas;
- la especificación oficial de Decision 2.0 permanece fuera de este documento.

---

# 56. Resumen normativo

La arquitectura completa puede reducirse a la siguiente regla:

```text
CORE
  controla el sistema.

DECISION 2.0
  decide mediante su contrato oficial.

QWEN
  interpreta, razona, planifica, genera argumentos y responde.

DISCOVERY
  determina qué herramientas existen.

POLICY REGISTRY
  determina qué capacidad tiene cada herramienta.

GUARD
  determina si puede ejecutarse.

MCP
  ejecuta y conserva su propio ToolResult.

RESULT PROCESSOR
  transforma el resultado específico en información utilizable por Core.

EVIDENCE
  representa evidencia.

SCRATCHPAD
  conserva estado estructurado temporal.

VERIFY
  determina si el resultado está confirmado.

CORE
  decide qué ocurre después.
```

**Esta separación constituye el contrato arquitectónico de JARVIS v1.**