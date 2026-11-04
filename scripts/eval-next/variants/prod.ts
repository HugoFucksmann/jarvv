/**
 * scripts/eval-next/variants/prod.ts
 *
 * Variante por defecto "prod": utiliza los prompts y configuraciones oficiales
 * de producción sin sobreescrituras.
 */

import type { PromptVariant } from "../core/types.ts";

export const variant: PromptVariant = {
  name: "prod",
};

export default variant;

