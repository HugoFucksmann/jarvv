#!/usr/bin/env python3
"""
Análisis de scores para entender qué señales del modelo sirven.

Uso:
    python analyze.py scores_1.json scores_2.json [--runs R1_V0_clipHT,R4_V3_targetsS4]

Reporta por cada señal:
  1. AUC (0.5 = azar, 1.0 = separa perfecto buenos de malos), por dataset y combinado.
  2. Exactitud según umbral (0.5 ... 0.95) en cada dataset.
  3. Validación cruzada (si hay 2 datasets): umbral elegido en un dataset, evaluado en el otro.
"""
import json
import sys
from collections import defaultdict

THRESHOLDS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]


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


def signals(case):
    """Devuelve {nombre_señal: valor en [0,1] donde alto = 'aprobar'}."""
    out = {}
    for run, s in case.get("scores", {}).items():
        if not s:
            continue
        if "noul" in s:
            for q, v in s["noul"].items():
                out[f"{run}::{q}"] = 1.0 - v if q.startswith("any_") else v
        elif "choice" in s and "prob" in s:
            pos = s["choice"] in ("matches", "ok")
            out[f"{run}::P(matches)~"] = s["prob"] if pos else 1.0 - s["prob"]
    return out


def accuracy(cases, sig, t):
    if not cases:
        return 0.0, 0, 0
    tp = fp = tn = fn = 0
    for c in cases:
        val = signals(c).get(sig)
        if val is None:
            continue
        a = val >= t
        if is_good(c) and a:
            tp += 1
        elif is_good(c):
            fn += 1
        elif a:
            fp += 1
        else:
            tn += 1
    total = tp + fp + tn + fn
    if total == 0:
        return 0.0, 0, 0
    return (tp + tn) / total, fp, fn


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    only = None
    for a in sys.argv[1:]:
        if a.startswith("--runs="):
            only = set(a.split("=", 1)[1].split(","))

    if not args:
        print(__doc__)
        return

    datasets = {p: json.load(open(p, encoding="utf-8")) for p in args}
    all_sigs = defaultdict(int)
    for cases in datasets.values():
        for c in cases:
            for k in signals(c):
                all_sigs[k] += 1

    sigs = [k for k, n in all_sigs.items() if n >= 1]
    if only:
        sigs = [k for k in sigs if k.split("::")[0] in only]

    print("== AUC por señal ==")
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

    for a, k, per in sorted(rows, key=lambda x: (-(x[0] if x[0] == x[0] else -1), x[1])):
        per_s = " ".join(f"{x:.3f}" if x == x else " nan " for x in per)
        a_s = f"{a:.3f}" if a == a else " nan "
        print(f"{a_s}  [{per_s}]  {k}")

    print("\n== Exactitud por umbral (una columna por dataset) ==")
    top = [k for a, k, _ in sorted(rows, key=lambda x: (-(x[0] if x[0] == x[0] else -1), x[1])) if a == a][:8]
    for k in top:
        print(k)
        for p, cases in datasets.items():
            valid_cases = [c for c in cases if k in signals(c)]
            if not valid_cases:
                print(f"   {p[-22:]:>22s}  (sin datos)")
                continue
            cells = []
            for t in THRESHOLDS:
                acc_val, fp, fn = accuracy(valid_cases, k, t)
                cells.append(f"{t:.2f}:{acc_val:.2f}({fp}/{fn})")
            print(f"   {p[-22:]:>22s} " + " ".join(cells))

    if len(datasets) == 2 and top:
        print("\n== Validación cruzada (umbral elegido en A, evaluado en B) ==")
        (pa, A), (pb, B) = list(datasets.items())
        for k in top:
            for (n1, X), (n2, Y) in (((pa, A), (pb, B)), ((pb, B), (pa, A))):
                cx = [c for c in X if k in signals(c)]
                cy = [c for c in Y if k in signals(c)]
                if not cx or not cy:
                    continue
                best = max(THRESHOLDS, key=lambda t: accuracy(cx, k, t)[0])
                tr = accuracy(cx, k, best)[0]
                te = accuracy(cy, k, best)[0]
                print(f"{k:42s} t={best:.2f} en {n1[-14:]:>14s}: {tr:.2f} -> prueba en {n2[-14:]:>14s}: {te:.2f}")


if __name__ == "__main__":
    main()
