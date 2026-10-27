#!/usr/bin/env python3
"""
Compara corridas del eval de LLM (runs.jsonl + scores.json) para decidir qué versión de prompt rinde mejor.

Cada argumento es una versión de prompt a comparar:
    LABEL=RUTA[,RUTA...]   varias rutas con el mismo LABEL se agrupan como repeticiones de esa versión
    RUTA                   el LABEL es el nombre de la carpeta
RUTA es la carpeta de la corrida o su ruta relativa a --root (modelo/fecha_tag).

Ejemplos:
    python scripts/eval/llm/compare.py qwen3.5_4b/2026-10-27_v1 qwen3.5_4b/2026-10-27_v2
    python scripts/eval/llm/compare.py v1=qwen3.5_4b/2026-10-27_v1a,qwen3.5_4b/2026-10-27_v1b v2=qwen3.5_4b/2026-10-27_v2 --out cmp.md

Solo usa la biblioteca estándar. La primera versión es la base de comparación (--baseline para cambiarla).
"""

from __future__ import annotations

import argparse
import json
import math
import re
import statistics
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

DEFAULT_ROOT = Path("scripts/results/llm")
FALLBACK_ROOT = Path("scripts/results/qwen_eval")
STAGE_ORDER = ["plan", "replan", "arguments", "final_response"]
SETTING_KEYS = ["model", "num_ctx", "timeout_ms", "thinking_timeout_ms", "max_tokens", "final_thinking"]
ALPHA = 0.05

Key = tuple  # (case_id, thinking)
LEVEL_ORDER = ["easy", "med", "hard"]
LEVEL_RE = re.compile(r"-(easy|med|hard)-")


@dataclass
class Run:
    label: str
    dirs: list[Path]
    records: list[dict]
    settings: list[dict]


# ------------------------------------------------------------
# Carga
# ------------------------------------------------------------

def resolve_dir(spec: str, root: Path) -> Path:
    candidates = [Path(spec), root / spec]
    if root == DEFAULT_ROOT:
        candidates.append(FALLBACK_ROOT / spec)
    for cand in candidates:
        if (cand / "runs.jsonl").is_file():
            return cand
    sys.exit(f"No se encontró runs.jsonl en '{spec}' ni en '{root / spec}'.")


def load_records(path: Path) -> tuple[list[dict], int]:
    records: list[dict] = []
    bad = 0
    for line in (path / "runs.jsonl").read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            bad += 1
            continue
        if isinstance(rec, dict) and rec.get("case_id") and rec.get("stage") and rec.get("status"):
            records.append(rec)
        else:
            bad += 1
    return records, bad


def load_settings(path: Path) -> dict:
    f = path / "scores.json"
    if not f.is_file():
        return {}
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    settings = data.get("settings") if isinstance(data, dict) else None
    return settings if isinstance(settings, dict) else {}


def parse_group(arg: str, root: Path, warnings: list[str]) -> Run:
    label, paths = arg.split("=", 1) if "=" in arg else (None, arg)
    dirs = [resolve_dir(p.strip(), root) for p in paths.split(",") if p.strip()]
    if not dirs:
        sys.exit(f"Argumento sin rutas: '{arg}'")
    records: list[dict] = []
    for d in dirs:
        recs, bad = load_records(d)
        if bad:
            warnings.append(f"{d}: {bad} líneas de runs.jsonl inválidas o incompletas, ignoradas.")
        records.extend(recs)
    return Run(label or dirs[0].name, dirs, records, [load_settings(d) for d in dirs])


# ------------------------------------------------------------
# Estadística
# ------------------------------------------------------------

def sign_test_p(wins: int, losses: int) -> float:
    """Prueba de signos exacta, dos colas, sobre casos que cambian de resultado."""
    n = wins + losses
    if n == 0:
        return 1.0
    k = min(wins, losses)
    tail = sum(math.comb(n, i) for i in range(k + 1)) / 2**n
    return min(1.0, 2 * tail)


def summarize(recs: list[dict]) -> dict:
    ok = [r for r in recs if r.get("status") != "error"]
    lat = [r["latency_ms"] for r in ok if isinstance(r.get("latency_ms"), (int, float))]
    tok = [r["completion_tokens"] for r in ok if isinstance(r.get("completion_tokens"), (int, float))]
    passed = sum(1 for r in recs if r.get("status") == "pass")
    n = len(recs)
    return {
        "n": n,
        "passed": passed,
        "errors": sum(1 for r in recs if r.get("status") == "error"),
        "truncated": sum(1 for r in ok if r.get("finish_reason") == "length"),
        "rate": passed / n if n else None,
        "lat_median": statistics.median(lat) if lat else None,
        "lat_mean": statistics.fmean(lat) if lat else None,
        "tok_mean": statistics.fmean(tok) if tok else None,
    }


def metric_counts(recs: list[dict]) -> dict[str, list[int]]:
    counts: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for r in recs:
        for name, value in (r.get("metrics") or {}).items():
            if isinstance(value, bool):
                counts[name][1] += 1
                counts[name][0] += int(value)
    return counts


def normalize_error(msg: str) -> str:
    return re.sub(r"\d+", "N", str(msg)).strip()[:160]


# ------------------------------------------------------------
# Formato
# ------------------------------------------------------------

def pct(x: float | None) -> str:
    return "n/d" if x is None else f"{x * 100:.1f}%"


def num(x: float | None, suffix: str = "") -> str:
    return "n/d" if x is None else f"{x:,.0f}{suffix}"


def delta_pp(a: float | None, b: float | None) -> str:
    if a is None or b is None:
        return ""
    d = (a - b) * 100
    return f" ({d:+.1f}pp)" if abs(d) >= 0.05 else ""


def cell(v: object) -> str:
    return str(v).replace("|", "\\|").replace("\n", " ")


def md_table(headers: list[str], rows: list[list[object]]) -> str:
    out = ["| " + " | ".join(cell(h) for h in headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    out += ["| " + " | ".join(cell(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def thinking_label(t: object) -> str:
    return "on" if t is True else "off" if t is False else "-"


# ------------------------------------------------------------
# Comparación
# ------------------------------------------------------------

def rec_key(r: dict) -> Key:
    return (r["case_id"], r.get("thinking"))


def level_of(case_id: str) -> str:
    """Nivel de dificultad tomado del id del caso (qwen-<etapa>-<easy|med|hard>-NN-...)."""
    m = LEVEL_RE.search(case_id)
    return m.group(1) if m else "sin nivel"


def stage_rank(stage: str) -> int:
    return STAGE_ORDER.index(stage) if stage in STAGE_ORDER else len(STAGE_ORDER)


def select_keys(runs: list[Run], all_cases: bool, warnings: list[str]) -> set[Key]:
    keys_by_run = [{rec_key(r) for r in run.records} for run in runs]
    union = set().union(*keys_by_run)
    keys = union if all_cases else set.intersection(*keys_by_run)

    if not all_cases and len(keys) < len(union):
        missing = sorted(union - keys)
        warnings.append(
            f"{len(missing)} casos no están en todas las corridas y se excluyeron: "
            + ", ".join(f"{c}[{thinking_label(t)}]" for c, t in missing[:10])
            + (" ..." if len(missing) > 10 else "")
            + " (usar --all-cases para incluirlos)."
        )

    hashes: dict[Key, set[str]] = defaultdict(set)
    for run in runs:
        for r in run.records:
            if r.get("case_hash"):
                hashes[rec_key(r)].add(r["case_hash"])
    changed = {k for k, h in hashes.items() if len(h) > 1 and k in keys}
    if changed:
        keys -= changed
        warnings.append(
            f"{len(changed)} casos cambiaron de definición entre corridas (case_hash distinto) y se excluyeron: "
            + ", ".join(f"{c}[{thinking_label(t)}]" for c, t in sorted(changed)[:10])
        )
    return keys


def check_settings(runs: list[Run], warnings: list[str]) -> None:
    for run in runs:
        for key in SETTING_KEYS:
            vals = {json.dumps(s.get(key), sort_keys=True) for s in run.settings if s}
            if len(vals) > 1:
                warnings.append(f"'{run.label}': repeticiones con '{key}' distinto ({', '.join(sorted(vals))}).")
    for key in SETTING_KEYS:
        per_label = {
            run.label: json.dumps(run.settings[0].get(key), sort_keys=True)
            for run in runs
            if run.settings and run.settings[0]
        }
        if len(set(per_label.values())) > 1:
            detail = "; ".join(f"{lbl}={v}" for lbl, v in per_label.items())
            warnings.append(f"Settings distintos entre versiones en '{key}': {detail}. La comparación no es de prompts únicamente.")
    if any(not (run.settings and run.settings[0]) for run in runs):
        warnings.append("Alguna corrida no tiene settings en scores.json (formato anterior): no se pudo verificar que los parámetros coincidan.")


def case_scores(recs: list[dict]) -> dict[Key, dict]:
    out: dict[Key, dict] = {}
    for r in recs:
        s = out.setdefault(rec_key(r), {"passes": 0, "total": 0, "statuses": [], "stage": r["stage"]})
        s["total"] += 1
        s["passes"] += int(r["status"] == "pass")
        s["statuses"].append(r["status"])
    return out


def case_rate(s: dict | None) -> float | None:
    return None if not s or not s["total"] else s["passes"] / s["total"]


def pair_compare(a_scores: dict[Key, dict], b_scores: dict[Key, dict], keys: set[Key]) -> dict:
    """b contra a (a = base). Gana b si su tasa de acierto por caso es mayor."""
    wins, losses, ties = [], [], []
    for k in keys:
        ra, rb = case_rate(a_scores.get(k)), case_rate(b_scores.get(k))
        if ra is None or rb is None:
            continue
        (wins if rb > ra else losses if rb < ra else ties).append(k)
    return {
        "wins": sorted(wins),
        "losses": sorted(losses),
        "ties": len(ties),
        "p": sign_test_p(len(wins), len(losses)),
    }


def case_cell(s: dict | None) -> str:
    if not s:
        return "-"
    if s["total"] == 1:
        return {"pass": "PASS", "fail": "FAIL", "error": "ERR"}.get(s["statuses"][0], s["statuses"][0])
    return f"{s['passes']}/{s['total']}"


def fmt_keys(keys: list[Key], limit: int = 6) -> str:
    names = [f"{c}[{thinking_label(t)}]" if t is not None else c for c, t in keys[:limit]]
    return ", ".join(names) + (f" (+{len(keys) - limit})" if len(keys) > limit else "")


def verdict(a: str, b: str, cmp: dict) -> str:
    w, l = len(cmp["wins"]), len(cmp["losses"])
    n = w + l
    if n == 0:
        return f"sin diferencias por caso entre '{a}' y '{b}'"
    better = b if w > l else a if l > w else None
    if better is None:
        return f"empate ({w} mejoras, {l} regresiones)"
    sig = cmp["p"] < ALPHA
    base = f"'{better}' gana en {max(w, l)} de {n} casos que cambian (p={cmp['p']:.3f})"
    return base + ("; diferencia distinguible del azar" if sig else f"; NO concluyente con n={n} (p>={ALPHA})")


# ------------------------------------------------------------
# Reporte
# ------------------------------------------------------------

def build_report(runs: list[Run], baseline: str, stages: list[str], keys: set[Key], warnings: list[str], all_rows: bool):
    labels = [r.label for r in runs]
    base = next(r for r in runs if r.label == baseline)
    recs_by = {r.label: [x for x in r.records if rec_key(x) in keys and x["stage"] in stages] for r in runs}
    scores_by = {lbl: case_scores(recs) for lbl, recs in recs_by.items()}
    present_stages = [s for s in STAGE_ORDER + sorted({x["stage"] for x in recs_by[base.label]} - set(STAGE_ORDER))
                      if any(x["stage"] == s for recs in recs_by.values() for x in recs)]

    summary: dict = {"generated": datetime.now().isoformat(timespec="seconds"), "baseline": baseline, "labels": {}}
    L: list[str] = []

    # ---- Resumen general
    overall: dict[str, dict] = {}
    for lbl in labels:
        recs = recs_by[lbl]
        total = summarize(recs)
        stage_rates = [summarize([x for x in recs if x["stage"] == s])["rate"] for s in present_stages]
        stage_rates = [r for r in stage_rates if r is not None]
        total["macro"] = statistics.fmean(stage_rates) if stage_rates else None
        overall[lbl] = total
        summary["labels"][lbl] = {"overall": total, "stages": {}}

    ranking = sorted(labels, key=lambda l: (-(overall[l]["macro"] or 0), -(overall[l]["rate"] or 0), overall[l]["lat_median"] or math.inf))

    L.append("# Comparación de prompts — Qwen eval")
    L.append(f"Generado: {summary['generated']} | Base: **{baseline}** | Casos comparados: {len(keys)}")
    L.append("")
    L.append("## 1. Corridas")
    L.append(md_table(
        ["versión", "carpetas", "ejecuciones", "modelo", "contexto", "max_tokens"],
        [[
            r.label,
            ", ".join(d.name for d in r.dirs),
            len(recs_by[r.label]),
            (r.settings[0].get("model") if r.settings and r.settings[0] else "n/d"),
            (r.settings[0].get("num_ctx") if r.settings and r.settings[0] else "n/d"),
            json.dumps(r.settings[0].get("max_tokens")) if r.settings and r.settings[0] and r.settings[0].get("max_tokens") else "n/d",
        ] for r in runs],
    ))
    L.append("")

    L.append("## 2. Resumen general")
    L.append("`macro` promedia la tasa de cada etapa (todas pesan igual); `micro` cuenta todas las ejecuciones.")
    L.append("")
    L.append(md_table(
        ["versión", "macro", "micro", "pass/total", "errores", "truncadas", "lat mediana", "tokens out prom."],
        [[
            lbl + (" (base)" if lbl == baseline else ""),
            pct(overall[lbl]["macro"]) + (delta_pp(overall[lbl]["macro"], overall[baseline]["macro"]) if lbl != baseline else ""),
            pct(overall[lbl]["rate"]),
            f"{overall[lbl]['passed']}/{overall[lbl]['n']}",
            overall[lbl]["errors"],
            overall[lbl]["truncated"],
            num(overall[lbl]["lat_median"], " ms"),
            num(overall[lbl]["tok_mean"]),
        ] for lbl in ranking],
    ))
    L.append("")

    if len(ranking) >= 2:
        top, second = ranking[0], ranking[1]
        cmp_top = pair_compare(scores_by[second], scores_by[top], keys)
        L.append(f"**Mejor por macro:** {top}. Por casos que cambian: {verdict(second, top, cmp_top)}.")
        L.append("")
    summary["ranking"] = ranking

    # ---- Por etapa
    L.append("## 3. Por etapa")
    for stage in present_stages:
        rows = []
        stage_summ = {lbl: summarize([x for x in recs_by[lbl] if x["stage"] == stage]) for lbl in labels}
        for lbl in labels:
            recs = [x for x in recs_by[lbl] if x["stage"] == stage]
            s = stage_summ[lbl]
            summary["labels"][lbl]["stages"][stage] = s
            hashes = sorted({x["system_hash"] for x in recs if x.get("system_hash")})
            raw = sum(1 for x in recs if x.get("prompt_source") == "raw")
            rows.append([
                lbl + (" (base)" if lbl == baseline else ""),
                f"{s['passed']}/{s['n']}",
                pct(s["rate"]) + (delta_pp(s["rate"], stage_summ.get(baseline, {}).get("rate")) if lbl != baseline and baseline in stage_summ else ""),
                s["errors"],
                s["truncated"],
                num(s["lat_median"], " ms"),
                num(s["tok_mean"]),
                ", ".join(hashes) if hashes else "n/d",
                f"{raw}/{s['n']}" if raw else "0",
            ])
        L.append(f"### {stage}")
        L.append(md_table(["versión", "pass/total", "tasa", "errores", "truncadas", "lat mediana", "tokens out", "system hash", "prompt a mano"], rows))
        rates = {l: s["rate"] for l, s in stage_summ.items() if s["rate"] is not None}
        if rates:
            best = max(rates.values())
            winners = [l for l, r in rates.items() if r == best]
            L.append("")
            L.append("Mejor: " + (f"empate entre {', '.join(winners)}" if len(winners) > 1 else f"**{winners[0]}**") + f" ({pct(best)})")
        hset = {tuple(sorted({x['system_hash'] for x in recs_by[l] if x['stage'] == stage and x.get('system_hash')})) for l in labels}
        if len(hset) == 1 and () not in hset and len(labels) > 1:
            L.append("Nota: el system prompt es idéntico en todas las versiones; las diferencias vienen del user prompt o del azar.")
        L.append("")

    # ---- Por dificultad
    levels = [lv for lv in LEVEL_ORDER if any(level_of(x["case_id"]) == lv for recs in recs_by.values() for x in recs)]
    if levels:
        if any(level_of(x["case_id"]) == "sin nivel" for recs in recs_by.values() for x in recs):
            levels.append("sin nivel")
        rows = []
        for lv in levels:
            row: list[object] = [lv]
            for lbl in labels:
                s = summarize([x for x in recs_by[lbl] if level_of(x["case_id"]) == lv])
                row.append(f"{s['passed']}/{s['n']} ({pct(s['rate'])})" if s["n"] else "-")
            rows.append(row)
        L.append("## 3b. Por dificultad")
        L.append(md_table(["nivel"] + labels, rows))
        L.append("")

    # ---- Métricas
    L.append("## 4. Checks por etapa (solo los que no están al 100% en alguna versión)")
    for stage in present_stages:
        counts = {lbl: metric_counts([x for x in recs_by[lbl] if x["stage"] == stage]) for lbl in labels}
        names = sorted({m for c in counts.values() for m in c})
        rows, hidden = [], 0
        for m in names:
            vals = {lbl: counts[lbl].get(m) for lbl in labels}
            if all(v is None or v[0] == v[1] for v in vals.values()):
                hidden += 1
                continue
            row: list[object] = [m]
            b = vals.get(baseline)
            b_rate = (b[0] / b[1]) if b and b[1] else None
            for lbl in labels:
                v = vals[lbl]
                if not v or not v[1]:
                    row.append("-")
                    continue
                r = v[0] / v[1]
                row.append(f"{v[0]}/{v[1]} ({pct(r)})" + (delta_pp(r, b_rate) if lbl != baseline else ""))
            rows.append(row)
        if rows:
            L.append(f"### {stage}")
            L.append(md_table(["check"] + labels, rows))
            if hidden:
                L.append(f"\n({hidden} checks al 100% en todas las versiones, omitidos)")
            L.append("")
    L.append("")

    # ---- Matriz por caso
    L.append("## 5. Casos")
    sorted_keys = sorted(keys, key=lambda k: (stage_rank(next((s["stage"] for sc in scores_by.values() for kk, s in sc.items() if kk == k), "")), k[0], str(k[1])))
    sorted_keys = [k for k in sorted_keys if any(k in scores_by[l] for l in labels)]
    rows, same = [], 0
    for k in sorted_keys:
        cells = [case_cell(scores_by[l].get(k)) for l in labels]
        rates = [case_rate(scores_by[l].get(k)) for l in labels]
        changes = []
        for lbl in labels:
            if lbl == baseline:
                continue
            rb, rl = case_rate(scores_by[baseline].get(k)), case_rate(scores_by[lbl].get(k))
            if rb is None or rl is None or rb == rl:
                continue
            changes.append(f"{'mejora' if rl > rb else 'regresa'}: {lbl}")
        if len(set(rates)) == 1 and not all_rows:
            same += 1
            continue
        stage = next(s["stage"] for l in labels for kk, s in scores_by[l].items() if kk == k)
        rows.append([k[0], stage, thinking_label(k[1])] + cells + ["; ".join(changes)])
    if rows:
        L.append(md_table(["caso", "etapa", "thinking"] + labels + ["vs base"], rows))
    if same:
        L.append(f"\n({same} casos con el mismo resultado en todas las versiones, omitidos; usar --all-rows para verlos)")
    L.append("")

    # ---- Pares contra la base
    L.append(f"## 6. Cada versión contra la base ({baseline})")
    pair_rows = []
    summary["pairs"] = {}
    for lbl in labels:
        if lbl == baseline:
            continue
        cmp = pair_compare(scores_by[baseline], scores_by[lbl], keys)
        summary["pairs"][lbl] = {"wins": [list(k) for k in cmp["wins"]], "losses": [list(k) for k in cmp["losses"]], "ties": cmp["ties"], "p": cmp["p"]}
        pair_rows.append([lbl, len(cmp["wins"]), len(cmp["losses"]), cmp["ties"], f"{cmp['p']:.3f}", verdict(baseline, lbl, cmp)])
        if cmp["wins"]:
            pair_rows[-1][5] += f" | mejora en: {fmt_keys(cmp['wins'])}"
        if cmp["losses"]:
            pair_rows[-1][5] += f" | regresa en: {fmt_keys(cmp['losses'])}"
    L.append(md_table(["versión", "mejoras", "regresiones", "empates", "p (signos)", "lectura"], pair_rows) if pair_rows else "Solo hay una versión.")
    L.append("")
    L.append("La prueba de signos solo cuenta casos que cambian de resultado: con pocos casos casi nunca alcanza significancia. Repetir corridas del mismo prompt (`LABEL=rutaA,rutaB`) aporta más evidencia que agregar casos idénticos.")
    L.append("")

    # ---- Thinking
    think_rows = []
    for lbl in labels:
        for stage in present_stages:
            off = [x for x in recs_by[lbl] if x["stage"] == stage and x.get("thinking") is False]
            on = [x for x in recs_by[lbl] if x["stage"] == stage and x.get("thinking") is True]
            if off and on:
                so, sn = summarize(off), summarize(on)
                think_rows.append([lbl, stage, f"{so['passed']}/{so['n']} ({pct(so['rate'])})", f"{sn['passed']}/{sn['n']} ({pct(sn['rate'])})",
                                   num(so["lat_median"], " ms"), num(sn["lat_median"], " ms"), num(so["tok_mean"]), num(sn["tok_mean"])])
    if think_rows:
        L.append("## 7. Thinking apagado vs encendido")
        L.append(md_table(["versión", "etapa", "pass off", "pass on", "lat off", "lat on", "tokens off", "tokens on"], think_rows))
        L.append("")

    # ---- Errores frecuentes
    L.append("## 8. Errores más frecuentes (ejecuciones fallidas)")
    for lbl in labels:
        c: Counter[str] = Counter()
        for x in recs_by[lbl]:
            if x["status"] != "pass":
                for e in x.get("errors") or []:
                    c[normalize_error(e)] += 1
        L.append(f"**{lbl}**" + ("" if c else ": sin errores"))
        for msg, n in c.most_common(5):
            L.append(f"- ({n}x) {msg}")
        L.append("")

    # ---- Avisos
    raw_total = sum(1 for lbl in labels for x in recs_by[lbl] if x.get("prompt_source") == "raw")
    if raw_total:
        warnings.append(f"{raw_total} ejecuciones usaron prompt escrito a mano (prompt_source=raw): no reflejan cambios en prompts.ts.")
    if any(not x.get("system_hash") for lbl in labels for x in recs_by[lbl]):
        warnings.append("Hay registros sin system_hash (corridas anteriores a este formato): no se puede confirmar qué versión de prompt se usó.")
    if warnings:
        L.append("## Avisos")
        L += [f"- {w}" for w in warnings]
        L.append("")

    return "\n".join(L), summary


def main() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass

    ap = argparse.ArgumentParser(description="Compara versiones de prompts a partir de corridas del eval de Qwen.")
    ap.add_argument("runs", nargs="+", help="LABEL=RUTA[,RUTA...] o RUTA")
    ap.add_argument("--root", default=str(DEFAULT_ROOT), help=f"Raíz de resultados (default: {DEFAULT_ROOT})")
    ap.add_argument("--baseline", help="Label de la versión base (default: la primera)")
    ap.add_argument("--stage", action="append", choices=STAGE_ORDER, help="Limitar a una etapa (repetible)")
    ap.add_argument("--all-cases", action="store_true", help="Incluir casos que no están en todas las corridas")
    ap.add_argument("--all-rows", action="store_true", help="Mostrar también casos con el mismo resultado en todas")
    ap.add_argument("--out", help="Guardar el reporte en Markdown")
    ap.add_argument("--json", dest="json_out", help="Guardar el resumen en JSON")
    args = ap.parse_args()

    warnings: list[str] = []
    root = Path(args.root)
    runs = [parse_group(a, root, warnings) for a in args.runs]

    labels = [r.label for r in runs]
    if len(set(labels)) != len(labels):
        sys.exit(f"Labels repetidos: {labels}. Usar LABEL=RUTA para distinguirlos.")
    baseline = args.baseline or labels[0]
    if baseline not in labels:
        sys.exit(f"--baseline '{baseline}' no está entre {labels}")

    check_settings(runs, warnings)
    stages = args.stage or STAGE_ORDER + sorted({x["stage"] for r in runs for x in r.records} - set(STAGE_ORDER))
    for r in runs:
        r.records = [x for x in r.records if x["stage"] in stages]
    keys = select_keys(runs, args.all_cases, warnings)
    if not keys:
        sys.exit("No hay casos en común entre las corridas.")

    report, summary = build_report(runs, baseline, stages, keys, warnings, args.all_rows)
    print(report)

    # Determinar carpeta de comparaciones (<root>/<modelo>/comparisons/)
    first_dir = runs[0].dirs[0]
    if first_dir.parent != root and first_dir.parent.is_dir():
        comp_dir = first_dir.parent / "comparisons"
    else:
        comp_dir = root / "comparisons"
    comp_dir.mkdir(parents=True, exist_ok=True)

    today = datetime.now().strftime("%Y-%m-%d")
    labels_slug = "_vs_".join(r.label for r in runs)
    if len(labels_slug) > 50:
        labels_slug = f"{len(runs)}_runs"

    if args.out:
        out_path = Path(args.out)
        if not out_path.parent.name or str(out_path.parent) == ".":
            out_path = comp_dir / args.out
    else:
        out_path = comp_dir / f"{today}_{labels_slug}_compare.md"

    out_path.write_text(report, encoding="utf-8")
    print(f"\n[OK] Reporte comparativo guardado en: {out_path}")

    if args.json_out:
        json_path = Path(args.json_out)
        if not json_path.parent.name or str(json_path.parent) == ".":
            json_path = comp_dir / args.json_out
        json_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
        print(f"[OK] Resumen JSON guardado en: {json_path}")


if __name__ == "__main__":
    main()