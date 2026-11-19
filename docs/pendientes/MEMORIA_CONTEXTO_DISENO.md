# Contexto y memoria — Pendientes v2

> **Estado:** la v1 ya está implementada y documentada en [`../arquitectura/CONTEXT_AND_MEMORY.md`](../arquitectura/CONTEXT_AND_MEMORY.md) (el detalle histórico del diseño v1 queda en git). El log de eventos de v1 es aditivo, así que v2 no obliga a migrar. Aquí queda únicamente lo pendiente para v2.

Documentos relacionados: [`../arquitectura/CONTEXT_AND_MEMORY.md`](../arquitectura/CONTEXT_AND_MEMORY.md), [`PENDIENTES_CODIGO.md`](PENDIENTES_CODIGO.md) y [`PENDIENTES_EVAL.md`](PENDIENTES_EVAL.md).

---

## 1. Memoria y hechos

- **CRUD de hechos:** endpoints, pantalla en la UI y comando de Telegram, incluida su convivencia con la edición manual de `data/memory.json`. En el puerto `MemoryProvider` se agregan `list`, `put` y `remove` sin cambiar el core.
- **Captura conversacional:** «Recordá que…» con confirmación explícita del usuario (nunca guardar texto generado por un modelo como hecho sin confirmación).
- **Memoria a largo plazo:** acumulación, propuestas del sistema confirmadas por el usuario, `scope` y compactación (nuevas fuentes entran como filas adicionales en `recalledPolicy.ts`).
- **Decisión de seguridad pendiente (pre-chequeo):** definir si un hecho puede seguir siendo fuente válida del pre-chequeo cuando exista escritura por API local sin autenticación (vuelve a pesar al habilitar el CRUD).

## 2. Ejecución de tareas y continuidad

- **Instrucciones intermedias (`inbox`):** canal explícito para enviar instrucciones a una tarea en curso.
- **Unificación con `inbox`:** decidir si `answer_*` y las instrucciones dadas al rechazar una operación se unifican con el `inbox`.
- **Trabajos en segundo plano:** ejecución en segundo plano con aviso de fin.
- **Interrupción de llamadas en vuelo:** poder cortar una llamada activa sin esperar a que termine.
- **Reanudación tras corte:** decidir si se reanudan las tareas interrumpidas por un reinicio (`restart`) o cerradas por falta de modelos (volver a correrlas sin duplicar efectos).

## 3. Futuro (sin versión asignada)

- **Agentes con contexto propio y en paralelo:** cada agente hijo mantiene su propio contexto; para Jarvis, un agente hijo se modela como una llamada con una única respuesta al terminar.

## 4. Referencias (mediciones y pruebas en curso)

- **Mediciones de v1 que estaban en este documento** (habilitar `recalled` en `forPending`/`forPlan`, re-medir el matching de `src/memory/` y evaluar el orden del prompt): seguimiento en [`PENDIENTES_EVAL.md`](PENDIENTES_EVAL.md), [`../evaluacion/PLAN_DE_MEDICION.md`](../evaluacion/PLAN_DE_MEDICION.md) §5 y [`PENDIENTES_CODIGO.md`](PENDIENTES_CODIGO.md) §2 / §9.3.
- **Opciones en prueba y modo sombra** (`reviewFullView`, `reviewReads`, `completionCoverageGuard`, `PENDING_FACTS_LOOKUP`, `recoveryShadow`): no pertenecen a este diseño; están documentados en [`PENDIENTES_EVAL.md`](PENDIENTES_EVAL.md) (§1–§3), [`PENDIENTES_CODIGO.md`](PENDIENTES_CODIGO.md) (§9.1) y [`../../eval/GUIA_DECISION.md`](../../eval/GUIA_DECISION.md) (§5).

