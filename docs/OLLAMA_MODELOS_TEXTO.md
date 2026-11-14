# Modelos sin proyector de visión (Ollama)

Jarvis no usa imágenes. Los dos modelos de la configuración (`qwen3.5:4b` y `d3:2b`) traen un **proyector de visión** como capa aparte (676 MB y 671 MB) que Ollama carga en la VRAM igual. En una GPU de 8 GB, con el escritorio usando ~1,6 GB, los dos modelos con proyector no caben residentes a la vez: Windows saca de la VRAM al que no se usa y lo vuelve a traer al alternar (~1 s por cambio de modelo).

Medido (RTX 3070 Ti 8 GB, Ollama 0.40.13, tarea simulada de una acción con D0 a D5 y dos llamadas al generativo):

| Modelos | Tarea simulada | Cambio de modelo |
|---|---|---|
| `qwen3.5:4b` + `d3:2b` (con proyector) | 4 659 ms | 1,0 a 1,2 s |
| `qwen3.5:4b-text` + `d3:2b-text` (sin proyector) | **1 071 ms** | 18 a 80 ms |
| generativo en GPU + decisión en CPU (`num_gpu 0`) | 13 000 a 16 000 ms | — (la CPU es muy lenta: descartada) |

Las probabilidades de D0 son **idénticas** entre `d3:2b` y `d3:2b-text` (diferencia 0,0 en 10 pedidos) y qwen respondió igual en las pruebas; los pesos son los mismos.

## Cómo crear las variantes

1. Mirá el Modelfile de cada modelo: `ollama show --modelfile qwen3.5:4b` (y `d3:2b`). Trae dos líneas `FROM`: la primera es el modelo, la segunda el proyector.
2. Guardá un Modelfile con **solo la primera** `FROM` y el resto de las líneas (`TEMPLATE`, `RENDERER`, `PARSER`, `PARAMETER`; sin `LICENSE`). Ejemplos (la ruta del blob es la de tu máquina):

```
# Modelfile.qwen-text
FROM C:\Users\<usuario>\.ollama\models\blobs\sha256-<modelo de qwen3.5:4b>
TEMPLATE {{ .Prompt }}
RENDERER qwen3.5
PARSER qwen3.5
PARAMETER presence_penalty 1.5
PARAMETER temperature 1
PARAMETER top_k 20
PARAMETER top_p 0.95

# Modelfile.d3-text
FROM C:\Users\<usuario>\.ollama\models\blobs\sha256-<modelo de d3:2b>
TEMPLATE {{ .Prompt }}
RENDERER d3
PARAMETER num_batch 4096
PARAMETER num_ctx 4096
```

3. Crealas (no se duplican los pesos: reutilizan los blobs):

```bash
ollama create qwen3.5:4b-text -f Modelfile.qwen-text
ollama create d3:2b-text -f Modelfile.d3-text
```

4. En `jarvis-config.json`: `"qwenModel": "qwen3.5:4b-text"` y `"decisionModel": "d3:2b-text"`. El laboratorio (`eval/`) toma los mismos nombres de esa configuración. Para volver: poner los nombres originales; las variantes se borran con `ollama rm`.

## Mantener los modelos cargados

`modelKeepAlive` (por defecto `30m`) se manda como `keep_alive` en cada consulta a los dos modelos, y al arrancar el servidor `warmUpModels` hace una consulta mínima a cada uno. Así la primera tarea tras una pausa no paga la carga en frío. `-1` los deja cargados sin límite; `0` los descarga al terminar cada consulta. No depende de cómo se arranque `ollama serve`.
