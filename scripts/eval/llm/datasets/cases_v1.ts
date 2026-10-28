/**
 * Dataset v1 — sembrado desde la traza real task_1793150749075_aiht
 * ("crea un exel en la carpeta JARVIS del escritorio con la informacion del ultimo modelo de gemini y de GPT").
 *
 * Los casos reproducen el estado exacto que vio cada etapa en esa corrida. Los datos son los de la traza
 * (usuario reemplazado por "eval", ver DEFAULT_ENV). Uso: --dataset=v1
 */
import { argsCase, DEFAULT_ENV, finalCase, planCase, replanCase } from "../core/cases.ts";

const ROUTES = ["files", "locate", "terminal", "web"];

// ------------------------------------------------------------
// Fixtures de la traza (se reutilizan entre casos)
// ------------------------------------------------------------

const GOAL = "crea un exel en la carpeta JARVIS del escritorio con la informacion del ultimo modelo de gemini y de GPT";
const DESKTOP = (DEFAULT_ENV as unknown as Record<string, string>).desktop;
const JARVIS_DIR = `${DESKTOP}\\JARVIS`;
const XLSX = `${JARVIS_DIR}\\modelos_ia.xlsx`;

const GEMINI_SEARCH = [
    "Con fecha: 2/10 (el resto, sin fecha)",
    "All Gemini Models - Pro, Ultra, Flash (2026) | LM Market Cap: https://lmmarketcap.com/google-gemini-models - Every Google Gemini model ranked: Pro, Ultra, and Flash compared by scores, pricing, and…",
    "Los gatitos más virales de febrero en un solo video ...: https://www.facebook.com/reel/1282366340153746 - Los gatitos más virales de febrero en un solo video 😍🐾 Momentos tiernos, divertidos y emocionales…",
    "Modelos | Gemini API | Google AI for Developers: https://ai.google.dev/gemini-api/docs/models?hl=es-419 - Es un modelo de razonamiento incorporado avanzado que comprende los espacios físicos y planifica…",
    "Ranking de IA 2026: Benchmark de +900 LLMs | SWEN.AI: https://swen.ia.br/benchmark - Ranking de IA 2026: compare +900 modelos por inteligência, preço e velocidade. GPT, Claude, Gemini e…",
    "Recopilación de gatitos divertidos Like y follow para más ...: https://www.facebook.com/reel/956664013301231 [2025-09-07] - Sep 7, 2025 · Recopilación de gatitos divertidos 😹💗 Like y follow para más contenido así 😺 . . .…",
    "Novedades y mejoras de las aplicaciones de Gemini: https://gemini.google/es/release-notes/?hl=es - Qué: Gemini 3.5 Flash es nuestro mejor modelo hasta la fecha para completar tareas complejas de…",
    "Alphabet Inc. (GOOG) — Precio, Gráfico y Fundamentales | Inversionistas.net: https://inversionistas.net/ticker/GOOG - Cotización de Alphabet Inc. (GOOG) con gráfico, rentabilidad frente a el S&P 500, resultados…",
    "Gemini 3: https://aistudio.google.com/models/gemini-3 - Gemini 3.1 Pro. Advanced reasoning for coding and complex tasks ; Gemini 3.5 Flash. Frontier…",
    "Predicción del horóscopo para Géminis hoy, domingo 25 de ... - Okdiario: https://okdiario.com/horoscopo/prediccion-del-horoscopo-para-geminis-hoy-domingo-25-de-octubre-de-2026-20624113 - Predicción del horóscopo para Géminis hoy, domingo 25 de octubre de 2026 Esto es lo que te depara…",
    "Día de gatos tiernos y divertidos ️ ️ #funnyvideosmexico ...: https://www.facebook.com/reel/1731360810860371 [2025-10-19] - Oct 19, 2025 · Día de gatos tiernos y divertidos 👍😸💝😊 ️ ️ #funnyvideosmexico #amoranimal…",
].join("\n");

const GPT_SEARCH = [
    "Con fecha: 1/10 (el resto, sin fecha)",
    "GPT-5 - Wikipedia, la enciclopedia libre: https://es.wikipedia.org/wiki/GPT-5 - GPT-5 es un modelo de lenguaje de gran tamaño desarrollado y alojado por OpenAI. Es su modelo GPT insignia y con capacidades de agente, y fue lanzado el 7 de…",
    "Últimas novedades en IA — Nuevos Modelos, Proyectos y Lanzamientos: https://olud.ai/es/latest.html - Lo último en IA Lo nuevo en este momento — los modelos más frescos, open-weight y comerciales, proyectos de GitHub en tendencia, nuevos Espacios de Hugging Face…",
    "Modelos de ChatGPT en 2026: Astra, Sol 6.1 y Luna: https://www.lisdatasolutions.com/es/blog/modelos-chatgpt-comparativa - La llegada de GPT-6.1 Sol cambia la comparación con GPT-6 Astra y GPT-6 Luna. En esta guía repasamos sus diferencias, las …",
    "Llegó GPT-5: https://openai.com/es-419/gpt-5 - GPT‑5 es más inteligente en todos los ámbitos y ofrece respuestas más útiles en matemáticas, ciencias, finanzas, derecho y mucho más.",
    "All OpenAI Models - GPT-5, GPT-4o, o3 & More (2026): https://lmmarketcap.com/openai-models - Every OpenAI model ranked and compared: GPT-5, GPT -4o, o3, o1, and GPT -4o Mini. See pricing, scores, and capabilities side-by-side. Browse the full list.",
    "Modelos de ChatGPT: lista completa, funciones clave y casos de uso: https://chatsmith.io/es/blogs/ai-guide/chatgpt-models-overview-00379 [2026-09-14] - Sep 14, 2026 · Lanzado el 27 de febrero de 2025 con el nombre en clave «Orion», GPT-4.5 fue el último modelo de chat insignia de …",
    "ChatGPT 5.5 is a new era: https://www.youtube.com/watch?v=DHk0gFHyHeE - GPT 5.5 ya ha llegado, ayer lo presentó OpenAI y hay que entender bien este modelo porque lo primero que vais a ver es que no hay grandes ...",
    "Release Radar: the latest AI model releases | AI HQ: https://www.ai-hq.tech/releases - A live timeline of the most recent AI model releases across OpenAI, Anthropic, Google, xAI, DeepSeek, Meta and more, sourced from provider listings. Filter by…",
    "GPT-6 Astra: una nueva generación de inteligencia | OpenAI: https://openai.com/es-ES/index/gpt-6-astra - Obtén más información. Presentamos GPT‑6 Astra, el modelo más inteligente y alineado del mundo. GPT‑6 Astra es el resultado de …",
    "GPT-5.5: el modelo más potente de OpenAI llega a ChatGPT: https://hipertextual.com/inteligencia-artificial/gpt-5-5-openai-chatgpt - GPT-5.5 es el nuevo modelo disponible en ChatGPT y Codex que soluciona todo tipo de problemas de forma autónoma y mejor que GPT-5.4.",
].join("\n");

const WRITE_ERR = "Error: Invalid content format. Expected JSON string with 2D array or object with sheet names.";
const MKDIR_OK = `Successfully created directory ${JARVIS_DIR}`;

const LOG_S1 = "s1|search último modelo de Gemini|ok|10 resultados web (2 con fecha)";
const LOG_S2 = "s2|search último modelo de GPT|ok|10 resultados web (1 con fecha)";
const LOG_S3 = `s3|create_directory ${JARVIS_DIR}|ok|${MKDIR_OK}`;
const LOG_S4_ERR = `s4|write_file ${XLSX}|err|err: ${WRITE_ERR}`;
const FAIL_S4 = "s4|write_file|ejecución fallida";
const EFFECT_S3 = `s3|create_directory path=${JARVIS_DIR}: ${MKDIR_OK}`;

const DATA_OBS = [
    { stepId: "s1", label: "search último modelo de Gemini", obsText: GEMINI_SEARCH },
    { stepId: "s2", label: "search último modelo de GPT", obsText: GPT_SEARCH },
];

// Tools tal como las ve la etapa arguments (name + description + schema).
const TOOL_SEARCH = {
    name: "search",
    description: "Deduplicated multi-engine web search with clean snippets.",
    inputSchema: {
        properties: { query: { type: "string" }, max_results: { default: 10, type: "integer" } },
        required: ["query"],
        type: "object",
    },
};

const TOOL_WRITE_FILE = {
    name: "write_file",
    description: "Create or overwrite a file on disk.",
    inputSchema: {
        type: "object",
        properties: {
            path: { type: "string" },
            content: {
                type: "string",
                description:
                    'Text of the file. For .xlsx/.xls/.xlsm: a JSON string of a 2D array of rows, e.g. [["Name","Age"],["Alice",30]], or of an object {"SheetName": [[...]]}.',
            },
            mode: { type: "string", enum: ["rewrite", "append"], default: "rewrite" },
        },
        required: ["path", "content"],
    },
};

const TOOL_START_PROCESS = {
    name: "start_process",
    description: "Start a terminal process or background command.",
    inputSchema: {
        type: "object",
        properties: { command: { type: "string" }, timeout_ms: { type: "number" }, shell: { type: "string" } },
        required: ["command", "timeout_ms"],
    },
};

// Fechas que NO aparecen en ningún DATA de la traza: el modelo las inventó.
const INVENTED_DATES = ["2026-01-01", "2026-02-01", "2026-02-10", "2026-01-07"];

// ------------------------------------------------------------
// Casos
// ------------------------------------------------------------

export const testCases = [
    // ---- PLAN ----
    planCase(
        {
            id: "plan_excel_modelos_ia",
            category: "plan_formato",
            description: "Excel en carpeta del escritorio con info de dos búsquedas web",
            goal: GOAL,
            notes: "Traza: PLAN_GENERATION. La salida de producción de esa corrida pasa este caso.",
        },
        {
            minSteps: 3,
            maxSteps: 8,
            allowedRoutes: ROUTES,
            firstRoute: "web",
            requiredRoutes: ["web"],
            requiredKeywordsInGoal: ["Gemini", "GPT", "Excel", "JARVIS"],
            forbiddenKeywordsInGoal: ["csv"], // el prompt exige el formato pedido, sin sustituirlo
        }
    ),
    planCase(
        {
            id: "plan_sin_herramientas",
            category: "plan_vacio",
            description: "Charla sin herramientas: debe devolver steps vacío",
            goal: "hola, ¿cómo estás?",
            notes: "Control (no viene de la traza). El prompt pide steps: [] cuando no hay que usar herramientas.",
        },
        { allowEmpty: true, maxSteps: 0 }
    ),

    // ---- REPLAN ----
    replanCase(
        {
            id: "replan_write_xlsx_formato_invalido",
            category: "replan_recuperable",
            description: "write_file .xlsx falló por formato de contenido: debe replanificar sin repetir lo hecho",
            notes:
                "Traza: REPLAN (s4). En esa corrida gastó 4071 de 4096 tokens y producción lo descartó como truncado aunque " +
                "finish_reason=stop; el runner solo marca finish_reason=length. Revisa completion_tokens en runs.jsonl.",
            data: {
                goal: GOAL,
                completedStepsSummary: [
                    "[x] s1 Buscar información sobre el último modelo de Gemini -> 10 resultados web (2 con fecha)",
                    "[x] s2 Buscar información sobre el último modelo de GPT -> 10 resultados web (1 con fecha)",
                    `[x] s3 Crear carpeta JARVIS en el escritorio si no existe -> ${MKDIR_OK}`,
                ],
                facts: {},
                failLines: [FAIL_S4],
                effects: [EFFECT_S3],
                logLines: [LOG_S1, LOG_S2, LOG_S3, LOG_S4_ERR],
                failedStepGoal: "Escribir información recopilada en un archivo Excel en la carpeta JARVIS",
                failedStepResult: `ejecución fallida: err: ${WRITE_ERR}`,
                remainingPlanGoals: [],
                nextStepNumber: 5,
            },
        },
        {
            expectedAction: "continue",
            minSteps: 1,
            maxSteps: 4,
            allowedRoutes: ROUTES,
            effects: ["crear carpeta", "crear la carpeta", "crear directorio", "crear el directorio"],
            completedSteps: ["Buscar información sobre el último modelo"],
        }
    ),

    // ---- ARGUMENTS ----
    argsCase(
        {
            id: "args_search_gemini",
            category: "args_basico",
            description: "search: solo query, sin campos inventados",
            notes: "Traza: ARGUMENT_GENERATION s1. El prompt pide omitir opcionales no usados (max_results); hoy no hay check de 'campo ausente'.",
            goal: GOAL,
            tool: TOOL_SEARCH,
            planLines: [
                "[>] s1 Buscar información sobre el último modelo de Gemini | éxito: Obtener datos actualizados sobre el modelo más reciente de Gemini",
                "[ ] s2 Buscar información sobre el último modelo de GPT",
                "[ ] s3 Crear carpeta JARVIS en el escritorio si no existe",
                "[ ] s4 Escribir información recopilada en un archivo Excel en la carpeta JARVIS",
            ],
            taskInstruction: "Buscar información sobre el último modelo de Gemini",
        },
        { requiredFields: ["query"], noInventedFields: true }
    ),
    argsCase(
        {
            id: "args_write_file_xlsx_2d",
            category: "args_json_string",
            description: "write_file .xlsx: content debe ser string JSON de array 2D con datos de DATA",
            notes:
                "Traza: ARGUMENT_GENERATION s4. Falla real: el modelo emitió [[...]],[[...]],[[...]] (no es JSON válido) " +
                "y puso fechas inventadas. Este caso debe fallar con esa salida.",
            goal: GOAL,
            tool: TOOL_WRITE_FILE,
            logLines: [LOG_S1, LOG_S2, LOG_S3],
            planLines: [
                "(+1 pasos anteriores)",
                "[x] s2 Buscar información sobre el último modelo de GPT -> 10 resultados web (1 con fecha)",
                `[x] s3 Crear carpeta JARVIS en el escritorio si no existe -> ${MKDIR_OK}`,
                "[>] s4 Escribir información recopilada en un archivo Excel en la carpeta JARVIS | éxito: Archivo Excel creado con datos de ambos modelos",
            ],
            effects: [EFFECT_S3],
            refs: [
                "ref:r1 search último modelo de Gemini (3.6KB)",
                "ref:r2 search último modelo de GPT (3.7KB)",
                `ref:r3 create_directory ${JARVIS_DIR} (60B)`,
            ],
            dataObs: DATA_OBS,
            lastObs: { stepId: "s3", toolName: "create_directory", obsText: MKDIR_OK },
            taskInstruction:
                `Escribir información recopilada en un archivo Excel en la carpeta JARVIS\n` +
                `[HANDOFF s3 (create_directory)]: ${MKDIR_OK} [ref:r3]`,
        },
        {
            requiredFields: ["path", "content"],
            noInventedFields: true,
            // la ruta debe partir del escritorio de ENV; el nombre del archivo es libre
            forbiddenHardcodedValues: ["<user>", "%USERPROFILE%", "Documents", "Downloads", ...INVENTED_DATES],
            jsonStringFields: [{ field: "content", shape: "array2d", includes: ["Gemini 3.5 Flash", "GPT"] }],
        }
    ),
    argsCase(
        {
            id: "args_start_process_script_excel",
            category: "args_sin_inventar",
            description: "start_process con script Python: no debe inventar valores fuera de DATA/FACTS",
            notes:
                "Traza: ARGUMENT_GENERATION s5. Falla real: escribió 2026-02-10 y 2026-01-07, que no están en DATA " +
                "(el prompt pide N/D para lo que no consta). Este caso debe fallar con esa salida.",
            goal: GOAL,
            tool: TOOL_START_PROCESS,
            logLines: [LOG_S1, LOG_S2, LOG_S3, LOG_S4_ERR],
            planLines: [
                "(+1 pasos anteriores)",
                "[x] s2 Buscar información sobre el último modelo de GPT -> 10 resultados web (1 con fecha)",
                `[x] s3 Crear carpeta JARVIS en el escritorio si no existe -> ${MKDIR_OK}`,
                `[>] s5 Generar el archivo Excel con la información recopilada sobre los últimos modelos de Gemini y GPT usando un script Python. | éxito: Archivo modelos_ia.xlsx creado en ${JARVIS_DIR} con datos estructurados.`,
                "[ ] s6 Verificar que el archivo Excel se creó correctamente y contiene los datos esperados.",
            ],
            failLines: [FAIL_S4],
            effects: [EFFECT_S3],
            refs: [
                "ref:r1 search último modelo de Gemini (3.6KB)",
                "ref:r2 search último modelo de GPT (3.7KB)",
                `ref:r3 create_directory ${JARVIS_DIR} (60B)`,
                `ref:r4 write_file ${XLSX} (93B)`,
            ],
            dataObs: DATA_OBS,
            lastObs: { stepId: "s4", toolName: "write_file", obsText: WRITE_ERR },
            taskInstruction: "Generar el archivo Excel con la información recopilada sobre los últimos modelos de Gemini y GPT usando un script Python.",
        },
        {
            requiredFields: ["command", "timeout_ms"],
            noInventedFields: true,
            forbiddenHardcodedValues: ["<user>", "%USERPROFILE%", ...INVENTED_DATES],
        }
    ),

    // ---- FINAL_RESPONSE ----
    finalCase(
        {
            id: "final_abort_excel_no_creado",
            category: "final_tarea_incompleta",
            description: "Tarea detenida: debe explicar qué se logró, qué falta y qué cambió en el entorno",
            notes:
                "Traza: FINAL_RESPONSE. La respuesta real atribuyó el truncado a s5 (fue el replan) y presentó fechas sin respaldo " +
                "como hallazgos; ninguna de las dos cosas se puede expresar con las expectativas actuales (ver CASES_GUIDE.md).",
            data: {
                goal: GOAL,
                logLines: [
                    LOG_S1,
                    LOG_S2,
                    LOG_S3,
                    LOG_S4_ERR,
                    `s5|start_process python -c "import pandas as pd; df = pd.DataFrame({'Model...|rej|pid=36720, status=finished | sin salida`,
                ],
                facts: { pid: "36720" },
                failLines: [FAIL_S4, "s5|start_process|ejecutada; resultado no aprobado"],
                effects: [
                    EFFECT_S3,
                    `s5|start_process command=python -c "import pandas as pd; df = pd.DataFrame({'Modelo': ['Gemini 3.5 Flash', 'GPT-5'], 'Fecha': ['2026-02-10', '2026-01-07']}); df.to_excel(r'${XLSX}', index=False)" timeout_ms=30000 shell=powershell: pid=36720, status=finished | sin salida`,
                ],
                evidenceSummaries: [
                    `search último modelo de Gemini: ${GEMINI_SEARCH}`,
                    `search último modelo de GPT: ${GPT_SEARCH}`,
                    `create_directory: ${MKDIR_OK}`,
                    `write_file: ${WRITE_ERR}`,
                    "start_process: Process started with PID 36720 (shell: powershell)\nInitial output:\n\n✅ Process 36720 has finished execution",
                ],
                abortReason: "Replan: [Qwen Validation] replan: la salida se truncó por el límite de tokens",
            },
        },
        {
            minChars: 200,
            mustContainFacts: ["Gemini 3.5 Flash", "JARVIS"],
            mustMentionEffects: ["JARVIS"],
        }
    ),
];