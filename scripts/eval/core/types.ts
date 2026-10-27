/**
 * Tipos para el marco de evaluación de modelos de decisión (D3, Eos, etc.)
 */

export type GoldPostLabel =
  | "matches"
  | "wrong_target"
  | "wrong_content"
  | "partial"
  | "failed"
  | "unknown";

export type GoldPreLabel = "ok" | `wrong_${string}` | "unknown";

export type TestCategory =
  | "baseline_ok"
  | "near_path"
  | "same_name_other_dir"
  | "swapped_args"
  | "success_msg_wrong_effect"
  | "partial"
  | "wrong_content"
  | "process_nopid"
  | "long_noise"
  | "injection"
  | "ambiguous_instruction"
  | "bilingual"
  | "relative_alias"
  | "read_control"
  | "empty_cases";

export interface TestCase {
  id: string;
  pair?: string;
  source: string;
  category: TestCategory;
  tool: string;
  kind: "mutation" | "read";
  instruction: string;
  expected_outcome?: string;
  args: Record<string, unknown>;
  result: string;
  observation: string;
  context?: {
    facts?: Record<string, string>;
    handoff?: string;
    recent_targets?: string[];
  };
  gold_post: GoldPostLabel;
  gold_pre: GoldPreLabel;
  notes?: string;
}

export interface DecisionPayload {
  state: string;
  questions: Record<string, any>;
}

export interface DecisionModelResponse {
  model?: string;
  answers: Record<
    string,
    {
      type: "choice" | "noul" | "score";
      choice?: string;
      probabilities?: Record<string, number>;
      confidence?: number;
      noul?: number;
      score?: number;
    }
  >;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export interface RunRecord {
  case_id: string;
  variant: string;
  perm?: string;
  options?: number;
  request: {
    state: string;
    questions: Record<string, unknown>;
  };
  raw_output?: string;
  parsed?: {
    choice?: string;
    probabilities?: Record<string, number>;
    noul?: Record<string, number>;
    score?: Record<string, number>;
  };
  approved: boolean;
  latency_ms: number;
  tokens_est: number;
  error?: string | null;
}
