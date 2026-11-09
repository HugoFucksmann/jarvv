# Árbol de `eval/`

> Generado el 2026-11-09. La carpeta `results/` se muestra colapsada (runs fechados).

```
eval/
├── cli.ts
├── cross.ts
├── INSTRUCCIONES.md
├── psvalid.ts
├── README.md
├── ui.ts
├── wizard.ts
│
├── core/
│   ├── case.ts
│   ├── config.ts
│   ├── contract.ts
│   ├── d4_checks.ts
│   ├── datasets.ts
│   ├── glob.ts
│   ├── questions.ts
│   ├── report.ts
│   ├── results.ts
│   ├── runner.ts
│   ├── scenario.ts
│   ├── scoring.ts
│   ├── types.ts
│   │
│   ├── client/
│   │   ├── decision.ts
│   │   ├── generative.ts
│   │   ├── mock.ts
│   │   └── oracle.ts
│   │
│   ├── graders/
│   │   ├── arguments.ts
│   │   ├── common.ts
│   │   ├── final.ts
│   │   ├── label.ts
│   │   ├── pending.ts
│   │   ├── plan.ts
│   │   └── question.ts
│   │
│   ├── stages/
│   │   ├── decision.ts
│   │   ├── generative.ts
│   │   └── index.ts
│   │
│   └── variants/
│       ├── labels.ts
│       ├── load.ts
│       └── types.ts
│
├── datasets/
│   ├── smoke.jsonl
│   │
│   ├── arguments/
│   │   ├── llm_arguments.jsonl
│   │   ├── llm_arguments_cmd.jsonl
│   │   └── llm_arguments_hard.jsonl
│   │
│   ├── d4/
│   │   ├── d4_verify.jsonl
│   │   ├── d4_verify.jsonl.bak
│   │   ├── d4_verify_hard.jsonl
│   │   ├── d4_verify_hard.jsonl.bak
│   │   ├── d4_verify_long.jsonl
│   │   └── llm_verify_hard.jsonl
│   │
│   ├── pending/
│   │   ├── llm_pending.jsonl
│   │   └── llm_pending_hard.jsonl
│   │
│   └── question/
│       ├── llm_question.jsonl
│       └── llm_question_hard.jsonl
│
├── gen/
│   ├── mutaciones.ts
│   ├── ram_real.ts
│   ├── ram_retry.ts
│   ├── reales.ts
│   ├── repeticiones.ts
│   └── verificacion_vieja.ts
│
├── results/
│   ├── qwen3.5_4b/          ← runs 2026-11-08
│   ├── _cross/              ← (vacío)
│   ├── _mock/               ← runs 2026-11-08
│   └── _oracle/             ← runs 2026-11-08 y 2026-11-09
│
└── variants/
    ├── decision_all_stages_example.ts
    ├── prod.ts
    │
    ├── arguments/
    │   ├── args_short.ts
    │   └── args_tiny.ts
    │
    ├── d1/
    │   └── route_example.ts
    │
    ├── d4/
    │   ├── d4_concise.ts
    │   ├── d4_concise_hints.ts
    │   ├── d4_concise_precision.ts
    │   ├── d4_fewshot.ts
    │   ├── d4_fewshot_hints.ts
    │   ├── d4_hybrid_best.ts
    │   ├── d4_hybrid_prelim.ts
    │   ├── d4_hybrid_zero.ts
    │   ├── d4_hybrid_zero_hints.ts
    │   ├── d4_inv_checklist_k.ts
    │   ├── d4_inv_double_k.ts
    │   ├── d4_inv_falla_k.ts
    │   ├── d4_precision_calibrated.ts
    │   ├── d4_recent.ts
    │   ├── d4_recent_hints.ts
    │   ├── d4_split_cumple.ts
    │   └── d4_structured_checks.ts
    │
    ├── Pending/
    │   ├── pending_short.ts
    │   └── pending_tiny.ts
    │
    └── question/
        ├── question_short.ts
        └── question_tiny.ts
```

