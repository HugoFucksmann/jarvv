import type { QwenTestCase } from "../core/qwenTypes.ts";
import { PROMPTS } from "../../../src/core/reasoner/prompts.ts";
import toolSchemas from "../tool_schemas.json" with { type: "json" };

export const qwenCases: QwenTestCase[] = [
  // ==========================================
  // ETAPA 1: PLAN (Planificación inicial con thinking)
  // ==========================================
  {
    id: "qwen-plan-01-multi-step",
    stage: "plan",
    category: "workflow_composition",
    description: "Descomponer pedido de búsqueda de errores y backup en pasos válidos",
    input: {
      system: PROMPTS.PLAN.SYSTEM,
      user: PROMPTS.PLAN.buildUserPrompt(
        "Buscar todos los archivos .log en C:\\app\\logs que contengan 'ERROR', guardarlos en un zip en el escritorio y listar el contenido del zip",
        undefined,
        "- files: operaciones con archivos y carpetas locales (leer, escribir, mover, eliminar, listar)\n- locate: búsqueda de archivos por nombre o patrón en el disco\n- terminal: ejecución de comandos de consola o scripts\n- web: búsqueda y consultas de información en línea"
      ),
      thinking: true,
    },
    expect: {
      plan: {
        minSteps: 2,
        maxSteps: 5,
        allowedRoutes: ["files", "locate", "terminal", "web"],
        requiredKeywordsInGoal: ["log"],
      },
    },
    notes: "Requiere pasos ordenados entre locate/terminal/files sin inventar rutas externas",
  },
  {
    id: "qwen-plan-02-direct-answer-empty",
    stage: "plan",
    category: "no_tools_needed",
    description: "Pregunta conversacional que no requiere herramientas debe devolver steps vacíos",
    input: {
      system: PROMPTS.PLAN.SYSTEM,
      user: PROMPTS.PLAN.buildUserPrompt(
        "¿Cuál es la diferencia conceptual entre una promesa y un callback en JavaScript?",
        undefined,
        "- files: operaciones de archivos\n- locate: búsqueda\n- terminal: ejecución\n- web: búsqueda en línea"
      ),
      thinking: true,
    },
    expect: {
      plan: {
        minSteps: 0,
        maxSteps: 0,
        allowEmpty: true,
      },
    },
    notes: "No debe inventar pasos si la solicitud es una respuesta conceptual o conversacional",
  },
  {
    id: "qwen-plan-03-web-download-extract",
    stage: "plan",
    category: "workflow_web_to_local",
    description: "Buscar un driver en la web, descargarlo y moverlo",
    input: {
      system: PROMPTS.PLAN.SYSTEM,
      user: PROMPTS.PLAN.buildUserPrompt(
        "Buscar el driver de impresora HP LaserJet 1020 en la web oficial y guardarlo en C:\\Drivers",
        undefined,
        "- files: operaciones con archivos y carpetas locales\n- locate: búsqueda de archivos en el disco\n- terminal: ejecución de comandos o scripts\n- web: búsqueda y consultas de información en línea"
      ),
      thinking: true,
    },
    expect: {
      plan: {
        minSteps: 2,
        maxSteps: 4,
        allowedRoutes: ["files", "web", "terminal"],
      },
    },
    notes: "Debe usar web primero y luego files/terminal para persistir el archivo",
  },

  // ==========================================
  // ETAPA 2: REPLAN (Replanificación localizada)
  // ==========================================
  {
    id: "qwen-replan-01-missing-file-alternative",
    stage: "replan",
    category: "recoverable_step_failure",
    description: "Fallo al leer archivo inexistente; debe continuar buscando en otra ruta o listar",
    input: {
      system: PROMPTS.REPLAN.SYSTEM,
      user: PROMPTS.REPLAN.buildUserPrompt({
        goal: "Extraer el token de API desde config.json en C:\\project y guardarlo en env",
        completedStepsSummary: [],
        facts: { "os": "windows" },
        failLines: ["read_file C:\\project\\config.json: ENOENT no such file or directory"],
        failedStepGoal: "Leer config.json en C:\\project",
        failedStepResult: "Error: ENOENT: no such file or directory, open 'C:\\project\\config.json'",
        remainingPlanGoals: ["Guardar token extraído en variable de entorno"],
        nextStepNumber: 2,
      }),
      thinking: true,
    },
    expect: {
      replan: {
        expectedAction: "continue",
        minSteps: 1,
        maxSteps: 4,
        allowedRoutes: ["files", "locate", "terminal"],
      },
    },
    notes: "Debe proponer localizar o buscar el archivo antes de abortar",
  },
  {
    id: "qwen-replan-02-unrecoverable-abort",
    stage: "replan",
    category: "unrecoverable_failure",
    description: "Paso fallido irrecuperable por credenciales denegadas permanentemente; debe abortar",
    input: {
      system: PROMPTS.REPLAN.SYSTEM,
      user: PROMPTS.REPLAN.buildUserPrompt({
        goal: "Desplegar release a producción mediante AWS CLI",
        completedStepsSummary: ["Build compilado con éxito en C:\\project\\dist"],
        facts: { "build": "ok" },
        effects: ["Se generó C:\\project\\dist\\bundle.js"],
        failLines: ["aws s3 sync falló con error: AccessDenied (403): Invalid Client Token or Account Suspended"],
        failedStepGoal: "Subir artefactos a AWS S3",
        failedStepResult: "Fatal Error: AccessDenied: Account is suspended by admin. Cannot proceed.",
        remainingPlanGoals: ["Invalidar CDN CloudFront"],
        nextStepNumber: 3,
      }),
      thinking: true,
    },
    expect: {
      replan: {
        expectedAction: "abort",
      },
    },
    notes: "Al ser un fallo permanente de cuenta suspendida, debe abortar y reportar el motivo",
  },
  {
    id: "qwen-replan-03-respect-effects",
    stage: "replan",
    category: "do_not_repeat_effects",
    description: "Replan no debe repetir pasos cuyos efectos ya se hayan aplicado",
    input: {
      system: PROMPTS.REPLAN.SYSTEM,
      user: PROMPTS.REPLAN.buildUserPrompt({
        goal: "Crear carpeta backup, mover reporte.csv y convertirlo a xlsx",
        completedStepsSummary: [],
        facts: {},
        effects: [
          "Carpeta creada: C:\\backup",
          "Archivo movido: C:\\backup\\reporte.csv",
        ],
        failLines: ["python convert.py falló con ModuleNotFoundError: No module named 'openpyxl'"],
        failedStepGoal: "Ejecutar script convert.py para transformar reporte.csv a xlsx",
        failedStepResult: "ModuleNotFoundError: No module named 'openpyxl'",
        remainingPlanGoals: ["Confirmar archivo xlsx"],
        nextStepNumber: 2,
      }),
      thinking: true,
    },
    expect: {
      replan: {
        expectedAction: "continue",
        minSteps: 1,
        maxSteps: 3,
        mustNotRepeatEffects: true,
        effects: ["crear carpeta backup", "mover reporte.csv"],
      },
    },
    notes: "Debe instalar el módulo o usar script alternativo sin volver a crear la carpeta o mover el archivo",
  },

  // ==========================================
  // ETAPA 3: ARGUMENTS (Generación de argumentos para Tools)
  // ==========================================
  {
    id: "qwen-args-01-read-file-schema",
    stage: "arguments",
    category: "schema_compliance",
    description: "read_file debe respetar path obligatorio y tipos del schema",
    input: {
      system: PROMPTS.ARGUMENTS.SYSTEM,
      user: PROMPTS.ARGUMENTS.buildUserPrompt({
        tool: {
          name: "read_file",
          description: "Reads the content of a file from disk or url.",
        },
        cleanedSchema: (toolSchemas as Record<string, any>)["read_file"],
        environment: {
          HOME: "C:\\Users\\hugof",
          DESKTOP: "C:\\Users\\hugof\\Desktop",
        },
        goal: "Leer el archivo notas.txt que está en el Escritorio",
        taskInstruction: "Lee las primeras líneas de notas.txt en el escritorio",
        facts: {},
        logLines: [],
        planLines: [],
        failLines: [],
      }),
      schema: (toolSchemas as Record<string, any>)["read_file"],
      thinking: false,
    },
    expect: {
      arguments: {
        tool: "read_file",
        requiredFields: ["path"],
        exactFieldValues: {
          path: "C:\\Users\\hugof\\Desktop\\notas.txt",
        },
        noInventedFields: true,
      },
    },
    notes: "Debe usar el path resuelto desde ENV sin inventar propiedades adicionales",
  },
  {
    id: "qwen-args-02-write-file-ref-replacement",
    stage: "arguments",
    category: "reference_preservation",
    description: "write_file debe utilizar el marcador {{ref:rX}} y no volcar contenido inventado",
    input: {
      system: PROMPTS.ARGUMENTS.SYSTEM,
      user: PROMPTS.ARGUMENTS.buildUserPrompt({
        tool: {
          name: "write_file",
          description: "Write text content to a file",
        },
        cleanedSchema: (toolSchemas as Record<string, any>)["write_file"],
        environment: {
          HOME: "C:\\Users\\hugof",
          DESKTOP: "C:\\Users\\hugof\\Desktop",
        },
        goal: "Guardar el resultado de la búsqueda web anterior en C:\\Users\\hugof\\Desktop\\resumen.txt",
        taskInstruction: "Escribe el contenido completo del resultado anterior en resumen.txt",
        facts: {},
        refs: ["ref:r1 = salida completa del comando curl (14500 bytes)"],
        logLines: [],
        planLines: [],
        failLines: [],
      }),
      schema: (toolSchemas as Record<string, any>)["write_file"],
      thinking: false,
    },
    expect: {
      arguments: {
        tool: "write_file",
        requiredFields: ["path", "content"],
        exactFieldValues: {
          path: "C:\\Users\\hugof\\Desktop\\resumen.txt",
          content: "{{ref:r1}}",
        },
        allowedRefTokens: ["{{ref:r1}}"],
        noInventedFields: true,
      },
    },
    notes: "Obligatorio usar {{ref:r1}} en content",
  },
  {
    id: "qwen-args-03-start-process-types",
    stage: "arguments",
    category: "type_and_enum_validation",
    description: "start_process requiere timeout_ms como número y command como string",
    input: {
      system: PROMPTS.ARGUMENTS.SYSTEM,
      user: PROMPTS.ARGUMENTS.buildUserPrompt({
        tool: {
          name: "start_process",
          description: "Starts a background process or terminal execution",
        },
        cleanedSchema: (toolSchemas as Record<string, any>)["start_process"],
        environment: {
          HOME: "C:\\Users\\hugof",
        },
        goal: "Ejecutar npm test con un timeout de 30 segundos",
        taskInstruction: "Corre npm test con 30000 ms de timeout",
        facts: {},
        logLines: [],
        planLines: [],
        failLines: [],
      }),
      schema: (toolSchemas as Record<string, any>)["start_process"],
      thinking: false,
    },
    expect: {
      arguments: {
        tool: "start_process",
        requiredFields: ["command", "timeout_ms"],
        exactFieldValues: {
          command: "npm test",
          timeout_ms: 30000,
        },
      },
    },
    notes: "timeout_ms debe ser tipo number (30000), no string '30000'",
  },

  // ==========================================
  // ETAPA 4: FINAL_RESPONSE (Respuesta al usuario)
  // ==========================================
  {
    id: "qwen-final-01-factual-delivery",
    stage: "final_response",
    category: "facts_retention_no_hallucination",
    description: "Entregar los datos exactos pedidos sin inventar información no presente en FACTS/EVID",
    input: {
      system: PROMPTS.FINAL_RESPONSE.SYSTEM,
      user: PROMPTS.FINAL_RESPONSE.buildUserPrompt({
        goal: "¿Cuál es el puerto de base de datos y usuario encontrados en app.env?",
        logLines: ["read_file C:\\app\\.env: leído OK"],
        facts: {
          "DB_PORT": "5432",
          "DB_USER": "admin_prod",
        },
        failLines: [],
        evidenceSummaries: ["Contenido .env: DB_PORT=5432, DB_USER=admin_prod, DB_HOST=db.internal"],
      }),
      thinking: false,
    },
    expect: {
      final_response: {
        mustContainFacts: ["5432", "admin_prod"],
        forbiddenHallucinations: ["3306", "root", "password123"],
        minChars: 30,
      },
    },
    notes: "Debe responder con 5432 y admin_prod sin inventar contraseñas o puertos por defecto",
  },
  {
    id: "qwen-final-02-aborted-task-explanation",
    stage: "final_response",
    category: "aborted_task_clarity",
    description: "Cuando la tarea fue abortada, debe explicar el motivo claro y reportar los efectos persistidos",
    input: {
      system: PROMPTS.FINAL_RESPONSE.SYSTEM,
      user: PROMPTS.FINAL_RESPONSE.buildUserPrompt({
        goal: "Actualizar la versión de Node en el servidor y migrar la base de datos",
        logLines: [
          "nvm install 20 -> OK",
          "npm run migrate -> FAILED (Conexión rechazada al host 10.0.0.5)",
        ],
        facts: { "node_version": "20.11.0" },
        effects: ["Node.js actualizado a la versión 20.11.0"],
        failLines: ["ECONNREFUSED 10.0.0.5:5432"],
        evidenceSummaries: ["Migración abortada por caída del cluster de postgres"],
        abortReason: "Cluster de base de datos 10.0.0.5 no responde a solicitudes de conexión",
      }),
      thinking: false,
    },
    expect: {
      final_response: {
        mustMentionAbortReason: true,
        mustMentionEffects: ["Node.js", "20.11.0"],
        minChars: 50,
      },
    },
    notes: "Debe aclarar que no se completó la migración por caída de BD pero Node sí quedó actualizado",
  },
];
