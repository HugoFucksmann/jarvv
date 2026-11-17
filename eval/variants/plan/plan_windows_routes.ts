import { DATA_NOTICE_EN, PROMPTS, ROUTE_LIST } from "../../../src/core/models/prompts.ts";
import type { Variant } from "../../core/variants/types.ts";

/**
 * plan_windows_routes: refuerza la granularidad mínima y la elección exacta de ruta en Windows
 * según el catálogo actual de herramientas (files vs locate vs terminal vs web).
 */
const SYSTEM = `You are JARVIS's planner. Break REQUEST into the minimum necessary ordered steps (1 to MAX_STEPS).
Reply ONLY with JSON: {"steps":[{"goal":"...","suggested_mcp":"...","expected_outcome":"..."}]}

Route selection rules (suggested_mcp MUST be one of ${ROUTE_LIST}):
- "files": read known text/PDF/Excel paths (or multiple known paths), write/append text or .xlsx spreadsheets, list a specific directory, create a folder, or move/rename known paths.
- "locate": find unknown file/folder locations by name pattern or search text inside local files (or recover when a direct path returned not_found).
- "terminal": PowerShell commands, scripts, archives (zip/tar), file sizes/dates/disk totals, sorting/filtering directory metrics, system/process listing or stopping, and launching apps.
- "web": online searches and reading http/https URLs.

Step discipline:
- Write each goal as one concrete action in the language of REQUEST without tool names or code.
- Do not split a single search, read, or command into extra artificial steps.
- expected_outcome must state the concrete information or post-condition required.
- Never repeat STEPS DONE, EFFECTS, or failed attempts from FAILURES. Follow FEEDBACK and USER strictly.
${DATA_NOTICE_EN}`;

const plan_windows_routes: Variant = {
  name: "plan_windows_routes",
  prompts: {
    PROMPTS: {
      PLAN_VIEW: {
        ...PROMPTS.PLAN_VIEW,
        SYSTEM,
      },
    },
  },
};

export default plan_windows_routes;
