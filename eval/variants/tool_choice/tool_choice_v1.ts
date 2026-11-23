/**
 * eval/variants/tool_choice/tool_choice_v1.ts
 *
 * Hipótesis: explicitar en `criteria` las diferencias entre herramientas vecinas de cada grupo (`find_files` nombre vs `search_content` texto interior; `edit_file` fragmento exacto vs `write_file` archivo completo; `web_search` leer/buscar vs `download_file` bajar a disco) mejora la elección dentro de la ruta.
 */

import { DECISION_PROMPTS } from "../../../src/core/models/prompts.ts";
import type { DecisionInput } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

const MARK = /\s*(\[[^\]]*\])\s*$/;

const CRITERIA: Record<string, string> = {
  find_files: "Find files or folders by filename/wildcard pattern (not text inside files).",
  list_folder: "List entries of a known folder with type, size, modified date, sorting, or extension filter.",
  search_content: "Search for text or regex inside the contents of files.",
  read_file: "Read lines from a known local file path.",
  write_file: "Create a new text file, overwrite an entire file, or append lines at the end.",
  edit_file: "Replace an exact text snippet inside an existing text file without rewriting everything.",
  convert_file: "Convert format, resize, or adjust quality of an image, audio, or video file.",
  create_folder: "Create a new directory.",
  copy_file: "Copy a file or folder while keeping the original.",
  move_file: "Move or rename files and folders without leaving the source behind.",
  delete_file: "Delete a file or folder.",
  archive_files: "Compress files into a .zip or extract a .zip archive.",
  system_info: "Inspect PC state: hardware, OS, disks, services, dev_tools, network, processes, ports, or datetime.",
  stop_process: "Terminate a running process by pid or name.",
  pc_settings: "Get or set brightness, wifi, bluetooth, dark_mode, or do_not_disturb.",
  power: "Lock, sleep, restart, or shut down the PC.",
  open_on_screen: "Open an app, URL, or folder/file on the user's screen (does not read content).",
  clipboard: "Read or write text in the system clipboard.",
  play_media: "Search and start playing a specific song, artist, video, or media URL/URI.",
  media_control: "Control active playback or audio: play/resume, pause, next, previous, seek, set_volume, mute, now_playing.",
  web_search: "Search online by need or read/extract text from known web page URLs (does not save files to disk).",
  download_file: "Download a file from an http(s) URL and save it to local disk.",
};

function buildToolChoice(data: Parameters<typeof DECISION_PROMPTS.buildToolChoice>[0]): DecisionInput {
  const base = DECISION_PROMPTS.buildToolChoice(data);
  const question = base.questions.selected_tool;
  if (question?.type !== "choice") return base;
  const criteria = Object.fromEntries(
    Object.entries(question.criteria).map(([option, text]) => {
      const own = CRITERIA[option];
      const mark = MARK.exec(text)?.[1];
      return [option, own === undefined ? text : `${own}${mark ? ` ${mark}` : ""}`];
    }),
  );
  return { ...base, questions: { selected_tool: { ...question, criteria } } };
}

const tool_choice_v1: Variant = {
  name: "tool_choice_v1",
  mode: "prompt",
  prompts: { DECISION_PROMPTS: { buildToolChoice } },
};

export default tool_choice_v1;
