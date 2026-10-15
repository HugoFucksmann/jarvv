# Esquemas de Entrada Seleccionados (inputSchema)

---

# 1. `desktop_commander`

### 1. `read_file`
```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string"
    },
    "isUrl": {
      "type": "boolean",
      "default": false
    },
    "offset": {
      "type": "number",
      "default": 0
    },
    "length": {
      "type": "number",
      "default": 1000
    },
    "sheet": {
      "type": "string"
    },
    "range": {
      "type": "string"
    },
    "options": {
      "type": "object",
      "additionalProperties": {}
    },
    "origin": {
      "type": "string",
      "enum": [
        "ui",
        "llm"
      ]
    }
  },
  "required": [
    "path"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### 2. `read_multiple_files`
```json
{
  "type": "object",
  "properties": {
    "paths": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "paths"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### 3. `write_file`
```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string"
    },
    "content": {
      "type": "string"
    },
    "mode": {
      "type": "string",
      "enum": [
        "rewrite",
        "append"
      ],
      "default": "rewrite"
    },
    "origin": {
      "type": "string",
      "enum": [
        "ui",
        "llm"
      ]
    }
  },
  "required": [
    "path",
    "content"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### 4. `create_directory`
```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string"
    }
  },
  "required": [
    "path"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### 5. `list_directory`
```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string"
    },
    "depth": {
      "type": "number",
      "default": 2
    },
    "origin": {
      "type": "string",
      "enum": [
        "ui",
        "llm"
      ]
    }
  },
  "required": [
    "path"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### 6. `move_file`
```json
{
  "type": "object",
  "properties": {
    "source": {
      "type": "string"
    },
    "destination": {
      "type": "string"
    }
  },
  "required": [
    "source",
    "destination"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### 7. `start_search`
```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string"
    },
    "pattern": {
      "type": "string"
    },
    "searchType": {
      "type": "string",
      "enum": [
        "files",
        "content"
      ],
      "default": "files"
    },
    "filePattern": {
      "type": "string"
    },
    "ignoreCase": {
      "type": "boolean",
      "default": true
    },
    "maxResults": {
      "type": "integer",
      "minimum": 0
    },
    "includeHidden": {
      "type": "boolean",
      "default": false
    },
    "contextLines": {
      "type": "integer",
      "minimum": 0,
      "default": 5
    },
    "timeout_ms": {
      "type": "integer",
      "minimum": 0
    },
    "earlyTermination": {
      "type": "boolean"
    },
    "literalSearch": {
      "type": "boolean",
      "default": false
    },
    "origin": {
      "type": "string",
      "enum": [
        "ui",
        "llm"
      ]
    }
  },
  "required": [
    "path",
    "pattern"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### 8. `get_more_search_results`
```json
{
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    },
    "offset": {
      "type": "integer",
      "default": 0
    },
    "length": {
      "type": "integer",
      "minimum": 1,
      "default": 100
    }
  },
  "required": [
    "sessionId"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### 9. `start_process`
```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string"
    },
    "timeout_ms": {
      "type": "number"
    },
    "shell": {
      "type": "string"
    },
    "verbose_timing": {
      "type": "boolean"
    },
    "origin": {
      "type": "string",
      "enum": [
        "ui",
        "llm"
      ]
    }
  },
  "required": [
    "command",
    "timeout_ms"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### 10. `read_process_output`
```json
{
  "type": "object",
  "properties": {
    "pid": {
      "type": "number"
    },
    "timeout_ms": {
      "type": "number"
    },
    "offset": {
      "type": "number"
    },
    "length": {
      "type": "number"
    },
    "verbose_timing": {
      "type": "boolean"
    }
  },
  "required": [
    "pid"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### 11. `interact_with_process`
```json
{
  "type": "object",
  "properties": {
    "pid": {
      "type": "number"
    },
    "input": {
      "type": "string"
    },
    "timeout_ms": {
      "type": "number"
    },
    "wait_for_prompt": {
      "type": "boolean"
    },
    "verbose_timing": {
      "type": "boolean"
    }
  },
  "required": [
    "pid",
    "input"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

---

# 2. `free_search`

### 1. `search`
```json
{
  "properties": {
    "query": {
      "title": "Query",
      "type": "string"
    },
    "engines": {
      "anyOf": [
        {
          "items": {
            "type": "string"
          },
          "type": "array"
        },
        {
          "type": "null"
        }
      ],
      "default": null,
      "title": "Engines"
    },
    "max_results": {
      "default": 10,
      "title": "Max Results",
      "type": "integer"
    },
    "use_cache": {
      "default": true,
      "title": "Use Cache",
      "type": "boolean"
    },
    "max_age_hours": {
      "anyOf": [
        {
          "type": "number"
        },
        {
          "type": "null"
        }
      ],
      "default": null,
      "title": "Max Age Hours"
    },
    "freshness": {
      "anyOf": [
        {
          "enum": [
            "day",
            "week",
            "month",
            "year"
          ],
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "default": null,
      "title": "Freshness"
    },
    "include_domains": {
      "anyOf": [
        {
          "items": {
            "type": "string"
          },
          "type": "array"
        },
        {
          "type": "null"
        }
      ],
      "default": null,
      "title": "Include Domains"
    },
    "exclude_domains": {
      "anyOf": [
        {
          "items": {
            "type": "string"
          },
          "type": "array"
        },
        {
          "type": "null"
        }
      ],
      "default": null,
      "title": "Exclude Domains"
    },
    "category": {
      "anyOf": [
        {
          "enum": [
            "news",
            "pdf",
            "github",
            "paper",
            "forum",
            "blog",
            "image",
            "dataset",
            "finance",
            "software",
            "security",
            "reference",
            "weather",
            "docs",
            "gov",
            "stats",
            "calendar",
            "news.world",
            "paper.index",
            "paper.preprint",
            "paper.biomed",
            "paper.cs",
            "paper.math",
            "paper.openaccess",
            "paper.trial",
            "dataset.repository",
            "dataset.ml",
            "dataset.gov",
            "finance.filings",
            "finance.market",
            "finance.macro",
            "finance.fx",
            "finance.entity",
            "finance.crypto",
            "software.lifecycle",
            "software.github",
            "software.python",
            "software.node",
            "software.rust",
            "software.registry",
            "software.app",
            "security.cve",
            "security.package",
            "security.exploited",
            "reference.domain",
            "docs.web",
            "docs.rfc",
            "gov.us",
            "gov.uk",
            "stats.indicator",
            "calendar.holidays",
            "calendar.clock"
          ],
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "default": null,
      "title": "Category"
    },
    "include_text": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "default": null,
      "title": "Include Text"
    },
    "exclude_text": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "default": null,
      "title": "Exclude Text"
    },
    "format": {
      "default": "markdown",
      "enum": [
        "markdown",
        "json"
      ],
      "title": "Format",
      "type": "string"
    }
  },
  "required": [
    "query"
  ],
  "type": "object",
  "title": "searchArguments"
}
```

### 2. `fetch`
```json
{
  "properties": {
    "url": {
      "title": "Url",
      "type": "string"
    },
    "render": {
      "default": "auto",
      "enum": [
        "auto",
        "http",
        "browser"
      ],
      "title": "Render",
      "type": "string"
    },
    "force_refresh": {
      "default": false,
      "title": "Force Refresh",
      "type": "boolean"
    },
    "max_age_hours": {
      "anyOf": [
        {
          "type": "number"
        },
        {
          "type": "null"
        }
      ],
      "default": null,
      "title": "Max Age Hours"
    },
    "inline": {
      "default": false,
      "title": "Inline",
      "type": "boolean"
    },
    "format": {
      "default": "markdown",
      "enum": [
        "markdown",
        "json"
      ],
      "title": "Format",
      "type": "string"
    }
  },
  "required": [
    "url"
  ],
  "type": "object",
  "title": "fetchArguments"
}
```

### 3. `fetch_batch`
```json
{
  "properties": {
    "urls": {
      "items": {
        "type": "string"
      },
      "title": "Urls",
      "type": "array"
    },
    "render": {
      "default": "auto",
      "enum": [
        "auto",
        "http",
        "browser"
      ],
      "title": "Render",
      "type": "string"
    },
    "format": {
      "default": "markdown",
      "enum": [
        "markdown",
        "json"
      ],
      "title": "Format",
      "type": "string"
    }
  },
  "required": [
    "urls"
  ],
  "type": "object",
  "title": "fetch_batchArguments"
}
```