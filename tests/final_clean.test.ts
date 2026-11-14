import assert from "node:assert/strict";
import { test } from "node:test";

import { stripNoChangesFiller as strip } from "../src/core/engine/finalClean.ts";

test("stripNoChangesFiller: quita la frase de relleno cuando no hubo cambios", () => {
  assert.equal(strip("Hola. Estoy funcionando correctamente. No se realizaron cambios en el sistema.", "hola jarvis", false), "Hola. Estoy funcionando correctamente.");
  assert.equal(strip("The latest model is GPT-5. No changes were made to the system.", "busca el ultimo modelo de GPT", false), "The latest model is GPT-5.");
  assert.equal(strip("Hay 3 archivos.\nNo se hicieron cambios en el sistema.", "listá los archivos", false), "Hay 3 archivos.");
  assert.equal(strip("Sin cambios en el sistema. La carpeta tiene 4 archivos.", "qué hay en descargas", false), "La carpeta tiene 4 archivos.");
});

test("stripNoChangesFiller: no toca la respuesta si hubo cambios, si el pedido pregunta por cambios o si quedaría vacía", () => {
  const text = "Listo. No se realizaron cambios adicionales.";
  assert.equal(strip(text, "creá una carpeta", true), text, "hubo efectos");
  assert.equal(strip("No se realizaron cambios en el sistema.", "¿se cambió algo en mi PC?", false), "No se realizaron cambios en el sistema.", "el pedido pregunta por cambios");
  assert.equal(strip("No se realizaron cambios en el sistema.", "hola", false), "No se realizaron cambios en el sistema.", "no se deja una respuesta vacía");
  assert.equal(strip("El cambio de hora es mañana.", "cuándo es el próximo feriado", false), "El cambio de hora es mañana.", "una frase que solo menciona un cambio no es el relleno");
});
