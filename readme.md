<div align="center">

# ✦ JARVIS

### Tu asistente local: le hablás, actúa en tu computadora y vos mantenés el control.

<br>

![Local first](https://img.shields.io/badge/100%25-local-2ea44f?style=for-the-badge)
![Guard](https://img.shields.io/badge/seguridad-determinista-0969da?style=for-the-badge)
![MCP](https://img.shields.io/badge/herramientas-MCP-8250df?style=for-the-badge)
![Versión](https://img.shields.io/badge/versi%C3%B3n-0.6.0-orange?style=for-the-badge)
![Licencia](https://img.shields.io/badge/licencia-MIT-lightgrey?style=for-the-badge)

![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React_19-20232a?logo=react&logoColor=61dafb)
![Tailwind](https://img.shields.io/badge/Tailwind_4-0f172a?logo=tailwindcss&logoColor=38bdf8)
![Node](https://img.shields.io/badge/Node.js_20+-339933?logo=nodedotjs&logoColor=white)
![Ollama](https://img.shields.io/badge/Ollama-000000?logo=ollama&logoColor=white)

</div>

<br>

JARVIS convierte instrucciones en lenguaje natural en acciones reales: busca archivos, ejecuta comandos, consulta la web y te devuelve una respuesta clara. Piensa con modelos que corren **en tu propia máquina**, y antes de tocar tu sistema pasa por un guardián de reglas fijas que ningún modelo puede saltarse.

> *"Buscá el contrato de marzo y resumilo."*
> *"Listá lo que hay en esta carpeta."*
> *"Averiguá cuál es la última versión de esa librería."*

Mientras trabaja, vas viendo en la interfaz cada paso, cada herramienta y cada decisión. Y si una operación modifica algo, espera tu aprobación.

---

## ✨ Lo que lo hace especial

<table>
<tr>
<td width="50%" valign="top">

### 🏠 Local por diseño
Los modelos corren en tu equipo con [Ollama](https://ollama.com). Tus instrucciones y tus archivos no viajan a ningún servicio de IA. El servidor escucha solo en `127.0.0.1` y rechaza cualquier petición con `Host` u `Origin` que no sea local.

</td>
<td width="50%" valign="top">

### 🛡️ Seguridad que no depende de un prompt
**Guard** aplica reglas fijas antes de cada acción. Lo destructivo (`rm -rf /`, `format c:`, `mkfs`…) se **deniega siempre**. Escribir, ejecutar, descargar o cambiar configuración **pide tu aprobación cada vez**: aprobar una operación no autoriza la siguiente.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🧭 Dos modos, según la tarea
**`reactive`**: elige y ejecuta paso a paso, verificando cada resultado.
**`deliberative`**: planifica primero y **te pide confirmar el plan**; podés aceptarlo, rechazarlo o pedir cambios.
Si un paso falla, se recupera con un plan nuevo (hasta dos veces) o te pregunta lo que le falta.

</td>
<td width="50%" valign="top">

### 🧩 Modelos chicos, cada uno en lo suyo
Un modelo de **decisión** (`d3:2b`) elige rutas y herramientas y verifica resultados. Un modelo **generativo** (`qwen3.5:4b`) planifica, arma los argumentos y redacta la respuesta. Ambos con contextos acotados de 16 384 tokens.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🔭 Todo a la vista
La interfaz se actualiza en vivo (Server-Sent Events): el plan, los pasos, las herramientas que se llaman, las aprobaciones pendientes y la respuesta final aparecen a medida que ocurren.

</td>
<td width="50%" valign="top">

### 🎯 Resultados honestos
Cada tarea termina en un estado explícito (`completed`, `partial`, `failed` o `cancelled`) y, si no se completó, con el motivo. Un logro parcial se informa como parcial, y si un modelo no responde, JARVIS lo dice en lugar de inventar.

</td>
</tr>
</table>

### 🧰 Un catálogo cerrado de herramientas

JARVIS solo ofrece a los modelos las herramientas catalogadas, agrupadas en cuatro destinos. Lo que un servidor MCP exponga y no figure en el catálogo, no se ofrece.

| | Destino | Para qué |
|:-:|---|---|
| 📁 | `files` | Leer, crear, guardar y mover archivos y carpetas; listar una carpeta |
| 🔎 | `locate` | Encontrar archivos por nombre o por texto interno cuando no sabés dónde están |
| ⌨️ | `terminal` | Ejecutar comandos y programas, leer su salida y enviarles entrada |
| 🌐 | `web` | Buscar información en línea y leer páginas web |

Se ejecutan mediante el protocolo [MCP](https://modelcontextprotocol.io) con [Desktop Commander](https://github.com/wonderwhy-er/DesktopCommanderMCP) y [Free Search](https://pypi.org/project/free-search-mcp/).

### 📏 Y se puede medir

JARVIS trae su propio laboratorio de evaluación: mide prompts y modelos contra casos congelados y compara variantes antes de tocar producción. → [`eval/README.md`](eval/README.md)

---

## 🚀 Puesta en marcha

### Requisitos

| | Requisito | Para qué |
|:-:|---|---|
| 🟢 | [Node.js](https://nodejs.org) 22.12 o superior | Servidor, interfaz y Desktop Commander (que se instala con `npm install` y se lanza con `node`) |
| 🦙 | [Ollama](https://ollama.com) en ejecución | Modelos `qwen3.5:4b` y `d3:2b` |
| 🐍 | [uv](https://docs.astral.sh/uv/) (`uvx`) | Free Search, la herramienta de la ruta `web` |

### Instalación

```bash
npm install
```

```bash
npm run dev
```

Abrí **<http://localhost:3000>** y listo: el servidor y la interfaz arrancan juntos.

<details>
<summary><b>Servir la versión compilada</b></summary>

<br>

```bash
npm run build
```

Luego iniciá con `NODE_ENV=production` y `npm start`.

</details>

<details>
<summary><b>Scripts y variables de entorno</b></summary>

<br>

| Script | Descripción |
|---|---|
| `npm run dev` / `npm start` | Servidor de JARVIS (con Vite integrado fuera de producción) |
| `npm run build` | Compila la interfaz a `dist/` |
| `npm run lint` | Verificación de tipos (`tsc --noEmit`) |
| `npm test` | Pruebas del núcleo (`tests/`): Guard y reglas de comando, lógica pura, `runTask` con dobles y foto dorada del texto de los prompts (`UPDATE_GOLDEN=1 npm test` la regenera) |
| `npm run eval` | Laboratorio de evaluación de prompts (`-- --menu` abre el asistente) |
| `npm run eval:smoke` | Prueba rápida del eval sin modelos (cliente `mock`, `--dry-run`) |

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto del servidor |
| `HOST` | `127.0.0.1` | Interfaz de red. Con `0.0.0.0` se expone a la red; como no hay autenticación, daría control de tu PC a quien llegue al servidor, así que no lo uses en redes que no controlás |

</details>

---

## ⚙️ Configuración

Todo vive en `jarvis-config.json`. Se edita desde el diálogo de ajustes de la interfaz o directamente en el archivo.

<details open>
<summary><b>Valores por defecto</b></summary>

<br>

| Propiedad | Valor | Descripción |
|---|---|---|
| `qwenUrl` · `qwenModel` | `http://127.0.0.1:11434` · `qwen3.5:4b` | Modelo generativo |
| `decisionUrl` · `decisionModel` | `http://127.0.0.1:11434` · `d3:2b` | Modelo de decisión |
| `qwenNumCtx` · `decisionMaxContext` | `16384` | Ventana de contexto; debe coincidir con la del motor |
| `thinking` | `false` | Razonamiento extendido en la respuesta final |
| `qwenTimeoutMs` · `decisionTimeoutMs` · `mcpTimeoutMs` | `120000` · `30000` · `60000` | Timeouts en milisegundos |
| `desktopCommanderMcp.allowedDirectories` | `[]` | Carpetas a las que se limita Desktop Commander (vacía = sin restricción). Solo valida los argumentos de ruta de las herramientas de archivos: **no restringe lo que haga un comando** de `start_process` |
| `traceEnabled` · `tracePath` | `true` · `jarvis-traces.jsonl` | Traza por tarea terminada, en una carpeta `jarvis-traces/` junto a `tracePath` (`summary.md`, `trace.json`, `full.json.gz`); el archivo `.jsonl` ya no se escribe |
| `refsDir` | `data/refs` | Dónde se guardan los resultados completos de las herramientas |
| `retentionDays` | `30` | Días que se conservan las refs y las trazas: lo más viejo se borra al arrancar y cada 6 horas (`0` = no borrar nada). Las refs de una tarea retenida en memoria no se tocan |
| `blacklist` | `[]` | Entradas propias de la lista negra, que se suman a las reglas de comando integradas (siempre activas: borrados, apagado, discos, usuarios, registro, procesos, servicios, git, paquetes…, con dos niveles, `blocked` y `sensitive`). Una entrada vale para herramientas que modifican el sistema: `[{ "tool": "start_process", "pattern": "remove-item\\s+-recurse", "reason": "texto para el modelo" }]`. `tool` es `herramienta` o `servidor:herramienta`; sin `pattern` se veta la herramienta entera. Las lecturas nunca se rechazan. El rechazo es `tool_rejected` (el modelo sigue con otra cosa) |
| `autoMode` | `false` | Modo automático: las escrituras y comandos del catálogo no piden aprobación al usuario y las valida la revisión de argumentos (Decisión 3). Guard (patrones destructivos, carpetas protegidas) y las reglas de comando siguen actuando: lo muy destructivo se rechaza y lo sensible pasa por un umbral más estricto. Una herramienta no catalogada sigue pidiendo aprobación. Se lee en cada llamada, así que se puede cambiar con una tarea en curso |

</details>

---

## 🗂️ Estructura del proyecto

```
jarvis/
├── server.ts            Servidor Express: composición, API local y eventos en vivo
├── src/
│   ├── core/            Núcleo: motor, modelos (`models/`), Guard, MCP, contexto, refs y contratos
│   └── server/          Rutas HTTP (/api/jarvis y /api/mcp)
├── ui/                  Interfaz React: componentes, hooks y cliente de la API
├── tests/               Pruebas del núcleo (`npm test`)
├── eval/                Laboratorio de evaluación: datasets, variantes de prompt y resultados
├── docs/                Documentación técnica
├── scripts/             Utilidades (volcado de los esquemas de herramientas)
├── data/                Datos locales de ejecución (resultados completos de las herramientas)
└── jarvis-config.json   Configuración
```

---

## 🧪 Estado actual y limitaciones

Esta es una **versión temprana ([v0.6.0](CHANGELOG.md))**: el flujo completo funciona y ejecuta tareas de forma correcta, pero todavía hay cosas por mejorar. Lo que hay que saber antes de probarlo:

| Área | Estado |
|---|---|
| **Tareas simples y medianas** | ✅ Funcionan de punta a punta en ambos modos |
| **Tareas largas** | ⚠️ Con muchos pasos y reintentos el contexto crece y el modelo chico pierde precisión; hay compactación, pero falta medirla |
| **Validaciones** | ⚠️ La revisión de argumentos (Decisión 3) y la verificación de resultados (Decisión 4) usan umbrales iniciales (0,6) sin calibrar con uso real |
| **Evaluación** | ⚠️ El laboratorio funciona, pero los datasets y las variantes se cargan a mano: no es 100 % autónomo y aún no evalúa tareas completas de punta a punta |
| **Seguridad** | ⚠️ Guard y las reglas de comando integradas cubren lo destructivo de Windows y Linux (borrados, apagado, discos, usuarios, registro…), incluidos Defender, firewall, descargas a disco y tareas programadas, pero no son una barrera contra un atacante (no resuelven variables definidas por el mismo comando ni comandos armados por concatenación). `autoMode` viene apagado; encendido, los comandos no piden aprobación y los valida un modelo de 2B, salvo las rutas sensibles (claves, credenciales, inicio automático, sistema), que siempre piden confirmación. La API no tiene autenticación: solo acepta `Host` y `Origin` locales y `POST /config` no puede cambiar el comando de los servidores MCP ni las carpetas de escritura. Los servidores MCP se lanzan con versión fija (Desktop Commander `0.3.2`). **No expongas el servidor fuera de `localhost`** |
| **Plataforma** | ⚠️ Pensado y probado en Windows con PowerShell. No se ofrece un shell Linux dentro de Windows (WSL, Git Bash) y en otros sistemas no está validado |
| **Herramientas** | 13 herramientas en cuatro destinos; el catálogo es cerrado a propósito |

Próximos pasos: seguridad y controles de ejecución, ampliar el conjunto de herramientas y estabilizar tareas largas, hasta una v1.0. El detalle de lo pendiente está en [`PENDIENTES_FUERA_DE_FLUJO`](docs/PENDIENTES_FUERA_DE_FLUJO.md).

---

## 📚 Para ir más a fondo

Si te interesa entender cómo está construido por dentro:

| Documento | Qué vas a encontrar |
|---|---|
| 🏛️ [ARCHITECTURE](docs/ARCHITECTURE.md) | La arquitectura y las responsabilidades de cada módulo |
| 🔄 [CORE_FLOW](docs/CORE_FLOW.md) | El recorrido de una tarea, de la instrucción a la respuesta final |
| 🧠 [CONTEXT_AND_MEMORY](docs/CONTEXT_AND_MEMORY.md) | Cómo se arma el contexto, la memoria y el manejo de resultados |
| 🔌 [JARVIS_API](docs/JARVIS_API.md) | La API HTTP local y los eventos en vivo que consume la interfaz |
| 📏 [Eval](eval/README.md) | El laboratorio de evaluación de prompts: uso, variantes y [mejores resultados](eval/MEJORES_VARIANTES.md) |
| 🚧 [PENDIENTES](docs/PENDIENTES_FUERA_DE_FLUJO.md) | Limitaciones conocidas y trabajo abierto |
| 📝 [CHANGELOG](CHANGELOG.md) | Qué trae cada versión y la historia del desarrollo |

---

## 📄 Licencia

[MIT](LICENSE) © 2026 Hugo Fucksmann
