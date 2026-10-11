# Contexto y memoria

> Última revisión: **[COMPLETAR: AAAA-MM-DD]**

> **[COMPLETAR]** Resumen: qué información recibe el modelo y de dónde sale.

## Construcción del contexto

> **[COMPLETAR]** Orden y fuentes de cada bloque que compone la petición al modelo.

| Orden | Bloque | Fuente | Ejemplo |
|-------|--------|--------|---------|
| 1 | *System prompt* | `prompts/system.md` | *Rol e instrucciones base* |
| 2 | *Definición de tools* | *Registro de tools* | *Nombre, descripción, schema* |
| 3 | *Memoria* | *Memory store* | *Preferencias del usuario* |
| 4 | *Historial* | *Sesión actual* | *Últimos N mensajes* |
| 5 | *Evidencias* | *Resultados de tools* | *Contenido de archivos leídos* |
| 6 | *Instrucción actual* | *Usuario* | — |

## Prompts

> **[COMPLETAR]** Prompts existentes, ubicación y propósito.

| Prompt | Ruta | Propósito |
|--------|------|-----------|
| *Ej: system* | `prompts/system.md` | *Define rol y reglas* |

## Historial

> **[COMPLETAR]** Cómo se guarda, cuánto se conserva y cómo se recorta.

- **Almacenamiento:** *Ej: SQLite, tabla `messages`*
- **Estrategia de recorte:** *Ej: últimos 20 mensajes + resumen del resto*

## Memoria

> **[COMPLETAR]** Tipos de memoria, qué se guarda y cuándo se lee/escribe.

| Tipo | Qué guarda | Persistencia | Ejemplo |
|------|-----------|--------------|---------|
| *Corto plazo* | *Estado de la sesión* | *Sesión* | *Tarea en curso* |
| *Largo plazo* | *Hechos y preferencias* | *Permanente* | *"Prefiere respuestas breves"* |

## Evidencias

> **[COMPLETAR]** Cómo se incorporan y etiquetan los resultados de tools en el contexto.

- *Ej: cada evidencia lleva fuente, timestamp y se trunca a X tokens.*

## Datos enviados a los modelos

> **[COMPLETAR]** Qué sale hacia el proveedor, qué se filtra y qué nunca se envía.

| Se envía | Se filtra / nunca se envía |
|----------|---------------------------|
| *Ej: prompt, historial, evidencias* | *Ej: API keys, contraseñas, rutas privadas* |

## Límites y presupuesto de tokens

> **[COMPLETAR]** Límites por bloque y qué se descarta primero.

- *Ej: Historial máx. 8k tokens; evidencias máx. 4k; se descarta primero lo más antiguo.*

## Archivos relacionados

> **[COMPLETAR]** Solo los 5-8 archivos clave (entry points, interfaces, config).

| Ruta | Rol |
|------|-----|
| *Ej: `src/context/builder.ts`* | *Armado del contexto* |
| *Ej: `src/memory/store.ts`* | *Persistencia de memoria* |
| *Ej: `prompts/system.md`* | *System prompt* |