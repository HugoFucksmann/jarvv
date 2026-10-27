#!/usr/bin/env python3
"""
Análisis de scores para entender qué señales del modelo sirven.

Uso:
    python analyze_scores.py scores_1.json scores_2.json [--runs=N2_noul_criteria,N1_four_way] [--bands=0.9,0.6]

Cada archivo es una lista de casos con {id, gold_post, scores:{run:{approved, noul|choice, prob}}}.
Qué reporta, por cada señal (una pregunta noul, la P(matches) de un run choice, o un score):
  1. AUC (0.5 = azar, 1.0 = separa perfecto), por dataset y combinado.
     Formato: AUC_COMBINADO [AUC_DS1 AUC_DS2 ...] señal  (NO son intervalos de confianza).
  2. Exactitud según umbral (0.5 ... 0.95) en cada dataset. Paréntesis = (FP/FN).
  3. Validación cruzada: umbral elegido en un dataset, evaluado en el otro.
  4. (--bands=hi,lo) Política de 3 bandas: aprobar si señal >= hi, rechazar si < lo, revisión entre medio.
  5. Umbral mínimo con FP = 0 en TODOS los datasets y cuántos buenos aprueba (optimista: se
     calcula sobre los mismos datos).
Convenciones: preguntas 'any_*' tienen polaridad negativa (se invierten).
Runs 'choice': P(matches) = suma de probabilities de las opciones aceptadas si existe la
distribución completa; si no, proxy prob / 1 - prob (solo fiable con 2 opciones).
Señales combinadas (offline, AND = min):
  N3_combined = min(N3_read_status, N3_cumple)
  N2_N1_combined = min(N2_noul_criteria, N1_four_way)
"""
import json
import os
import sys
from collections import defaultdict

THRESHOLDS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]
ACCEPTED = ("matches", "ok", "effect_confirmed")

COMBINED = {
    "N3_combined::AND(read,cumple)": ("N3_read_status::P(matches)~", "N3_cumple::cumple"),
    "N2_N1_combined::AND(noul,four)": ("N2_noul_criteria::cumple", "N1_four_way::P(matches)~"),
    # Pares desacoplados v5 (AND offline)
    "C1_dual::AND(four,noulCriteria)": ("C1_four_a::P(matches)~", "C_noulCriteria::cumple"),
    "C2_dual::AND(read,noulCriteria)": ("C2_read_a::P(matches)~", "C_noulCriteria::cumple"),
}


def is_good(c):
    return c["gold_post"] == "matches"


def auc(pos, neg):
    if not pos or not neg:
        return float("nan")
    s = 0.0
    for p in pos:
        for n in neg:
            s += 1.0 if p > n else 0.5 if p == n else 0.0
    return s / (len(pos) * len(neg))


def p_matches(s):
    probs = s.get("probabilities")
    if isinstance(probs, dict):
        return sum(float(probs.get(k, 0.0)) for k in ACCEPTED)
    pos = s.get("choice") in ACCEPTED
    return s["prob"] if pos else 1 - s["prob"]


def score_norm(s):
    legend = s.get("legend")
    probs = s.get("probabilities")
    n = len(legend) if legend else len(probs) if probs else 4
    max_lvl = n - 1
    lvl = s["level"]
    return max(0.0, min(1.0, lvl / max_lvl)) if max_lvl > 0 else lvl


def signals(case):
    """Devuelve {nombre_señal: valor en [0,1] donde alto = 'aprobar'}."""
    out = {}
    for run, s in case["scores"].items():
        if not s or not isinstance(s, dict):
            continue
        # 1. Runs multi (runMulti: J1, J2, J1r)
        if s.get("multi") and "answers" in s:
            sub_probs = []
            for qk, a in s["answers"].items():
                if a.get("type") == "noul" and "noul" in a:
                    val = 1 - a["noul"] if qk.startswith("any_") else a["noul"]
                    out[f"{run}::{qk}"] = val
                    sub_probs.append(val)
                elif a.get("type") == "choice" and "choice" in a:
                    p = p_matches(a)
                    out[f"{run}::{qk}"] = p
                    sub_probs.append(p)
                elif a.get("type") == "score" and "score" in a:
                    val = score_norm({"level": a["score"], "probabilities": a.get("probabilities")})
                    out[f"{run}::{qk}"] = val
                    sub_probs.append(val)
            # Señal conjunta agregada: AND de todas las sub-preguntas del request
            if sub_probs:
                out[f"{run}::AND_all"] = min(sub_probs)
        # 2. Runs regulares
        elif "noul" in s:
            for q, v in s["noul"].items():
                out[f"{run}::{q}"] = 1 - v if q.startswith("any_") else v
        elif "choice" in s and "prob" in s:
            out[f"{run}::P(matches)~"] = p_matches(s)
        elif "level" in s:
            out[f"{run}::score"] = score_norm(s)

    for name, (a, b) in COMBINED.items():
        if a in out and b in out:
            out[name] = min(out[a], out[b])
    return out


def accuracy(cases, sig, t):
    tp = fp = tn = fn = 0
    for c in cases:
        a = signals(c).get(sig, 0) >= t
        if is_good(c) and a:
            tp += 1
        elif is_good(c):
            fn += 1
        elif a:
            fp += 1
        else:
            tn += 1
    n = len(cases)
    return ((tp + tn) / n if n else float("nan")), fp, fn


def ds_label(p):
    parts = p.replace("\\", "/").split("/")
    if len(parts) >= 3:
        return f"{parts[-3]}/{parts[-2]}"
    return os.path.basename(p)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    only = None
    bands = None
    for a in sys.argv[1:]:
        if a.startswith("--runs="):
            only = set(a.split("=", 1)[1].split(","))
        if a.startswith("--bands="):
            bands = tuple(float(x) for x in a.split("=", 1)[1].split(","))
    if not args:
        print(__doc__)
        return

    datasets = {p: json.load(open(p, encoding="utf-8")) for p in args}
    all_sigs = defaultdict(int)
    for cases in datasets.values():
        for c in cases:
            for k in signals(c):
                all_sigs[k] += 1
    total = sum(len(v) for v in datasets.values())
    min_len = min(len(v) for v in datasets.values())
    sigs = [k for k, n in all_sigs.items() if n == total or len(datasets) == 1 or n >= min_len]
    if only:
        sigs = [k for k in sigs if k.split("::")[0] in only]

    out_lines = []

    def log(msg=""):
        print(msg)
        out_lines.append(msg)

    # 1. AUC
    log("== AUC por señal (combinado [por dataset]) ==")
    rows = []
    for k in sigs:
        per = []
        for p, cases in datasets.items():
            pos = [signals(c)[k] for c in cases if is_good(c) and k in signals(c)]
            neg = [signals(c)[k] for c in cases if not is_good(c) and k in signals(c)]
            per.append(auc(pos, neg))
        allc = [c for cs in datasets.values() for c in cs if k in signals(c)]
        pos = [signals(c)[k] for c in allc if is_good(c)]
        neg = [signals(c)[k] for c in allc if not is_good(c)]
        rows.append((auc(pos, neg), k, per))
    rows.sort(reverse=True)
    for a, k, per in rows:
        log(f"{a:.3f}  [{' '.join(f'{x:.3f}' for x in per)}]  {k}")

    top = [k for _, k, _ in rows]  # todas las señales

    # 2. Exactitud por umbral
    log("\n== Exactitud por umbral, formato umbral:exactitud(FP/FN) ==")
    for k in top:
        log(k)
        for p, cases in datasets.items():
            cells = []
            for t in THRESHOLDS:
                a, fp, fn = accuracy([c for c in cases if k in signals(c)], k, t)
                cells.append(f"{t:.2f}:{a:.2f}({fp}/{fn})")
            log(f"   {ds_label(p):>16s} " + " ".join(cells))

    # 3. Bandas
    if bands:
        hi, lo = bands
        log(f"\n== Bandas: aprobar >= {hi}, rechazar < {lo}, revisión entre medio (buenos/malos) ==")
        f = lambda L: f"{sum(is_good(c) for c in L)}/{sum(not is_good(c) for c in L)}"
        for k in top:
            for p, cases in datasets.items():
                cs = [c for c in cases if k in signals(c)]
                if not cs:
                    continue
                a = [c for c in cs if signals(c)[k] >= hi]
                r = [c for c in cs if signals(c)[k] < lo]
                m = [c for c in cs if lo <= signals(c)[k] < hi]
                log(f"{k:42s} {ds_label(p):>16s} | auto {f(a):>5s} | revisión {f(m):>5s} "
                    f"({len(m)/len(cs):.0%}) | rechazo {f(r):>5s}")

    # 4. Umbral mínimo con FP = 0 en todos los datasets
    log("\n== Umbral mínimo con 0 malos aprobados (en todos los datasets) y buenos aprobados ==")
    log("   (optimista: umbral calculado sobre los mismos datos)")
    for k in top:
        bad_all = [signals(c)[k] for cs in datasets.values() for c in cs
                   if k in signals(c) and not is_good(c)]
        if not bad_all:
            continue
        max_bad = max(bad_all)
        parts = []
        for p, cases in datasets.items():
            cs = [c for c in cases if k in signals(c)]
            good = [c for c in cs if is_good(c)]
            ok = sum(signals(c)[k] > max_bad for c in good)
            parts.append(f"{ds_label(p)}: {ok}/{len(good)}")
        log(f"{k:42s} peor malo={max_bad:.3f} (umbral > eso) | buenos auto: " + " | ".join(parts))

    # 5. Validación cruzada
    if len(datasets) == 2:
        log("\n== Validación cruzada (umbral elegido en A, evaluado en B) ==")
        items = list(datasets.items())
        for k in top:
            for (n1, X), (n2, Y) in ((items[0], items[1]), (items[1], items[0])):
                Xs = [c for c in X if k in signals(c)]
                Ys = [c for c in Y if k in signals(c)]
                best = max(THRESHOLDS, key=lambda t: accuracy(Xs, k, t)[0])
                tr = accuracy(Xs, k, best)[0]
                te = accuracy(Ys, k, best)[0]
                log(f"{k:42s} t={best:.2f} elegido en {ds_label(n1):>16s}: {tr:.2f} "
                    f"-> prueba en {ds_label(n2):>16s}: {te:.2f}")

    # Guardar reporte
    first_path = list(datasets.keys())[0]
    if len(datasets) == 1:
        out_file = os.path.join(os.path.dirname(first_path), "analysis.txt")
    else:
        parent_dir = os.path.dirname(os.path.dirname(os.path.dirname(first_path)))
        ver_dir = os.path.basename(os.path.dirname(first_path))
        out_file = os.path.join(parent_dir, f"{ver_dir}_analysis.txt")
    try:
        with open(out_file, "w", encoding="utf-8") as fh:
            fh.write("\n".join(out_lines) + "\n")
        print(f"\n[OK] Reporte guardado en: {out_file}")
    except Exception as e:
        print(f"\n[Aviso] No se pudo escribir {out_file}: {e}")


if __name__ == "__main__":
    main()