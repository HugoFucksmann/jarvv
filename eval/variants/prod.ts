/**
 * eval/variants/prod.ts
 *
 * La variante de producción: no define ningún prompt, así que cada etapa usa los de `src/core/models/prompts.ts` tal cual (lo que
 * corre Jarvis). Es la baseline por defecto (`--baseline=prod`). `name` debe coincidir con el nombre del archivo.
 *
 * Una variante propia es otro archivo con prompts ENTEROS y un `mode` declarado (`prompt`: solo textos, comparable contra prod; `structure`: puede
 * cambiar preguntas y opciones, no comparable; ver `eval/REFERENCIA.md` §4): se escribe el texto completo, no ediciones sobre este. Para partir del prompt actual de una etapa: `npm run eval -- --dataset=smoke --ids=<caso> --dry-run`.
 */

import type { Variant } from "../core/variants/types.ts";

const prod: Variant = {
  name: "prod",
  mode: "prompt",
};

export default prod;
