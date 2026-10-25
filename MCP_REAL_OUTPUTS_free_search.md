# Salidas Reales de MCP — free_search

Este documento registra las respuestas crudas e inalteradas obtenidas de la ejecución directa del servidor MCP `free_search` (`free-search-mcp`).
Incluye **únicamente las 3 herramientas catalogadas y utilizadas en Jarvis** según `src/core/tools/manifest.ts`, pertenecientes al subsistema `web`.

---

## Índice de Herramientas
- **Subsystem web:**
  1. [`search`](#1-search)
  2. [`fetch`](#2-fetch)
  3. [`fetch_batch`](#3-fetch_batch)

---

## 1. `search`

- **Servidor:** `free_search`
- **Destino (Route):** `web`
- **Descripción en Manifest:** Deduplicated multi-engine web search with clean snippets.

### Argumentos enviados (Ejemplo real ejecutado)

```json
{
  "query": "Model Context Protocol documentation",
  "max_results": 2
}
```

### Respuesta cruda del MCP (`tools/call` sin modificar)

```json
{
  "content": [
    {
      "text": "# Search: Model Context Protocol documentation\n\n_engines: anysearch, bing, brave, duckduckgo_  _results: 2_  _dated: 1/2_\n_(requested but contributed nothing: mojeek)_\n_(retrieved 2026-10-25T19:25:04Z)_\n\n> **Lead:** According to modelcontextprotocol.io: MCP (Model Context Protocol) is an open-source standard for connecting AI applications to external systems. Using MCP, AI applications like Claude or ...\n\n## 1. What is the Model Context Protocol (MCP)?\n<https://modelcontextprotocol.io/docs/2026-07-28/getting-started/intro>\n\n> MCP (Model Context Protocol) is an open-source standard for connecting AI applications to external systems. Using MCP, AI applications like Claude or ...\n\n_anysearch, bing, brave_ · score 0.04918 · 2026-07-28 (from snippet text)\n\n## 2. Allemannsdata — norske offentlige data som MCP-servere\n<https://allemannsdata.com>\n\n> Gratis Model Context Protocol -servere (MCP) for norske åpne offentlige data: transport, vær, strømpriser, virksomheter, statistikk, lovverk og mer. Ingen API-nøkkel eller registrering kreves.\n\n_duckduckgo_ · score 0.01639 · undated\n\n\n⚠️ **Gated engines:** mojeek was captcha-gated → served via brave. Configure a proxy (admin UI / SEARCH_MCP_PROXY) to route through a non-blocked IP, or rely on the keyless default engines.\n\nℹ️ **Rescued:** the requested engines came up short; results above include a rescue pass via brave.\n\n_Snippets locate sources; they are not the source. Read dates, amounts, rules and other details from the page itself with fetch or research before relying on them._\n",
      "type": "text"
    }
  ],
  "isError": false
}
```

### Contenido textual extraído (`content[].text` sin formato adicional)

```markdown
# Search: Model Context Protocol documentation

_engines: anysearch, bing, brave, duckduckgo_  _results: 2_  _dated: 1/2_
_(requested but contributed nothing: mojeek)_
_(retrieved 2026-10-25T19:25:04Z)_

> **Lead:** According to modelcontextprotocol.io: MCP (Model Context Protocol) is an open-source standard for connecting AI applications to external systems. Using MCP, AI applications like Claude or ...

## 1. What is the Model Context Protocol (MCP)?
<https://modelcontextprotocol.io/docs/2026-07-28/getting-started/intro>

> MCP (Model Context Protocol) is an open-source standard for connecting AI applications to external systems. Using MCP, AI applications like Claude or ...

_anysearch, bing, brave_ · score 0.04918 · 2026-07-28 (from snippet text)

## 2. Allemannsdata — norske offentlige data som MCP-servere
<https://allemannsdata.com>

> Gratis Model Context Protocol -servere (MCP) for norske åpne offentlige data: transport, vær, strømpriser, virksomheter, statistikk, lovverk og mer. Ingen API-nøkkel eller registrering kreves.

_duckduckgo_ · score 0.01639 · undated


⚠️ **Gated engines:** mojeek was captcha-gated → served via brave. Configure a proxy (admin UI / SEARCH_MCP_PROXY) to route through a non-blocked IP, or rely on the keyless default engines.

ℹ️ **Rescued:** the requested engines came up short; results above include a rescue pass via brave.

_Snippets locate sources; they are not the source. Read dates, amounts, rules and other details from the page itself with fetch or research before relying on them._

```

---

## 2. `fetch`

- **Servidor:** `free_search`
- **Destino (Route):** `web`
- **Descripción en Manifest:** Download a web page and convert it to clean Markdown.

### Argumentos enviados (Ejemplo real ejecutado)

```json
{
  "url": "https://httpbin.org/html",
  "render": "http",
  "force_refresh": true
}
```

### Respuesta cruda del MCP (`tools/call` sin modificar)

```json
{
  "content": [
    {
      "text": "# Herman Melville - Moby-Dick\n<https://httpbin.org/html>\n_no publication date found_\n_fetched via http_ · ~891 tokens · retrieved 2026-10-25T19:25:04Z\n\nAvailing himself of the mild, summer-cool weather that now reigned in these latitudes, and in preparation for the peculiarly active pursuits shortly to be anticipated, Perth, the begrimed, blistered old blacksmith, had not removed his portable forge to the hold again, after concluding his contributory work for Ahab's leg, but still retained it on deck, fast lashed to ringbolts by the foremast; being now almost incessantly invoked by the headsmen, and harpooneers, and bowsmen to do some little job for them; altering, or repairing, or new shaping their various weapons and boat furniture. Often he would be surrounded by an eager circle, all waiting to be served; holding boat-spades, pike-heads, harpoons, and lances, and jealously watching his every sooty movement, as he toiled. Nevertheless, this old man's was a patient hammer wielded by a patient arm. No murmur, no impatience, no petulance did come from him. Silent, slow, and solemn; bowing over still further his chronically broken back, he toiled away, as if toil were life itself, and the heavy beating of his hammer the heavy beating of his heart. And so it was.—Most miserable! A peculiar walk in this old man, a certain slight but painful appearing yawing in his gait, had at an early period of the voyage excited the curiosity of the mariners. And to the importunity of their persisted questionings he had finally given in; and so it came to pass that every one now knew the shameful story of his wretched fate. Belated, and not innocently, one bitter winter's midnight, on the road running between two country towns, the blacksmith half-stupidly felt the deadly numbness stealing over him, and sought refuge in a leaning, dilapidated barn. The issue was, the loss of the extremities of both feet. Out of this revelation, part by part, at last came out the four acts of the gladness, and the one long, and as yet uncatastrophied fifth act of the grief of his life's drama. He was an old man, who, at the age of nearly sixty, had postponedly encountered that thing in sorrow's technicals called ruin. He had been an artisan of famed excellence, and with plenty to do; owned a house and garden; embraced a youthful, daughter-like, loving wife, and three blithe, ruddy children; every Sunday went to a cheerful-looking church, planted in a grove. But one night, under cover of darkness, and further concealed in a most cunning disguisement, a desperate burglar slid into his happy home, and robbed them all of everything. And darker yet to tell, the blacksmith himself did ignorantly conduct this burglar into his family's heart. It was the Bottle Conjuror! Upon the opening of that fatal cork, forth flew the fiend, and shrivelled up his home. Now, for prudent, most wise, and economic reasons, the blacksmith's shop was in the basement of his dwelling, but with a separate entrance to it; so that always had the young and loving healthy wife listened with no unhappy nervousness, but with vigorous pleasure, to the stout ringing of her young-armed old husband's hammer; whose reverberations, muffled by passing through the floors and walls, came up to her, not unsweetly, in her nursery; and so, to stout Labor's iron lullaby, the blacksmith's infants were rocked to slumber. Oh, woe on woe! Oh, Death, why canst thou not sometimes be timely? Hadst thou taken this old blacksmith to thyself ere his full ruin came upon him, then had the young widow had a delicious grief, and her orphans a truly venerable, legendary sire to dream of in their after years; and all of them a care-killing competency.\n",
      "type": "text"
    }
  ],
  "isError": false
}
```

### Contenido textual extraído (`content[].text` sin formato adicional)

```markdown
# Herman Melville - Moby-Dick
<https://httpbin.org/html>
_no publication date found_
_fetched via http_ · ~891 tokens · retrieved 2026-10-25T19:25:04Z

Availing himself of the mild, summer-cool weather that now reigned in these latitudes, and in preparation for the peculiarly active pursuits shortly to be anticipated, Perth, the begrimed, blistered old blacksmith, had not removed his portable forge to the hold again, after concluding his contributory work for Ahab's leg, but still retained it on deck, fast lashed to ringbolts by the foremast; being now almost incessantly invoked by the headsmen, and harpooneers, and bowsmen to do some little job for them; altering, or repairing, or new shaping their various weapons and boat furniture. Often he would be surrounded by an eager circle, all waiting to be served; holding boat-spades, pike-heads, harpoons, and lances, and jealously watching his every sooty movement, as he toiled. Nevertheless, this old man's was a patient hammer wielded by a patient arm. No murmur, no impatience, no petulance did come from him. Silent, slow, and solemn; bowing over still further his chronically broken back, he toiled away, as if toil were life itself, and the heavy beating of his hammer the heavy beating of his heart. And so it was.—Most miserable! A peculiar walk in this old man, a certain slight but painful appearing yawing in his gait, had at an early period of the voyage excited the curiosity of the mariners. And to the importunity of their persisted questionings he had finally given in; and so it came to pass that every one now knew the shameful story of his wretched fate. Belated, and not innocently, one bitter winter's midnight, on the road running between two country towns, the blacksmith half-stupidly felt the deadly numbness stealing over him, and sought refuge in a leaning, dilapidated barn. The issue was, the loss of the extremities of both feet. Out of this revelation, part by part, at last came out the four acts of the gladness, and the one long, and as yet uncatastrophied fifth act of the grief of his life's drama. He was an old man, who, at the age of nearly sixty, had postponedly encountered that thing in sorrow's technicals called ruin. He had been an artisan of famed excellence, and with plenty to do; owned a house and garden; embraced a youthful, daughter-like, loving wife, and three blithe, ruddy children; every Sunday went to a cheerful-looking church, planted in a grove. But one night, under cover of darkness, and further concealed in a most cunning disguisement, a desperate burglar slid into his happy home, and robbed them all of everything. And darker yet to tell, the blacksmith himself did ignorantly conduct this burglar into his family's heart. It was the Bottle Conjuror! Upon the opening of that fatal cork, forth flew the fiend, and shrivelled up his home. Now, for prudent, most wise, and economic reasons, the blacksmith's shop was in the basement of his dwelling, but with a separate entrance to it; so that always had the young and loving healthy wife listened with no unhappy nervousness, but with vigorous pleasure, to the stout ringing of her young-armed old husband's hammer; whose reverberations, muffled by passing through the floors and walls, came up to her, not unsweetly, in her nursery; and so, to stout Labor's iron lullaby, the blacksmith's infants were rocked to slumber. Oh, woe on woe! Oh, Death, why canst thou not sometimes be timely? Hadst thou taken this old blacksmith to thyself ere his full ruin came upon him, then had the young widow had a delicious grief, and her orphans a truly venerable, legendary sire to dream of in their after years; and all of them a care-killing competency.

```

---

## 3. `fetch_batch`

- **Servidor:** `free_search`
- **Destino (Route):** `web`
- **Descripción en Manifest:** Download several URLs in parallel.

### Argumentos enviados (Ejemplo real ejecutado)

```json
{
  "urls": [
    "https://httpbin.org/html",
    "https://httpbin.org/robots.txt"
  ],
  "render": "http"
}
```

### Respuesta cruda del MCP (`tools/call` sin modificar)

```json
{
  "content": [
    {
      "text": "# Herman Melville - Moby-Dick\n<https://httpbin.org/html>\n_no publication date found_\n_fetched via cache_ · ~891 tokens · cached under a minute ago · retrieved 2026-10-25T19:25:04Z\n\nAvailing himself of the mild, summer-cool weather that now reigned in these latitudes, and in preparation for the peculiarly active pursuits shortly to be anticipated, Perth, the begrimed, blistered old blacksmith, had not removed his portable forge to the hold again, after concluding his contributory work for Ahab's leg, but still retained it on deck, fast lashed to ringbolts by the foremast; being now almost incessantly invoked by the headsmen, and harpooneers, and bowsmen to do some little job for them; altering, or repairing, or new shaping their various weapons and boat furniture. Often he would be surrounded by an eager circle, all waiting to be served; holding boat-spades, pike-heads, harpoons, and lances, and jealously watching his every sooty movement, as he toiled. Nevertheless, this old man's was a patient hammer wielded by a patient arm. No murmur, no impatience, no petulance did come from him. Silent, slow, and solemn; bowing over still further his chronically broken back, he toiled away, as if toil were life itself, and the heavy beating of his hammer the heavy beating of his heart. And so it was.—Most miserable! A peculiar walk in this old man, a certain slight but painful appearing yawing in his gait, had at an early period of the voyage excited the curiosity of the mariners. And to the importunity of their persisted questionings he had finally given in; and so it came to pass that every one now knew the shameful story of his wretched fate. Belated, and not innocently, one bitter winter's midnight, on the road running between two country towns, the blacksmith half-stupidly felt the deadly numbness stealing over him, and sought refuge in a leaning, dilapidated barn. The issue was, the loss of the extremities of both feet. Out of this revelation, part by part, at last came out the four acts of the gladness, and the one long, and as yet uncatastrophied fifth act of the grief of his life's drama. He was an old man, who, at the age of nearly sixty, had postponedly encountered that thing in sorrow's technicals called ruin. He had been an artisan of famed excellence, and with plenty to do; owned a house and garden; embraced a youthful, daughter-like, loving wife, and three blithe, ruddy children; every Sunday went to a cheerful-looking church, planted in a grove. But one night, under cover of darkness, and further concealed in a most cunning disguisement, a desperate burglar slid into his happy home, and robbed them all of everything. And darker yet to tell, the blacksmith himself did ignorantly conduct this burglar into his family's heart. It was the Bottle Conjuror! Upon the opening of that fatal cork, forth flew the fiend, and shrivelled up his home. Now, for prudent, most wise, and economic reasons, the blacksmith's shop was in the basement of his dwelling, but with a separate entrance to it; so that always had the young and loving healthy wife listened with no unhappy nervousness, but with vigorous pleasure, to the stout ringing of her young-armed old husband's hammer; whose reverberations, muffled by passing through the floors and walls, came up to her, not unsweetly, in her nursery; and so, to stout Labor's iron lullaby, the blacksmith's infants were rocked to slumber. Oh, woe on woe! Oh, Death, why canst thou not sometimes be timely? Hadst thou taken this old blacksmith to thyself ere his full ruin came upon him, then had the young widow had a delicious grief, and her orphans a truly venerable, legendary sire to dream of in their after years; and all of them a care-killing competency.\n\n---\n\n# (untitled)\n<https://httpbin.org/robots.txt>\n_no publication date found_\n_fetched via cache_ · ~7 tokens · cached 8 hours ago · retrieved 2026-10-25T10:57:59Z\n\nUser-agent: *\nDisallow: /deny\n",
      "type": "text"
    }
  ],
  "isError": false
}
```

### Contenido textual extraído (`content[].text` sin formato adicional)

```markdown
# Herman Melville - Moby-Dick
<https://httpbin.org/html>
_no publication date found_
_fetched via cache_ · ~891 tokens · cached under a minute ago · retrieved 2026-10-25T19:25:04Z

Availing himself of the mild, summer-cool weather that now reigned in these latitudes, and in preparation for the peculiarly active pursuits shortly to be anticipated, Perth, the begrimed, blistered old blacksmith, had not removed his portable forge to the hold again, after concluding his contributory work for Ahab's leg, but still retained it on deck, fast lashed to ringbolts by the foremast; being now almost incessantly invoked by the headsmen, and harpooneers, and bowsmen to do some little job for them; altering, or repairing, or new shaping their various weapons and boat furniture. Often he would be surrounded by an eager circle, all waiting to be served; holding boat-spades, pike-heads, harpoons, and lances, and jealously watching his every sooty movement, as he toiled. Nevertheless, this old man's was a patient hammer wielded by a patient arm. No murmur, no impatience, no petulance did come from him. Silent, slow, and solemn; bowing over still further his chronically broken back, he toiled away, as if toil were life itself, and the heavy beating of his hammer the heavy beating of his heart. And so it was.—Most miserable! A peculiar walk in this old man, a certain slight but painful appearing yawing in his gait, had at an early period of the voyage excited the curiosity of the mariners. And to the importunity of their persisted questionings he had finally given in; and so it came to pass that every one now knew the shameful story of his wretched fate. Belated, and not innocently, one bitter winter's midnight, on the road running between two country towns, the blacksmith half-stupidly felt the deadly numbness stealing over him, and sought refuge in a leaning, dilapidated barn. The issue was, the loss of the extremities of both feet. Out of this revelation, part by part, at last came out the four acts of the gladness, and the one long, and as yet uncatastrophied fifth act of the grief of his life's drama. He was an old man, who, at the age of nearly sixty, had postponedly encountered that thing in sorrow's technicals called ruin. He had been an artisan of famed excellence, and with plenty to do; owned a house and garden; embraced a youthful, daughter-like, loving wife, and three blithe, ruddy children; every Sunday went to a cheerful-looking church, planted in a grove. But one night, under cover of darkness, and further concealed in a most cunning disguisement, a desperate burglar slid into his happy home, and robbed them all of everything. And darker yet to tell, the blacksmith himself did ignorantly conduct this burglar into his family's heart. It was the Bottle Conjuror! Upon the opening of that fatal cork, forth flew the fiend, and shrivelled up his home. Now, for prudent, most wise, and economic reasons, the blacksmith's shop was in the basement of his dwelling, but with a separate entrance to it; so that always had the young and loving healthy wife listened with no unhappy nervousness, but with vigorous pleasure, to the stout ringing of her young-armed old husband's hammer; whose reverberations, muffled by passing through the floors and walls, came up to her, not unsweetly, in her nursery; and so, to stout Labor's iron lullaby, the blacksmith's infants were rocked to slumber. Oh, woe on woe! Oh, Death, why canst thou not sometimes be timely? Hadst thou taken this old blacksmith to thyself ere his full ruin came upon him, then had the young widow had a delicious grief, and her orphans a truly venerable, legendary sire to dream of in their after years; and all of them a care-killing competency.

---

# (untitled)
<https://httpbin.org/robots.txt>
_no publication date found_
_fetched via cache_ · ~7 tokens · cached 8 hours ago · retrieved 2026-10-25T10:57:59Z

User-agent: *
Disallow: /deny

```

---

## Casos Borde y Respuestas Especiales (Ejecución Real)

### A. `search` con 0 resultados

- **Herramienta:** `search`
- **Condición:** Búsqueda que no arroja coincidencias (`_results: 0_`).

#### Argumentos enviados
```json
{
  "query": "nonexistentterm999xyz",
  "include_domains": [
    "example.org"
  ]
}
```

#### Respuesta cruda del MCP (`tools/call` sin modificar)
```json
{
  "content": [
    {
      "text": "# Search: nonexistentterm999xyz\n\n_engines: duckduckgo, bing, anysearch_  _results: 0_\n_(retrieved 2026-10-25T20:16:08Z)_\n\n**No results.** Try a broader query, different engines, or check `errors` if any engine failed.\n\n⚠️ **Silent engines:** duckduckgo returned 0 results with no error and no CAPTCHA/consent wall detected. This may be a silent IP block or a markup change. If this persists, configure a proxy (admin UI / SEARCH_MCP_PROXY) or pick different engines via `engines=`.\n\nℹ️ **Benched engines:** mojeek is benched (captcha; retried in ~9 min). A benched engine failed recently and was not asked this time. Name it in `engines=` to force an attempt.\n\n---\n⚠️ **Filter diagnostics** (results were sparse)\n\nRaw results: 17 across 3 engines → 0 after filters.\nTop drops: include_domains (17).\n\nHint: Filters dropped 17 of 17 raw results (kept 0). Most were excluded by include_domains. Try widening or removing one filter.\n",
      "type": "text"
    }
  ],
  "isError": false
}
```

#### Contenido textual extraído
```markdown
# Search: nonexistentterm999xyz

_engines: duckduckgo, bing, anysearch_  _results: 0_
_(retrieved 2026-10-25T20:16:08Z)_

**No results.** Try a broader query, different engines, or check `errors` if any engine failed.

⚠️ **Silent engines:** duckduckgo returned 0 results with no error and no CAPTCHA/consent wall detected. This may be a silent IP block or a markup change. If this persists, configure a proxy (admin UI / SEARCH_MCP_PROXY) or pick different engines via `engines=`.

ℹ️ **Benched engines:** mojeek is benched (captcha; retried in ~9 min). A benched engine failed recently and was not asked this time. Name it in `engines=` to force an attempt.

---
⚠️ **Filter diagnostics** (results were sparse)

Raw results: 17 across 3 engines → 0 after filters.
Top drops: include_domains (17).

Hint: Filters dropped 17 of 17 raw results (kept 0). Most were excluded by include_domains. Try widening or removing one filter.
```

> **Nota para Jarvis:** La herramienta responde `isError: false`, pero el texto contiene `_results: 0_` y `**No results.**`. En [manifest.ts](file:///e:/colo/jarvv/src/core/tools/manifest.ts), `search` tiene la directiva `emptyIsError: true`.

---

### B. `fetch` de una URL caída / inexistente

- **Herramienta:** `fetch`
- **Condición:** Host o dominio caído / inexistente que no resuelve por DNS.

#### Argumentos enviados
```json
{
  "url": "https://servidor-caido-o-inexistente-xyz987654.org",
  "render": "http"
}
```

#### Respuesta cruda del MCP (`tools/call` sin modificar)
```json
{
  "content": [
    {
      "text": "Error executing tool fetch: Could not resolve host 'servidor-caido-o-inexistente-xyz987654.org': [Errno 11001] getaddrinfo failed. Refusing to connect.",
      "type": "text"
    }
  ],
  "isError": true
}
```

#### Contenido textual extraído
```text
Error executing tool fetch: Could not resolve host 'servidor-caido-o-inexistente-xyz987654.org': [Errno 11001] getaddrinfo failed. Refusing to connect.
```

