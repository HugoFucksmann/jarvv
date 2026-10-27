#!/usr/bin/env python3
"""
Comparador y analizador de resultados de evaluación de Qwen.

Uso:
    python scripts/eval/analyze_qwen.py <scores_o_runs_A.json[l]> [scores_o_runs_B.json[l]] [--stage=plan|replan|arguments|final_response] [--verbose]

Modos:
  1. Un solo archivo: muestra el desglose completo de métricas por etapa, tasas de acierto,
     latencia media, errores frecuentes y distribución de tokens.
  2. Dos archivos (Comparativa A vs B): contrasta tasa de aciertos global y por etapa (Delta % = B - A),
     latencia (mediana y media), tokens de salida generados y casos donde una corrida mejoró o empeoró.
"""

import json
import os
import sys
from collections import defaultdict
from typing import Dict, List, Any, Tuple, Optional


def load_file(path: str) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """Carga tanto scores.json como runs.jsonl de una corrida."""
    if not os.path.exists(path):
        print(f"Error: No se encontró el archivo: {path}", file=sys.stderr)
        sys.exit(1)

    summary: Dict[str, Any] = {}
    runs: List[Dict[str, Any]] = []

    if path.endswith(".jsonl"):
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    runs.append(json.loads(line))
        # Intentar buscar scores.json en el mismo directorio si existe
        dir_name = os.path.dirname(path)
        scores_path = os.path.join(dir_name, "scores.json")
        if os.path.exists(scores_path):
            with open(scores_path, "r", encoding="utf-8") as f:
                summary = json.load(f)
    else:
        with open(path, "r", encoding="utf-8") as f:
            summary = json.load(f)
        dir_name = os.path.dirname(path)
        runs_path = os.path.join(dir_name, "runs.jsonl")
        if os.path.exists(runs_path):
            with open(runs_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        runs.append(json.loads(line))

    return summary, runs


def print_single_run_report(path: str, summary: Dict[str, Any], runs: List[Dict[str, Any]], stage_filter: Optional[str], verbose: bool):
    print("\n" + "=" * 70)
    print("REPORTE DE EVALUACIÓN — QWEN")
    print(f"Archivo: {path}")
    print("=" * 70)

    if summary:
        print(f"Total Casos:        {summary.get('total', len(runs))}")
        print(f"Aprobados (PASS):   {summary.get('passed', 0)} ({summary.get('pass_rate', 0) * 100:.1f}%)")
        print(f"Fallados (FAIL):    {summary.get('failed', 0)}")
        print(f"Errores Ejecución:  {summary.get('errors', 0)}")
        print(f"Latencia Media:     {summary.get('avg_latency_ms', 0)} ms")

    if runs:
        filtered_runs = [r for r in runs if not stage_filter or r.get("stage") == stage_filter]
        by_stage: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for r in filtered_runs:
            by_stage[r.get("stage", "unknown")].append(r)

        print("\n" + "-" * 70)
        print("DESGLOSE POR ETAPA")
        print("-" * 70)
        for stage, stg_runs in sorted(by_stage.items()):
            passed = sum(1 for r in stg_runs if r.get("status") == "pass")
            total = len(stg_runs)
            rate = (passed / total * 100) if total > 0 else 0
            avg_lat = sum(r.get("latency_ms", 0) for r in stg_runs) / total if total > 0 else 0
            avg_tok = sum(r.get("completion_tokens", 0) for r in stg_runs) / total if total > 0 else 0
            print(f"[{stage.upper():14}] {passed:2}/{total:2} ({rate:5.1f}%) | Latencia: {avg_lat:5.0f}ms | Tokens Out: {avg_tok:4.0f}")

            # Desglose de métricas específicas
            metric_counts = defaultdict(lambda: {"pass": 0, "total": 0})
            for r in stg_runs:
                for k, v in r.get("metrics", {}).items():
                    metric_counts[k]["total"] += 1
                    if v is True or (isinstance(v, (int, float)) and v > 0):
                        metric_counts[k]["pass"] += 1

            for mk, cnt in sorted(metric_counts.items()):
                m_pct = (cnt["pass"] / cnt["total"] * 100) if cnt["total"] > 0 else 0
                print(f"    • {mk:26}: {cnt['pass']}/{cnt['total']} ({m_pct:5.1f}%)")

            # Mostrar errores si hay
            failed_runs = [r for r in stg_runs if r.get("status") != "pass"]
            if failed_runs and verbose:
                print("    Errores detectados:")
                for fr in failed_runs:
                    print(f"      - {fr.get('case_id')}: {'; '.join(fr.get('errors', []))}")

    print("=" * 70 + "\n")


def print_comparison_report(path_a: str, path_b: str, runs_a: List[Dict[str, Any]], runs_b: List[Dict[str, Any]], stage_filter: Optional[str]):
    print("\n" + "=" * 70)
    print("COMPARATIVA DE CORRIDAS — QWEN")
    print(f"Corrida A: {path_a}")
    print(f"Corrida B: {path_b}")
    print("=" * 70)

    map_a = {r["case_id"]: r for r in runs_a if not stage_filter or r.get("stage") == stage_filter}
    map_b = {r["case_id"]: r for r in runs_b if not stage_filter or r.get("stage") == stage_filter}

    common_cases = sorted(set(map_a.keys()) & set(map_b.keys()))
    if not common_cases:
        print("No hay casos comunes entre ambas corridas para comparar.")
        return

    pass_a = sum(1 for cid in common_cases if map_a[cid].get("status") == "pass")
    pass_b = sum(1 for cid in common_cases if map_b[cid].get("status") == "pass")
    total = len(common_cases)

    rate_a = (pass_a / total) * 100
    rate_b = (pass_b / total) * 100
    delta_rate = rate_b - rate_a

    lat_a = sum(map_a[cid].get("latency_ms", 0) for cid in common_cases) / total
    lat_b = sum(map_b[cid].get("latency_ms", 0) for cid in common_cases) / total
    delta_lat = lat_b - lat_a

    print(f"Casos comparados:   {total}")
    print(f"Aprobados A:        {pass_a}/{total} ({rate_a:.1f}%)")
    print(f"Aprobados B:        {pass_b}/{total} ({rate_b:.1f}%)")
    sign_rate = "+" if delta_rate >= 0 else ""
    print(f"Delta Aprobación:   {sign_rate}{delta_rate:.1f}%")
    print(f"Latencia Media A:   {lat_a:.0f} ms")
    print(f"Latencia Media B:   {lat_b:.0f} ms (Delta: {delta_lat:+.0f} ms)")

    print("\n" + "-" * 70)
    print("DESGLOSE POR ETAPA")
    print("-" * 70)

    by_stage_cases = defaultdict(list)
    for cid in common_cases:
        by_stage_cases[map_a[cid].get("stage", "unknown")].append(cid)

    for stage, cids in sorted(by_stage_cases.items()):
        s_pass_a = sum(1 for cid in cids if map_a[cid].get("status") == "pass")
        s_pass_b = sum(1 for cid in cids if map_b[cid].get("status") == "pass")
        s_total = len(cids)
        s_rate_a = (s_pass_a / s_total) * 100
        s_rate_b = (s_pass_b / s_total) * 100
        s_delta = s_rate_b - s_rate_a
        s_sign = "+" if s_delta >= 0 else ""
        print(f"[{stage.upper():14}] A: {s_pass_a}/{s_total} ({s_rate_a:5.1f}%) | B: {s_pass_b}/{s_total} ({s_rate_b:5.1f}%) | Δ: {s_sign}{s_delta:5.1f}%")

    # Analizar divergencias
    regressions = [cid for cid in common_cases if map_a[cid].get("status") == "pass" and map_b[cid].get("status") != "pass"]
    improvements = [cid for cid in common_cases if map_a[cid].get("status") != "pass" and map_b[cid].get("status") == "pass"]

    print("\n" + "-" * 70)
    print("DIVERGENCIAS Y CAMBIOS DE ESTADO")
    print("-" * 70)
    print(f"Mejoras en B (Fallaba en A -> Pasa en B):  {len(improvements)}")
    for cid in improvements:
        print(f"  🟢 {cid} [{map_b[cid].get('stage')}]")

    print(f"Regresiones en B (Pasaba en A -> Falla en B): {len(regressions)}")
    for cid in regressions:
        print(f"  🔴 {cid} [{map_a[cid].get('stage')}]: {'; '.join(map_b[cid].get('errors', []))}")

    print("=" * 70 + "\n")


def main():
    files = [a for a in sys.argv[1:] if not a.startswith("--")]
    stage_filter = None
    verbose = False

    for a in sys.argv[1:]:
        if a.startswith("--stage="):
            stage_filter = a.split("=", 1)[1]
        elif a in ("--verbose", "-v"):
            verbose = True

    if not files:
        print(__doc__)
        sys.exit(0)

    if len(files) == 1:
        summary, runs = load_file(files[0])
        print_single_run_report(files[0], summary, runs, stage_filter, verbose)
    else:
        summary_a, runs_a = load_file(files[0])
        summary_b, runs_b = load_file(files[1])
        print_comparison_report(files[0], files[1], runs_a, runs_b, stage_filter)


if __name__ == "__main__":
    main()
