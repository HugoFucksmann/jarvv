/**
 * Mide contra el modelo de decisión real si detecta que la primera lista de pendientes NO cubre el pedido (el modelo generativo a veces junta varias partes en un ítem y
 * pierde una: «crea un md y recopila la información» quedó como «crear un md con información», sin buscar nada). Dos preguntas sobre el mismo estado:
 * `covers` (noul: ¿la lista cubre todo lo que pide el pedido?) y `lookup` (noul: ¿algún ítem busca información?), más `asks` sobre el pedido (¿pide buscar información?).
 *
 *   npx tsx scripts/validate/probe_coverage.ts
 */

import { ConfigManager } from "../../src/core/config.ts";
import { Decision20Engine } from "../../src/core/models/decision.ts";

const engine = new Decision20Engine(() => ConfigManager.getConfig());
const U = "quiero organizar un viaje a ushuaia. yo estoy en santa fe. crea un md dentro de la carpeta jarvis del escritorio y recopila toda la informacion para el viaje.";
const cases = [
  { name: "Ushuaia: lista de 1 ítem (la corrida rara)", want: "NO cubre", request: U, list: ["Crear archivo markdown en la carpeta 'jarvis' del escritorio con información sobre el viaje a Ushuaía desde Santa Fe"] },
  { name: "Ushuaia: lista de 5 ítems", want: "cubre", request: U, list: ["Crear archivo markdown en la carpeta jarvis con el título 'Viaje a Ushuaia'", "Recopilar información sobre vuelos desde Santa Fe a Ushuaia", "Recopilar información sobre hoteles en Ushuaia", "Recopilar información sobre actividades turísticas en Ushuaia", "Recopilar información sobre transporte local en Ushuaia"] },
  { name: "Buenos Aires: lista de 4 ítems", want: "cubre", request: "Quiero organizar un viaje a la provincia de buenos aires. Recopila información de hospedaje, pasajes, lugares para recorrer y guárdalo en un md en la carpeta jarvis del escritorio.", list: ["Recopilar información de hospedaje en Buenos Aires", "Recopilar información de pasajes hacia Buenos Aires", "Recopilar información de lugares turísticos en Buenos Aires", "Crear archivo markdown en la carpeta jarvis del escritorio con la información recopilada"] },
  { name: "Gemini/GPT: solo guarda, sin buscar", want: "NO cubre", request: "busca el ultimo modelo de gemini y gpt. guarda en un md dentro de la carpeta jarvis del escritorio la informacion completa", list: ["Guardar un archivo markdown en la carpeta jarvis del escritorio con la información de los últimos modelos de Gemini y GPT"] },
  { name: "Gemini/GPT: lista completa", want: "cubre", request: "busca el ultimo modelo de gemini y gpt. guarda en un md dentro de la carpeta jarvis del escritorio la informacion completa", list: ["Obtener información sobre el último modelo de Gemini", "Obtener información sobre el último modelo de GPT", "Guardar la información recopilada en un archivo markdown dentro de la carpeta jarvis del escritorio"] },
  { name: "Pedido simple, lista de 1 ítem", want: "cubre", request: "lista los archivos de mi escritorio", list: ["Listar los archivos del escritorio"] },
  { name: "Pedido simple de crear, 1 ítem", want: "cubre", request: "crea una carpeta llamada fotos en documentos", list: ["Crear la carpeta fotos dentro de Documentos"] },
];
for (const c of cases) {
  const state = `REQUEST: ${c.request}\n\nTO-DO LIST:\n${c.list.map((l, i) => `${i + 1}. ${l}`).join("\n")}`;
  const r = await engine.systemOne(state, {
    covers: { type: "noul", instructions: "Does the TO-DO LIST cover every thing that the REQUEST asks to do?", criteria: { true: "Each action the request asks for (looking something up, creating, saving, moving, running) has an item in the list.", false: "The request asks for something (such as looking up or collecting information) that no item of the list does." } },
    lookup: { type: "noul", instructions: "Does any item of the TO-DO LIST look up or collect information (on the web or on the computer)?", criteria: { true: "At least one item is about finding, searching or collecting information.", false: "No item looks anything up: they only create, write, move or run." } },
    asks: { type: "noul", instructions: "Does the REQUEST ask to look up or collect information (on the web or on the computer)?", criteria: { true: "The request asks to find, search or collect information.", false: "The request asks only to create, write, move or run something, or to list something that is already there." } },
  });
  const a = r.answers as Record<string, { noul: number }>;
  console.log(`${c.name.padEnd(46)} quiero: ${c.want.padEnd(9)} covers=${a.covers.noul.toFixed(2)} lookup=${a.lookup.noul.toFixed(2)} asks=${a.asks.noul.toFixed(2)}`);
}
