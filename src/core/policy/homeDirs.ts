/**
 * JARVIS Core — Carpetas de inicio con las que las reglas de comando reconocen «borrar la carpeta personal entera».
 *
 * La raíz de composición las fija (`guardScope.homeDirs`, en `engine/services.ts`) y Guard, la lista negra y las reglas de solo lectura las reciben por parámetro.
 * Este valor por omisión (el usuario del sistema) existe solo para quien llama sin alcance (pruebas, scripts): es el único lugar de `policy/` que consulta el sistema.
 */

import os from "node:os";

export const defaultHomeDirs = (): readonly string[] => [os.homedir()];
