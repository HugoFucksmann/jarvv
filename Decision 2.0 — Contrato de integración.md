# Decision 2.0 — Contrato de integración

## 1. Modelo

```text
vllm-sr/Decision-2.0-Kai-0.6B
```

Modelo de decisión estructurada. No genera texto conversacional.

Características verificadas en el model card oficial:

- Parámetros: 0.60B.
- Modelo base: Qwen/Qwen3-0.6B-Base.
- Contexto máximo: 8.192 tokens.
- Tipos de decisión: `choice`, `noul`, `score`.
- Licencia: Apache-2.0.
- Responde varias preguntas sobre el mismo input en una única pasada y devuelve probabilidades por respuesta, sin generar texto.

## 2. Integración

### 2.1 Dependencias (según el model card)

```bash
pip install "transformers>=5.17" torch safetensors
```

El modelo requiere `trust_remote_code=True`.

### 2.2 Interfaz principal

```python
from transformers import AutoModel

model = AutoModel.from_pretrained(
    "vllm-sr/Decision-2.0-Kai-0.6B",
    trust_remote_code=True
)

result = model.system_one(
    state=state,
    questions=questions
)

answers = result["answers"]
```

Tipos usados en el ejemplo oficial:

- `state`: `str` (el model card indica que acepta texto o JSON).
- `questions`: `dict` de Python con la estructura de la sección 3.
- Retorno: `dict` con la clave `answers` (ver sección 6).

El model card también muestra, como alternativa, una pipeline de Transformers:

```python
transformers.pipeline(
    "decision",
    model="vllm-sr/Decision-2.0-Kai-0.6B",
    trust_remote_code=True
)(state=..., questions=...)
```

`system_one` es la interfaz documentada en detalle. El model card no describe el retorno de la pipeline; no asumir que es idéntico sin verificarlo.

### 2.3 Ejecución fuera de Python

El modelo no expone un endpoint HTTP propio. Si JARVIS lo ejecuta mediante un servicio separado, ese servicio debe envolver `system_one`. El protocolo entre JARVIS y ese servicio no forma parte de este contrato.

## 3. Entrada

`system_one()` recibe:

- `state`: texto o JSON con el estado que debe analizar.
- `questions`: objeto de decisiones.

Cada clave de `questions` identifica una decisión:

```json
{
  "route": {
    "type": "choice",
    "instructions": "¿Qué tipo de tarea es?",
    "criteria": {
      "system": "Operación sobre el sistema",
      "research": "Investigación",
      "coding": "Programación"
    }
  }
}
```

Campos de cada pregunta:

| Campo | Uso |
|---|---|
| `type` | Tipo de decisión |
| `instructions` | Pregunta/instrucción |
| `criteria` | Opciones o niveles, cuando el tipo los requiere |

Todas las preguntas de una llamada se evalúan sobre el mismo `state`.

## 4. Tipos de decisión

### 4.1 `choice`

Selecciona una opción entre las definidas en `criteria`.

`criteria` es un objeto `identificador → descripción`:

```json
{
  "option_a": "Descripción",
  "option_b": "Descripción"
}
```

Límite: **2–255 opciones**.

Respuesta:

```json
{
  "type": "choice",
  "choice": "option_a",
  "probabilities": {
    "option_a": 0.84,
    "option_b": 0.16
  },
  "confidence": 0.68
}
```

`probabilities` contiene la probabilidad de cada opción y suma 1. Selecciona **una** opción: no es una selección múltiple.

`confidence` se calcula a partir de la distribución de probabilidades; no garantiza que la decisión sea correcta.

### 4.2 `noul`

Decisión binaria YES/NO.

`criteria` no es necesario (el ejemplo oficial no lo usa).

Respuesta:

```json
{
  "type": "noul",
  "noul": 0.87
}
```

`noul` es la probabilidad de YES/true. El modelo no devuelve un booleano: el umbral de decisión pertenece a JARVIS.

### 4.3 `score`

Clasificación ordinal.

`criteria` es un **array ordenado**; el orden es significativo. Límite: **2–10 niveles**.

```json
{
  "type": "score",
  "instructions": "¿Qué tan compleja es la tarea?",
  "criteria": ["Baja", "Media", "Alta"]
}
```

Respuesta:

```json
{
  "type": "score",
  "score": 1.82,
  "probabilities": {
    "0": 0.02,
    "1": 0.14,
    "2": 0.84
  }
}
```

Las claves de `probabilities` son los índices de los niveles (`0` = primer elemento de `criteria`). `score` es el valor esperado de esa distribución, por lo que puede ser decimal y no corresponde necesariamente a un nivel concreto.

## 5. Múltiples preguntas

Varias preguntas pueden resolverse en una misma llamada.

```json
{
  "route": {
    "type": "choice",
    "instructions": "...",
    "criteria": {}
  },
  "needs_reasoning": {
    "type": "noul",
    "instructions": "..."
  },
  "difficulty": {
    "type": "score",
    "instructions": "...",
    "criteria": ["Baja", "Media", "Alta"]
  }
}
```

La salida contiene una entrada por cada pregunta enviada.

## 6. Respuesta

```json
{
  "model": "Decision-2.0-Kai-0.6B",
  "answers": {},
  "usage": {
    "input_tokens": 168,
    "output_tokens": 0
  }
}
```

`answers` utiliza las mismas claves definidas en `questions`.

Según el tipo:

```text
choice → type, choice, probabilities, confidence
noul   → type, noul
score  → type, score, probabilities
```

No asumir campos adicionales no documentados.

`usage` informa consumo de tokens. No debe utilizarse como parte de la decisión.

## 7. Errores y límites

Tratar como error:

- modelo no disponible o carga fallida;
- excepción durante la inferencia;
- `state` inválido;
- `questions` inválido;
- tipo de decisión inválido;
- criterios incompatibles con el tipo;
- contexto superior a 8.192 tokens;
- timeout de inferencia;
- respuesta ausente o malformada, o con una pregunta sin su entrada en `answers`.

Una respuesta incompleta o inválida no debe interpretarse como una decisión válida.

El fallback ante estos errores pertenece al núcleo de JARVIS.

| Elemento | Límite |
|---|---:|
| Contexto | 8.192 tokens |
| `choice` | 2–255 opciones |
| `noul` | Binario |
| `score` | 2–10 niveles |
| Preguntas por inferencia | Múltiples |

## 8. Información que el contrato no define

Estos puntos no están documentados por el model card ni por este contrato. No asumirlos; resolverlos con medición o decisión explícita:

- Cómo contar los tokens de `state` + `questions` antes de llamar, para respetar el límite de 8.192.
- Latencia en el hardware de JARVIS. El model card informa una mediana de 4,9 ms por request de una sola pregunta en una única GPU; no informa CPU ni el tiempo de carga.
- Idiomas soportados. Los ejemplos del model card están en inglés y no declara cobertura de idiomas; el comportamiento con instrucciones y criterios en español debe evaluarse.
- Comportamiento exacto de la pipeline `decision` frente a `system_one`.

## 9. Regla de integración

JARVIS debe interpretar dinámicamente:

```text
questions[*].type
answers[*].type
```

No depender de:

- preguntas concretas;
- nombres concretos de decisiones;
- número fijo de preguntas;
- opciones concretas;
- campos de respuesta no documentados.

La construcción de `state`, la selección de preguntas, el ranking de tools, los umbrales y el fallback pertenecen al núcleo de JARVIS, no al contrato del modelo.

## 10. Referencia

Modelo oficial:

`vllm-sr/Decision-2.0-Kai-0.6B`

https://huggingface.co/vllm-sr/Decision-2.0-Kai-0.6B