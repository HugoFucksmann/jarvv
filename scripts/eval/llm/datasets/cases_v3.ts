import type { LlmTestCase } from "../core/types.ts";

// Parte `plan` de cases_v3.ts. Pegar junto con los helpers de cases_v2.ts (ENV, DESK, DOCS, planCase).
// Dificultad en el id: easy | med | hard.
// Origen: 2 trazas reales de JARVIS (pedido "excel con ultimo modelo de gemini y gpt").

const ENV = { desktop: "C:\\Users\\hugof\\Desktop", documents: "C:\\Users\\hugof\\Documents" };
const DESK = ENV.desktop;
const DOCS = ENV.documents;

const planCase = (
    id: string, category: string, description: string, goal: string,
    plan: NonNullable<LlmTestCase["expect"]["plan"]>,
    extra: { chatContext?: string; modificationFeedback?: string; existingPlanSummary?: string } = {},
    notes?: string,
): LlmTestCase => ({
    id, stage: "plan", category, description,
    input: { prompt: { stage: "plan", goal, ...extra } },
    expect: { plan }, notes,
});

export const plan: LlmTestCase[] = [
    planCase("v3-plan-easy-01-xlsx-direct", "format_fidelity",
        "Excel con datos dados por el usuario: files directo, sin web ni terminal",
        `Crea un Excel en ${DESK} llamado modelos.xlsx con las columnas modelo y empresa, y una fila: Gemini, Google`,
        { minSteps: 1, maxSteps: 2, allowedRoutes: ["files"], forbiddenKeywordsInGoal: ["csv", "python"] },
        {}, "write_file ya escribe xlsx desde JSON 2D; no hace falta terminal."),

    planCase("v3-plan-easy-02-no-tools-models", "no_tools_needed",
        "Pregunta conceptual sobre modelos de IA: steps vacío",
        "Explícame brevemente qué diferencia hay entre un modelo Flash y un modelo Pro",
        { minSteps: 0, maxSteps: 0, allowEmpty: true }),

    planCase("v3-plan-med-01-two-lookups-then-xlsx", "workflow_composition",
        "Traza real: dos búsquedas separadas (Gemini y GPT), carpeta y Excel; la web va antes de escribir",
        "crea un excel en la carpeta JARVIS del escritorio con la informacion del ultimo modelo de gemini y de GPT",
        {
            minSteps: 3, maxSteps: 6, allowedRoutes: ["web", "files"], requiredRoutes: ["web", "files"], firstRoute: "web",
            requiredKeywordsInGoal: ["gemini", "gpt"], forbiddenKeywordsInGoal: ["csv"]
        },
        {}, "Ambas trazas: el plan original fue razonable; el fallo vino después. Este caso fija la línea base."),

    planCase("v3-plan-med-02-fetch-source", "workflow_composition",
        "Pedir datos exactos (fecha de lanzamiento) exige leer la fuente, no solo snippets",
        `Busca cuándo salió el último modelo de GPT, lee la página oficial y guarda la fecha en ${DOCS}\\gpt.xlsx`,
        { minSteps: 3, maxSteps: 6, allowedRoutes: ["web", "files"], requiredRoutes: ["web", "files"], firstRoute: "web" },
        {}, "Traza 1: el search avisa que los snippets no son la fuente y el modelo escribió fechas inventadas."),

    planCase("v3-plan-med-03-explicit-python", "terminal_usage",
        "El usuario pide explícitamente python para generar el xlsx: terminal permitida",
        `Genera con un script de python un Excel en ${DESK}\\jarvis\\datos.xlsx con las columnas a, b y c`,
        { minSteps: 1, maxSteps: 3, allowedRoutes: ["terminal", "files"], requiredRoutes: ["terminal"], forbiddenKeywordsInGoal: ["csv"] }),

    planCase("v3-plan-hard-01-modify-add-sheet", "plan_modification",
        "Feedback del usuario sobre un plan de Excel: agregar hoja de fuentes sin perder la búsqueda",
        "crea un excel en la carpeta JARVIS del escritorio con la informacion del ultimo modelo de gemini y de GPT",
        { minSteps: 3, maxSteps: 7, allowedRoutes: ["web", "files"], requiredRoutes: ["web", "files"], requiredKeywordsInGoal: ["fuente"] },
        {
            existingPlanSummary: "1. [web] Buscar el último modelo de Gemini\n2. [web] Buscar el último modelo de GPT\n3. [files] Crear carpeta JARVIS en el escritorio\n4. [files] Escribir el Excel con ambos modelos",
            modificationFeedback: "Agrega una segunda hoja con las URLs de las fuentes",
        }),

    planCase("v3-plan-hard-02-prior-failure-in-chat", "ambiguity_safety",
        "El chat menciona un intento previo fallido: el plan debe seguir pidiendo xlsx, sin cambiar de formato",
        "vuelve a intentarlo",
        { minSteps: 1, maxSteps: 4, allowedRoutes: ["files", "terminal", "web"], forbiddenKeywordsInGoal: ["csv"] },
        { chatContext: "Usuario: crea un excel en la carpeta JARVIS del escritorio con el ultimo modelo de gemini y de GPT\nJARVIS: no se pudo crear el archivo modelos_ia.xlsx" },
        "Dependencia de contexto: sin chatContext el pedido es inejecutable."),
];