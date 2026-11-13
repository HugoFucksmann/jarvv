# Qwen 3.5 4B (`qwen3.5:4b`): limitaciones observadas

Modelo **generativo**. Escribe la lista de pendientes (`pending`), los argumentos, la pregunta al usuario y la respuesta final. Esta ficha solo reúne lo medido sobre él, sobre todo en `pending`. Lo de los modelos de decisión (D1 a D4) está en [d3-2b.md](./d3-2b.md).

Fecha: 2026-11-13. Evidencia: `eval/exp/first_query.ts`, `eval/exp/select_tools.ts` (resultados en `eval/results/_exp/`) y los A/B de `pending` del eval (`--repeat=3`, 77 casos).

Antes de llamar «limitación» a algo se descartó que fuera culpa de nuestras instrucciones; lo que sí era nuestro está en el [índice](./README.md).

## 1. Idioma de la meta

Con la regla del prompt «in the language of REQUEST», la meta cambia de idioma en solicitudes que traen comandos o URL en inglés.

- De 48 solicitudes (casi todas en español), con el prompt actual:
  - 2 metas en **francés**: «Obtenir la liste des fichiers .log dans le dossier C:\Users\hugof\Documents…» para «corré en PowerShell: Get-ChildItem …», y «Obtenir la liste des processus Chrome» para «corré en cmd: tasklist | findstr chrome».
  - 2 metas en **inglés** sin que el pedido lo fuera: «Build the application using npm in the directory…» para «corré npm run build…» y «Open the URL https://docs.python.org/…» para «leé https://…».
- Se repite igual en dos corridas. Con una regla que copia el comando, el francés desaparece (0/48).

## 2. Copia los ejemplos del prompt, también en el idioma

Con una regla cuyo ejemplo es `'In the terminal: <command>'`, las metas salen en inglés aunque el pedido sea en español: 8/48 en desarrollo y 4 a 5/34 en reserva (con el prompt actual, 3 y 1). Un ejemplo en inglés dentro de un prompt en inglés se reproduce literal.

## 3. Una regla nueva mueve casos ajenos

A/B de `pending` con 3 repeticiones, contra `prod`:

| Regla | Total | Casos que más cambian |
|---|---|---|
| Amplia: «Keep exactly what the user said about where or how to do it» | −1,7 pts | `llm_gemai` −14,6 pts (89,6 % → 75,0 %) |
| Acotada: solo terminal, PowerShell o cmd | −1,3 pts | `llm_pending_hard` −4,6 pts, `llm_gemai` −6,2 pts |

Parte de la caída son expectativas del dataset (`cargo` prohibido en `pending-hard-043` aunque el usuario nombre `cargo build`). Pero en `pending-hard-044` («revisá el tamaño de node_modules … y si supera los 400MB eliminala») la regla amplia hizo que el primer ítem fuera «Borrar carpeta node_modules …» **sin la condición del tamaño**, en 3 de 3 repeticiones.

## 4. Varía entre corridas con el mismo prompt

`pending` de `prod` en `llm_gemai`: 89,6 %, 85,4 % y 87,5 % en tres A/B idénticos; total 87,0 % y 83,5 % a 88,3 % según la corrida. Un cambio menor de unos 4 puntos no se distingue del ruido con 77 casos.

## 5. Salida estructurada enriquecida (formatos de `pending` que se descartaron)

Probados con `eval/exp/first_query.ts` sobre 53 casos de primera vuelta.

- **`hints` (0 a 4 términos que un resultado correcto contendría):** de 157 términos, solo 102 salen del pedido. Incluyen la **respuesta** («Canberra» en la capital de Australia) y un **comando** («node --version»), lo que el prompt prohíbe. La retención de datos duros del pedido baja de 0,96 a 0,88.
- **`ask` (pregunta al usuario si falta un dato):** acierta 1 de 3 pedidos vagos, con 1 falso positivo, y la lista vacía pasa de 3/6 a 0/6.
- **Objetos `{kind, goal, done_when}`:** la consulta tarda 1,8 veces más y gasta 2,2 veces más tokens que con strings, sin mejorar el resultado.
- **Lista vacía en saludos y preguntas:** con el prompt de antes, solo 3 de 6 casos «sin tarea» devolvían lista vacía (el resto abría un paso). Se resolvió con una línea en el prompt (6/6, y 8/8 en 16 pedidos nuevos), no es una limitación fija.

## 6. Qué no se probó

- Bajar la temperatura de `pending` (el A/B no la fija).
- Otro modelo generativo.
- Prompts en español para las reglas (todos los prompts del experimento están en inglés).
