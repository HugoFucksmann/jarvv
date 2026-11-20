import type { FirstQueryInput, ToolDecisionInput } from "../../src/core/contracts.ts";
import { frameLines, lastFailedBy, shortDesc } from "../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../src/core/models/prompts.ts";
import type { Variant } from "../core/variants/types.ts";

/**
 * decision_elite_fusion
 * Fusión de las dos variantes ganadoras confirmadas:
 * 1. tool_choice_precision_criteria (+0.9% global, +17% a +23% en holdouts terminal_locate, p=0.011)
 * 2. d0_chat_balanced (+0.5% global, +3.1% en real_usuario_dev, +2.9% en casos_ejemplo)
 */
function buildFirstQuery(data: FirstQueryInput): DecisionInput {
  return {
    state: `Request: ${data.request}`,
    questions: {
      kind: {
        type: "choice",
        instructions:
          "How much work does this request need from an assistant that can use tools on the computer and the web?",
        criteria: {
          chat: "Greeting, thanks, pleasantries, or casual conversation without needing tools, facts or files.",
          single: "One action is enough: one lookup, one command, one file operation or opening one thing.",
          multi: "Two or more actions, or one action whose result is needed by another (for example search and then save).",
        },
      },
      multi: {
        type: "noul",
        instructions:
          "Does the request ask for two or more separate actions (for example search and then save, or two different things to find)?",
        criteria: {
          true: "The request asks for two or more different things to do or find (several items, or steps joined by 'and', 'then' or commas), or one action whose result feeds another action.",
          false: "The request asks for exactly one thing to do or find. Reading or looking something up and then telling the answer is still one action.",
        },
      },
    },
  };
}

function buildToolChoice(data: ToolDecisionInput): DecisionInput {
  const failed = lastFailedBy(data.attempts, (a) => a.tool);

  const criteria: Record<string, string> = {};
  for (const t of data.tools) {
    let base = shortDesc(t.description, t.name);
    if (t.name === "run_command") {
      base = "Run a PowerShell command, inspect ports, disks, services, network, or system state.";
    } else if (t.name === "list_processes") {
      base = "List currently running processes and their memory or CPU. Only for processes.";
    } else if (t.name === "get_more_search_results") {
      base = "Fetch the next page of results from an existing web search.";
    } else if (t.name === "start_search") {
      base = "Start a new web search with a query.";
    }

    criteria[t.name] = failed.get(t.name) === true ? `${base} [FAILED - AVOID]` : base;
  }

  const instructions = "Choose the tool that directly accomplishes the step instruction.";

  return {
    state: [...frameLines(data), `Route: ${data.route}`].filter(Boolean).join("\n"),
    questions: { selected_tool: { type: "choice", instructions, criteria } },
  };
}

const decision_elite_fusion: Variant = {
  name: "decision_elite_fusion",
  prompts: {
    DECISION_PROMPTS: {
      buildFirstQuery,
      buildToolChoice,
    },
  },
};

export default decision_elite_fusion;
