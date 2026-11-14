import { PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * Variante de contexto (DN-2.10, parte del relleno): la respuesta final no abre con «No changes were made to the system».
 * Causa: la regla «Clearly report any changes … or specify that no changes were made». Se reemplaza por «informá los cambios solo si los hubo».
 * La línea `EFFECTS: none` de la vista se conserva: es lo que impide que el modelo cuente como hecho lo que no se hizo.
 */
const OLD = "- Clearly report any changes made to the system (EFFECTS) or specify that no changes were made.";
const NEW = "- Report the changes made to the system (EFFECTS) only when there were some. When EFFECTS is none, do not mention changes at all unless REQUEST asks whether anything changed.";

const SYSTEM = PROMPTS.FINAL_VIEW.SYSTEM.replace(OLD, NEW);
if (SYSTEM === PROMPTS.FINAL_VIEW.SYSTEM) throw new Error("ctx_final_nofiller: el texto de prod cambió y el reemplazo no aplicó.");

const ctx_final_nofiller: Variant = {
  name: "ctx_final_nofiller",
  prompts: { PROMPTS: { FINAL_VIEW: { ...PROMPTS.FINAL_VIEW, SYSTEM } } },
};

export default ctx_final_nofiller;
