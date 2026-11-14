// Informe de eval/exp/question_sets_d4.ts: uso `node eval/exp/question_sets_report.cjs <salida.json>`.
const rows = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
for (const r of rows) if (r.a.ok === undefined) r.a.ok = 1;
const gw = { ok: true, cumple: true, answered: true, error: false, other: false, missing: false };
const g = (r, k) => (gw[k] ? r.a[k] : 1 - r.a[k]);
const lab = (r) => r.ok && r.cumple;
const sets = {
  "prod: ok + cumple": ["ok", "cumple"], "solo cumple": ["cumple"],
  "error + cumple (ok reformulado)": ["error", "cumple"],
  "ok + cumple + error": ["ok", "cumple", "error"], "ok + cumple + answered": ["ok", "cumple", "answered"], "ok + cumple + missing": ["ok", "cumple", "missing"], "ok + cumple + other": ["ok", "cumple", "other"],
  "error + cumple + missing": ["error", "cumple", "missing"], "error + cumple + other": ["error", "cumple", "other"], "error + cumple + answered": ["error", "cumple", "answered"],
  "error + cumple + missing + other": ["error", "cumple", "missing", "other"],
  "las 6": ["ok", "cumple", "error", "answered", "other", "missing"],
};
const pos = rows.filter(lab).length, neg = rows.length - pos;
console.log(`n=${rows.length} aprobar=${pos} rechazar=${neg}`);
const line = (name, f) => { let fp = 0, fn = 0; for (const r of rows) { const ap = f(r); if (ap && !lab(r)) fp++; if (!ap && lab(r)) fn++; } console.log(`${name.padEnd(36)} FP ${String(fp).padStart(2)}/${neg}  FN ${String(fn).padStart(2)}/${pos}  aciertos ${rows.length - fp - fn}/${rows.length} (${((rows.length - fp - fn) / rows.length * 100).toFixed(1)}%)`); };
for (const [name, keys] of Object.entries(sets)) line(name, (r) => keys.every((k) => g(r, k) >= 0.6));
console.log("--- promedio de probabilidades de «bien» (en lugar de exigir todas) a distintos umbrales");
for (const [name, keys] of [["prod", sets["prod: ok + cumple"]], ["error+cumple+missing+other", sets["error + cumple + missing + other"]], ["las 6", sets["las 6"]]]) for (const t of [0.5, 0.6, 0.7, 0.8]) line(`media ${name} ≥ ${t}`, (r) => keys.reduce((a, k) => a + g(r, k), 0) / keys.length >= t);
console.log("--- mínimo de las preguntas ≥ t");
for (const [name, keys] of [["prod", sets["prod: ok + cumple"]], ["error+cumple+missing+other", sets["error + cumple + missing + other"]]]) for (const t of [0.5, 0.7, 0.8, 0.9]) line(`mínimo ${name} ≥ ${t}`, (r) => Math.min(...keys.map((k) => g(r, k))) >= t);
console.log("--- tres zonas: aprobar si todas ≥ 0,6; rechazar si alguna < 0,4; dudar en el medio (cuántos casos caen en la duda y cuántos son errores de la regla binaria)");
for (const [name, keys] of [["prod", sets["prod: ok + cumple"]], ["error+cumple+missing+other", sets["error + cumple + missing + other"]]]) {
  let doubt = 0, doubtLabelPos = 0, appr = 0, apprWrong = 0, rej = 0, rejWrong = 0;
  for (const r of rows) { const v = keys.map((k) => g(r, k)); const mn = Math.min(...v); if (mn >= 0.6) { appr++; if (!lab(r)) apprWrong++; } else if (mn < 0.4) { rej++; if (lab(r)) rejWrong++; } else { doubt++; if (lab(r)) doubtLabelPos++; } }
  console.log(`${name.padEnd(30)} aprueba ${appr} (mal ${apprWrong}) | rechaza ${rej} (mal ${rejWrong}) | duda ${doubt} (de ellos ${doubtLabelPos} eran «aprobar»)`);
}
