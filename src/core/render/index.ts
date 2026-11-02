/**
 * Renderizadores por consumidor (sección 8): toman el objeto estructurado de `ctx.view.<vista>` y arman el texto de
 * los prompts, saneando todo texto externo con `text.ts`. Viven fuera de `ctx/` (principio 5).
 */

export { renderArgs } from "./args.ts";
export type { ArgsRenderOptions } from "./args.ts";
export { ContextOverflowError } from "./errors.ts";
export type { OverflowingView } from "./errors.ts";
export type { Rendered } from "./fit.ts";
export { renderFallback, renderFinal } from "./final.ts";
export type { FallbackRenderOptions, FinalRenderOptions } from "./final.ts";
export { STATE_NOTES, STOP_REASON_NOTES } from "./messages.ts";
export { renderPlan } from "./plan.ts";
export type { PlanRenderOptions } from "./plan.ts";
export { renderRoute } from "./route.ts";
export type { RouteRenderOptions } from "./route.ts";
export { renderVerify } from "./verify.ts";
export type { VerifyRenderOptions } from "./verify.ts";
