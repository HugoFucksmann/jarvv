/**
 * eval/prompts/variants/prod.ts
 *
 * Variante identidad. No modifica ningún request.
 * Es la baseline por defecto (`--baseline=prod`).
 * Sección 5.3: `name` debe coincidir con el nombre del archivo.
 */

import type { Variant } from "../core/variants/types.ts";

const prod: Variant = {
  name: "prod",
};

export default prod;

