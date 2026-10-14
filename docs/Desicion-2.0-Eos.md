Decision-2.0-Eos-0.8B
Documentación oficial: Hugging Face
1. Descripción
Modelo de decisiones estructuradas de aproximadamente 0,8 mil millones de parámetros. Recibe un contexto (state) y una o varias preguntas (questions), y devuelve respuestas estructuradas con probabilidades.
- Ventana de contexto: 16.384 tokens.
- Licencia: Apache 2.0.
- API Python: model.system_one(state=..., questions=...).
2. Entrada
{
  "state": "Contexto que analizará el modelo",
  "questions": {
    "id_pregunta": {
      "type": "choice",
      "instructions": "Pregunta concreta",
      "criteria": {
        "opcion_a": "Descripción de A",
        "opcion_b": "Descripción de B"
      }
    }
  }
}


- state: contexto que analizará el modelo.
- questions: objeto que contiene una o varias preguntas.
- type: tipo de pregunta: choice, noul o score.
- instructions: instrucción específica de cada pregunta.
- criteria: opciones o niveles, según el tipo de pregunta.
3. Tipos de preguntas
3.1. choice — Selección de opción
Selecciona una opción entre varias alternativas.
{
  "type": "choice",
  "instructions": "¿Qué herramienta corresponde?",
  "criteria": {
    "read_file": "Leer archivos locales",
    "search_web": "Buscar en Internet"
  }
}


Salida específica: choice y probabilities.
3.2. noul — Decisión sí/no
Evalúa si una afirmación es verdadera o aplicable al contexto.
{
  "type": "noul",
  "instructions": "¿La tarea requiere Internet?"
}


Salida específica: noul, con la probabilidad asociada a la respuesta afirmativa.
3.3. score — Evaluación ordinal
Evalúa el contexto mediante una escala ordenada.
{
  "type": "score",
  "instructions": "¿Qué prioridad tiene la tarea?",
  "criteria": ["Baja", "Media", "Alta"]
}


Salida específica:
- score: valor esperado sobre los índices de la escala.
- legend: correspondencia entre índices y niveles.
- probabilities: distribución de probabilidades.
4. Salida
Las respuestas se obtienen mediante result["answers"].
Ejemplo ilustrativo:
{
  "answers": {
    "tool": {
      "choice": "search_web",
      "probabilities": {}
    },
    "requires_internet": {
      "noul": 0.95
    },
    "priority": {
      "score": 1.8,
      "legend": {},
      "probabilities": {}
    }
  }
}


Los valores son ilustrativos, no una respuesta real del modelo.
5. Ejemplo completo: varias preguntas en una llamada
El siguiente ejemplo envía un contexto compartido y tres preguntas de tipos diferentes en una sola inferencia.
result = model.system_one(    state=(        "El usuario solicita buscar en Internet el manual de una impresora "        "y guardar el PDF descargado en la carpeta Documentos."    ),    questions={        "tool": {            "type": "choice",            "instructions": "¿Qué herramienta corresponde a la primera acción?",            "criteria": {                "search_web": "Buscar información en Internet",                "read_file": "Leer archivos locales",                "open_app": "Abrir una aplicación"            }        },        "requires_internet": {            "type": "noul",            "instructions": "¿La solicitud requiere acceso a Internet?"        },        "priority": {            "type": "score",            "instructions": "¿Qué prioridad tiene la tarea?",            "criteria": ["Baja", "Media", "Alta"]        }    })print(result["answers"])



Cómo funciona
1. state contiene el contexto completo que se desea evaluar.
2. questions contiene todas las preguntas de la llamada.
3. Cada pregunta tiene un identificador único definido por la aplicación.
4. Cada pregunta puede utilizar un tipo diferente y sus propios criterios.
5. result["answers"] contiene las respuestas asociadas a cada identificador.
Importante: el modelo evalúa las preguntas; no ejecuta las herramientas seleccionadas. El runtime de la aplicación debe interpretar las respuestas y decidir qué acción realizar.