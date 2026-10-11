# Inconsistencias detectadas

> Última revisión: **[COMPLETAR: AAAA-MM-DD]**

> Archivo de trabajo. Registra hallazgos confirmados en el código durante la documentación. Solo hechos con evidencia, sin propuestas de refactor. Se puede convertir en issues o borrar al terminar.

## Tipos

`SIN_REFERENCIAS` · `DUPLICACIÓN` · `NOMBRE_VS_COMPORTAMIENTO` · `CONTRADICCIÓN` · `SEGURIDAD`

## Severidad

**Alta:** riesgo de seguridad o comportamiento incorrecto · **Media:** confunde o duplica lógica · **Baja:** orden o nomenclatura

## Hallazgos

> **[COMPLETAR]** Una fila por hallazgo, con ubicación exacta (ruta y símbolo).

| # | Tipo | Severidad | Ubicación | Hallazgo | Impacto | Estado |
|---|------|-----------|-----------|----------|---------|--------|
| 1 | *Ej: SIN_REFERENCIAS* | *Baja* | `src/core/x.ts` → `fnY` | *No se importa en ningún archivo* | *Posible código muerto* | Abierto |
| 2 | *Ej: SEGURIDAD* | *Alta* | `src/core/callExecutor.ts` → `run()` | *Una tool de escritura se ejecuta sin pasar por `guard`* | *Omite aprobación del usuario* | Abierto |

## Resumen priorizado

> **[COMPLETAR]** Se llena en la pasada final: los hallazgos de severidad Alta y Media, ordenados por impacto.

1. *Ej: #2 — tool sin aprobación (Alta)*