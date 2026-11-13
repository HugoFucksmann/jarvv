/** Casos de la evaluación de web_search: pregunta, términos "ideales" (lo que escribiría un buen modelo) y respuesta esperada. */
export interface Case {
  readonly id: string;
  readonly need: string;
  /** Palabras clave en el idioma de las fuentes (el `terms` ideal). */
  readonly terms: readonly string[];
  /** La respuesta correcta aparece en el texto (null: la respuesta NO existe y lo correcto es no_found). */
  readonly gold: RegExp | null;
  /** Una respuesta vieja o falsa que no debería aparecer. */
  readonly bad?: RegExp;
  readonly note?: string;
}

export const CASES: readonly Case[] = [
  { id: "node22", need: "¿cuándo salió Node 22?", terms: ["Node.js 22", "release date", "April 2024"], gold: /2024-04-24|April 24,? 2024|24 de abril de 2024|2024\/4\/24/i },
  { id: "py312", need: "When was Python 3.12 released?", terms: ["Python 3.12", "release date"], gold: /October 2,? 2023|2023-10-02|2 de octubre de 2023|2023\/10\/2\b/i },
  { id: "fastapi", need: "latest fastapi version", terms: ["fastapi", "latest release", "PyPI"], gold: /0\.16\d\.\d+/, bad: /0\.136\.1/, note: "registro PyPI vs. blogs viejos" },
  { id: "australia", need: "¿cuál es la capital de Australia?", terms: ["capital of Australia"], gold: /Canberra/i },
  { id: "rust", need: "¿quién creó el lenguaje de programación Rust?", terms: ["Rust programming language", "creator", "Graydon Hoare"], gold: /Graydon Hoare/i },
  { id: "mundial", need: "¿quién ganó el mundial de fútbol de 2022?", terms: ["2022 FIFA World Cup winner"], gold: /Argentin/i },
  { id: "postgres", need: "¿cuál es el puerto por defecto de PostgreSQL?", terms: ["PostgreSQL", "default port"], gold: /\b5432\b/ },
  { id: "py39", need: "is python 3.9 still supported?", terms: ["Python 3.9", "end of life", "support"], gold: /end[- ]of[- ]life|EOL|2025-10|October 2025|no longer|unsupported/i },
  { id: "cve", need: "what is CVE-2024-3094?", terms: ["CVE-2024-3094"], gold: /xz|liblzma/i },
  { id: "dynamodb", need: "¿cuál es el tamaño máximo de un item en DynamoDB?", terms: ["DynamoDB", "maximum item size"], gold: /400 ?KB/i, note: "pregunta en español, fuentes en inglés" },
  { id: "ts5", need: "when was TypeScript 5.0 released?", terms: ["TypeScript 5.0", "release", "March 2023"], gold: /March 16,? 2023|2023-03-16|2023\/3\/16|March 2023/i },
  { id: "react19", need: "¿cuándo se lanzó React 19?", terms: ["React 19", "stable release", "December 2024"], gold: /December 5,? 2024|2024-12-05|5 de diciembre de 2024|2024\/12\/5\b/i },
  // ── Casos "de detalle": el dato suele estar en el cuerpo de la página, no en el extracto del buscador.
  { id: "pgconn", need: "what is the default value of max_connections in PostgreSQL?", terms: ["PostgreSQL", "max_connections", "default"], gold: /default is typically 100|Default:\s*\|\s*`?100`?/i },
  { id: "lambda", need: "¿cuál es el tamaño máximo descomprimido de un paquete de despliegue de AWS Lambda?", terms: ["AWS Lambda", "deployment package", "unzipped size limit"], gold: /250 ?MB/i },
  { id: "ghrate", need: "how many requests per hour can an authenticated user make to the GitHub REST API?", terms: ["GitHub REST API", "rate limit", "authenticated requests per hour"], gold: /5,?000 requests/i },
  { id: "fscp", need: "¿en qué versión de Node.js se agregó fs.cp?", terms: ["Node.js", "fs.cp", "added in"], gold: /v16\.7\.0/ },
  { id: "sqlite", need: "what is the maximum size of a SQLite database?", terms: ["SQLite", "limits", "maximum database size"], gold: /140 terabytes|281 terabytes|256 tebibytes|128 tibibytes|281 TB|256 TiB/i },
  { id: "docker", need: "¿cuál es la subred por defecto de la red bridge de Docker?", terms: ["Docker", "default bridge network", "subnet"], gold: /172\.17\.0\.0\/16/ },
  { id: "redisttl", need: "what does the Redis EXPIRE command return when the key does not exist?", terms: ["Redis", "EXPIRE", "return value"], gold: /\b0\b[^.\n]{0,60}(?:does not exist|doesn.t exist|could not be set|not set)|Integer reply:?\s*`?0/i },
  // ── Ampliación (ronda 2): detalle de documentación, dato que cambió (SQS), sin respuesta.
  { id: "nginx", need: "what is the default value of worker_connections in nginx?", terms: ["nginx", "worker_connections", "default"], gold: /worker_connections\s+512|default:?\s*`?worker_connections\s+512|\b512\b/i },
  { id: "swappiness", need: "what is the default value of vm.swappiness on Linux?", terms: ["vm.swappiness", "default value", "Linux"], gold: /swappiness[^.\n]{0,120}\b60\b|\b60\b[^.\n]{0,120}swappiness/i },
  { id: "hikari", need: "what is the default maximumPoolSize in HikariCP?", terms: ["HikariCP", "maximumPoolSize", "default"], gold: /maximumPoolSize[^\n]{0,250}\b10\b/i },
  { id: "nodeport", need: "¿cuál es el rango de puertos por defecto de un servicio NodePort en Kubernetes?", terms: ["Kubernetes", "NodePort", "default port range"], gold: /30000\s*[-–]\s*32767/ },
  { id: "rabbit", need: "¿en qué puerto escucha RabbitMQ para AMQP por defecto?", terms: ["RabbitMQ", "AMQP", "default port"], gold: /\b5672\b/ },
  { id: "http429", need: "what HTTP status code means Too Many Requests?", terms: ["HTTP status code", "Too Many Requests"], gold: /\b429\b/ },
  { id: "sqlitepage", need: "what is the default page size of SQLite?", terms: ["SQLite", "default page_size"], gold: /\b4096\b|4 ?KiB/i },
  { id: "s3obj", need: "¿cuál es el tamaño máximo de un objeto en Amazon S3?", terms: ["Amazon S3", "maximum object size"], gold: /5 ?(?:TB|TiB|terabytes)/i },
  { id: "kafka", need: "what is the default message.max.bytes in Kafka?", terms: ["Kafka", "message.max.bytes", "default"], gold: /1048588|1 ?MB|1 ?MiB/i },
  { id: "sqs", need: "what is the maximum message size in Amazon SQS?", terms: ["Amazon SQS", "maximum message size"], gold: /1 ?MiB|1,?048,?576/i, bad: /256 ?(?:KiB|KB)/i, note: "subió de 256 KiB a 1 MiB en 2025: mide datos viejos" },
  { id: "py314", need: "¿qué versión de Python se lanzó en octubre de 2025?", terms: ["Python 3.14", "release"], gold: /3\.14/ },
  { id: "iphone", need: "when was the first iPhone released?", terms: ["first iPhone", "release date"], gold: /June 29,? 2007|2007-06-29|29 de junio de 2007/i },
  { id: "nocat", need: "what is the favorite color of Guido van Rossum's cat?", terms: ["Guido van Rossum", "cat", "favorite color"], gold: null, note: "sin respuesta" },
  { id: "nofunc", need: "¿cuántas líneas tiene la función foo_bar_baz_9271 del kernel de Linux?", terms: ["foo_bar_baz_9271", "Linux kernel"], gold: null, note: "sin respuesta" },
  { id: "notown", need: "what was the exact population of the town of Xyzzyville in 1850?", terms: ["Xyzzyville", "population 1850"], gold: null, note: "sin respuesta" },
  { id: "nofast", need: "¿qué versión de fastapi se publicó el 3 de febrero de 1999?", terms: ["fastapi", "release 1999"], gold: null, note: "sin respuesta (premisa imposible)" },
  // ── Ronda 3: preguntas de "lo más reciente" (las dos primeras salieron de un uso real). Las respuestas esperadas se fijaron leyendo las fuentes capturadas el 2026-11-13.
  { id: "lastgpt", need: "¿Cuál es el último modelo de GPT disponible?", terms: [], gold: /GPT[-‑ ]?6/i, bad: /GPT[-‑ ]?4o\b/i, note: "recencia: GPT-6 (sep 2026) es posterior a GPT-5.6; el gold inicial era viejo" },
  { id: "lastgemini", need: "¿Cuál es el último modelo de Gemini disponible?", terms: [], gold: /gemini[- ]4|Gemini 4 Argon|gemini-3\.8/i, bad: /2\.0 Flash, nuestro último modelo/i, note: "recencia: la traza real eligió una entrada vieja" },
  { id: "lastclaude", need: "what is the latest Claude model from Anthropic?", terms: [], gold: /(?:Opus|Sonnet|Haiku|Mythos)[ -]5[.-][15]|claude-(?:opus|sonnet|haiku|mythos)-5-/i, note: "recencia" },
  { id: "lastpython", need: "what is the latest stable version of Python?", terms: [], gold: /3\.15(?:\.\d+)?/, note: "recencia" },
  { id: "lastnodelts", need: "¿cuál es la versión LTS actual de Node.js?", terms: [], gold: /(?:Node(?:\.js)?|v)\s?26\b|\b26\.\d/i, note: "recencia" },
  { id: "dog", need: "¿cómo se llama el perro de Ryan Dahl, el creador de Node.js?", terms: ["Ryan Dahl", "dog name"], gold: null, note: "no existe: lo correcto es no encontrar" },
];
