/**
 * eval/variants/tool_choice/tool_choice_v1.ts
 *
 * Variante dedicada para la etapa `tool_choice` (`buildToolChoice`).
 * Diferencia herramientas cercanas dentro de cada ruta y evita repetir herramientas fallidas.
 */

import type { DecisionAttempt, ToolDecisionInput } from "../../../src/core/contracts.ts";
import { type DecisionInput, frameLines, lastFailedBy, shortDesc } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const TOOL_GUIDANCE: Record<string, string> = {
  find_files: "Locate files or folders by name/wildcard pattern across folders.",
  list_folder: "List immediate/shallow entries of a KNOWN folder path (supports sorting, depth, extensions).",
  search_content: "Search text or regex matches INSIDE file contents.",
  read_file: "Read contents of a specific KNOWN file path.",
  write_file: "Create a brand-new file or overwrite/append full text content.",
  edit_file: "Replace an exact text snippet inside an existing file without rewriting the whole file.",
  move_file: "Move or rename existing files/folders (removes from source).",
  copy_file: "Duplicate an existing file/folder keeping the source intact.",
  delete_file: "Delete an existing file/folder.",
  create_folder: "Create a new directory.",
  archive_files: "Compress paths into a .zip archive or extract an existing .zip file.",
  convert_file: "Convert or resize image, audio, or video files between formats.",
  system_info: "Read OS, hardware, disks, processes, services, network, ports, dev_tools, or datetime.",
  open_on_screen: "Open an application, URL, file, or folder visibly on screen.",
  stop_process: "Terminate a running process by PID or name.",
  pc_settings: "Get or set brightness, wifi, bluetooth, dark_mode, or do_not_disturb.",
  power: "Lock, sleep, restart, or shut down the PC.",
  clipboard: "Read or write the system clipboard.",
  play_media: "Search and play music or video on Spotify or YouTube.",
  media_control: "Pause, resume, next, previous, seek, mute, set volume, or inspect now playing.",
  web_search: "Search the web with a natural-language question need, or read explicit web urls.",
  download_file: "Download a file from an http(s) URL to a local folder.",
  run_command: "Run a PowerShell command in terminal or send input to a waiting pid.",
};

function buildToolChoice(data: ToolDecisionInput): DecisionInput {
  const failed = lastFailedBy(data.attempts, (a: DecisionAttempt) => a.tool);
  const criteria: Record<string, string> = {};
  for (const t of data.tools) {
    const base = TOOL_GUIDANCE[t.name] ?? shortDesc(t.description, t.name);
    criteria[t.name] = failed.get(t.name) === true ? `${base} [FAILED PREVIOUSLY — DO NOT REPEAT UNCHANGED]` : base;
  }

  return {
    state: [...frameLines(data), `Route: ${data.route}`].filter(Boolean).join("\n"),
    questions: {
      selected_tool: {
        type: "choice",
        instructions:
          "Select the exact tool in Route that matches the step semantics (names vs contents, read vs edit vs move vs copy, search vs download).",
        criteria,
      },
    },
  };
}

const tool_choice_v1: Variant = {
  name: "tool_choice_v1",
  prompts: { DECISION_PROMPTS: { buildToolChoice } },
};

export default tool_choice_v1;
