/**
 * Renderizadores por consumidor (sección 8): toman el objeto estructurado de `ctx.view.<vista>` y arman el texto de
 * los prompts, saneando todo texto externo con `text.ts`. Viven fuera de `ctx/` (principio 5). `forRoute`, `forReview` y
 * `forVerify` no se renderizan: los consumen los adaptadores de Decisión (`engine/adapters.ts`).
 */

export { renderArgs } from "./args.ts";
export type { ArgsRenderOptions } from "./args.ts";
export { renderAsk } from "./ask.ts";
export type { AskRenderOptions } from "./ask.ts";
export { ContextOverflowError } from "./errors.ts";
export type { OverflowingView } from "./errors.ts";
export { renderFallback, renderFinal } from "./final.ts";
export type { FinalRenderOptions } from "./final.ts";
export { renderPlan } from "./plan.ts";
export type { PlanRenderOptions } from "./plan.ts";
export type { Rendered, ViewCaps } from "./shared.ts";