/** Tipos de interfaz compartidos por el hook y los componentes. */

import type { ExecutionMode } from "./api.ts";

export type { ExecutionMode };

export type McpInitStatus = "loading" | "ready" | "partial" | "error";

/**
 * Resultado de una acción contra el back que dispara un formulario de la UI.
 * `false` = el back la rechazó (p. ej. 409): el formulario conserva lo escrito en lugar de cerrarse.
 */
export type ActionResult = void | boolean | Promise<void | boolean>;
