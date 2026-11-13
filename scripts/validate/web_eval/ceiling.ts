/** ¿Dónde está la respuesta en lo que trae el MCP: en los extractos, en el cuerpo de las páginas, o en los dos? (necesita las capturas) */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CASES } from "./cases.ts";
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "captures");
for (const k of ["need3", "need5"]) {
  let s = 0, d = 0, both = 0, none = 0, n = 0;
  const only: string[] = [];
  for (const c of CASES) {
    if (!c.gold) continue;
    const raw = JSON.parse(JSON.parse(fs.readFileSync(path.join(dir, `${c.id}.${k}.json`), "utf8")).text);
    const inS = c.gold.test(raw.sources.map((x: any) => `${x.title} ${x.snippet} ${x.published_age}`).join("\n"));
    const inD = c.gold.test((raw.documents ?? []).map((x: any) => x.content).join("\n"));
    n++; if (inS && inD) both++; else if (inS) { s++; only.push(`${c.id}:solo extracto`); } else if (inD) { d++; only.push(`${c.id}:solo página`); } else none++;
  }
  console.log(`${k}: casos ${n} | en extracto y página ${both} | solo extracto ${s} | solo página ${d} | en ninguno ${none}  ${only.join(" ")}`);
}
