# `web_search`: índice de la documentación (2026-11-13)

La tool busca en internet con Free Search (`search` + `fetch` + `read_doc`) y devuelve fragmentos literales con su fuente y un estado; un modelo de decisión (2B) puntúa extractos y fragmentos. Código: `src/tools/web/`. Pruebas: `tests/web_search.test.ts` (74) y `scripts/validate/web_eval/`.

| Documento | Qué contiene |
|---|---|
| [`../JARVIS_1_0_Grupos_y_herramientas_v2.md`](../JARVIS_1_0_Grupos_y_herramientas_v2.md) §6 y D-21 a D-28 | Diseño vigente: argumentos, pipeline, estados, resultado, seguridad, manifiesto |
| [`../../scripts/validate/web_eval/RESULTADOS.md`](../../scripts/validate/web_eval/RESULTADOS.md) | Evaluación con datos reales (41 casos): todas las rondas, tablas y límites |
| [`DEEP_RESEARCH.md`](DEEP_RESEARCH.md) | Idea de un modo «Deep Research» (**en pausa**): pilotos, debilidades frente a búsquedas intensas, qué hacen los grandes, plan y fuentes |
| *(Referencias históricas sin archivo en el repo)* | Documentos externos ya retirados: `REVISION_hallazgos.md`, `free-search-mcp-guia.md` y `../REVISION_web_search.md` |

## Estado de la tool (modo rápido)

- **Medido (Free Search y el 2B reales, 41 casos):** 34 de 36 aciertos, 1 de 5 preguntas sin respuesta contestadas sin base, 0,41 páginas leídas por caso.
- **Decisiones con evidencia:** `search` + una página por vez en lugar de `research`; `terms` eliminado; juez 2B encendido por defecto; `per_source`, `depth` 5 y `compare` descartados.
- **Hecho recientemente:** guarda de versión (un pasaje sin la versión con puntos de la pregunta no basta para `found`) y etiqueta de fecha `dated`; campo `stage`, aviso de página cortada, hasta 6 candidatos por página y lectura del resto de una página cortada con `read_doc` como último recurso.

## Hallazgos abiertos (para cuando se retome)

1. **`found` mide relevancia, no cobertura** (importa también en el modo rápido): con una pregunta de varias partes, un extracto que cubre una faceta basta para declarar `found`. Visto en preguntas sobre PostgreSQL 17 (seguridad y rendimiento), Redis (creador y fecha) y Kubernetes (versión y fin de soporte). Posible arreglo sin modelo generativo: preguntarle al 2B por cada faceta. Detalle en `DEEP_RESEARCH.md` §7 y §9.
2. **Sin selección de fuente autoritativa:** blogs y SEO por delante de la documentación oficial (`fs.cp` → `not_found`). Se puede apoyar en `category`, `include_domains` y `source_type` de Free Search.
3. **Calibración del 2B sin medir:** probabilidades que se saturan y falsos positivos de entidad cercana (`TTL` por `EXPIRE`).
4. **Pendientes de la revisión:** H-21 (un lote fallido del juez descarta los demás; sin fallos en 41 casos), y parciales H-07 y H-10.
5. **Modo Deep Research:** sin implementar. Falta un conjunto de 15 a 20 preguntas de investigación con hechos esperados (`scripts/validate/web_eval/deep_probe.ts` es el punto de partida). Orden propuesto en `DEEP_RESEARCH.md` §10.
6. **`redisttl` y páginas con JavaScript:** `read_doc` falla con `RecursionError` en `redis.io` y algunas páginas llegan vacías (`aistudio.google.com`).
