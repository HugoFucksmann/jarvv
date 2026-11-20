# Conclusiones — d0

## Estado actual (auto-actualizado)
- Objetivo: >= 90.0% (`passRate`) · Modelo evaluado: `decisión: d3:2b-text`
- Top 1: `d0_r1_action_axes` (92.6%, p50 123ms) — **Estable**
- Top 2: `auto_d0_20261119_224745_cs10_r2_a` (93.5% dev / 85.4% holdout) — **Sobreajuste crítico**
- Baseline `prod`: 88.0%

## Reglas confirmadas (qué ayuda)
- Definir criterios de clasificación binaria estrictos y excluyentes.
- Priorizar la distinción clara entre 'tarea' y 'charla'.
- Evitar ambigüedades en la definición de lo que constituye una tarea válida.

## Descartadas (qué empeora — no repetir)
- Refinar criterios de chat para ser más estrictos sin claridad absoluta (causó sobreajuste R2).
- Reordenar estructura del prompt para enfatizar 'no-hacer' (R2_b: 88.9%, regresión vs baseline).

## Últimas rondas (máx. 5)
- **R2**: `auto_d0_...r2_a` → 93.5% dev / 85.4% holdout. **Fallo objetivo**. Hipótesis: Criterios demasiado ajustados a datos de entrenamiento.
- **R1**: `d0_r1_action_axes` → 92.6% (dev/holdout). **Éxito**. Generalización robusta.
- **R1 (prev)**: `auto_d0_...r1_a` → 92.6%. Estable pero inferior a R1 actual en velocidad.
- **R2_b**: `auto_d0_...r2_b` → 88.9%. Regresión respecto baseline.
- **Baseline**: `prod` → 88.0%.
- [Alerta holdout] R2: `auto_d0_20261119_224745_cs10_r2_a` alcanzó 93.5% en dev pero cayó a 85.4% en holdout (target 90.0%) — posible sobreajuste, continuar generalizando.
- [Alerta holdout] R3: `auto_d0_20261119_224745_cs10_r2_a` alcanzó 93.5% en dev pero cayó a 85.4% en holdout (target 90.0%) — posible sobreajuste, continuar generalizando.
