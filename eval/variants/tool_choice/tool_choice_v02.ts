/**
 * eval/variants/tool_choice/tool_choice_v02.ts
 *
 * Hipótesis: Precisar los `criteria` por herramienta en las parejas más confundibles (`find_files`/`list_folder`/`search_content`, `write_file`/`edit_file`, `play_media`/`media_control`, `web_search`/`download_file`, `pc_settings`/`system_info`/`clipboard`) mejora la precisión sin alargar la instrucción global.
 */

import type { ToolDecisionInput } from "../../../src/core/contracts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const MARK = /\s*(\[[^\]]*\])\s*$/;

const TOOL_CRITERIA: Record<string, string> = {
  find_files: "Locate files or folders across subfolders by file name or wildcard (*.csv). Does not sort by size/date or search inside text.",
  list_folder: "List entries in one folder with size, modified date, sorting, depth and extension filters. Use for known folder contents.",
  search_content: "Search for text or regex inside file contents under a folder.",
  read_file: "Read lines from one specific local file whose path is known.",
  write_file: "Create a new file, overwrite an entire file, or append text to the end.",
  edit_file: "Replace an exact text fragment inside an existing file without rewriting the whole file.",
  play_media: "Search and start playing a new song, playlist or video on YouTube or Spotify (including URLs/URIs).",
  media_control: "Control active playback or audio: play/resume, pause, next, previous, seek, volume, mute, or check now playing.",
  web_search: "Search the web or read the text of http(s) URLs to answer a question (does not save files to disk).",
  download_file: "Download a file from an http(s) URL and save it to disk.",
  pc_settings: "Get or set brightness, wifi, bluetooth, dark mode or do not disturb.",
  system_info: "Inspect PC state: overview, hardware, os, disks, services, dev_tools, network, processes, ports, datetime.",
};

function buildToolChoice(data: ToolDecisionInput): DecisionInput {
  const base = DECISION_PROMPTS.buildToolChoice(data);
  const q = base.questions.selected_tool;
  if (q.type !== "choice") return base;
  const criteria = Object.fromEntries(
    Object.entries(q.criteria).map(([tool, text]) => {
      const own = TOOL_CRITERIA[tool];
      const mark = MARK.exec(text)?.[1];
      return [tool, own === undefined ? text : `${own}${mark ? ` ${mark}` : ""}`];
    }),
  );
  return { ...base, questions: { selected_tool: { ...q, criteria } } };
}

const tool_choice_v02: Variant = {
  name: "tool_choice_v02",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildToolChoice } },
};
export default tool_choice_v02;
