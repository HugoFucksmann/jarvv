# Esquemas Reales de Entrada de Herramientas MCP

> **Método de obtención:** Consulta directa en tiempo de ejecución al protocolo MCP (`tools/list` sobre transporte stdio JSON-RPC 2.0) hacia los servidores locales activos de `desktop_commander` y `free_search`. No se utilizó el manifest de JARVIS ni documentación estática.

## Resumen Ejecutivo

| Servidor MCP | Comando / Paquete | Herramientas Obtenidas | Estado |
| :--- | :--- | :---: | :--- |
| `desktop_commander` | `npx -y @wonderwhy-er/desktop-commander` | 25 | Obtenido en vivo vía MCP stdio |
| `free_search` | `uvx --from free-search-mcp==0.13.1 --with selectolax==0.3.34 free-search-mcp` | 11 | Obtenido en vivo vía MCP stdio |

*Nota: Windows MCP ha sido explícitamente excluido según las instrucciones.*

---

## 1. Servidor `desktop_commander` (25 herramientas)

### Índice de herramientas:
1. [`get_config`](#11-get-config)
2. [`set_config_value`](#12-set-config-value)
3. [`read_file`](#13-read-file)
4. [`read_multiple_files`](#14-read-multiple-files)
5. [`write_file`](#15-write-file)
6. [`write_pdf`](#16-write-pdf)
7. [`create_directory`](#17-create-directory)
8. [`list_directory`](#18-list-directory)
9. [`move_file`](#19-move-file)
10. [`start_search`](#110-start-search)
11. [`get_more_search_results`](#111-get-more-search-results)
12. [`stop_search`](#112-stop-search)
13. [`list_searches`](#113-list-searches)
14. [`get_file_info`](#114-get-file-info)
15. [`edit_block`](#115-edit-block)
16. [`start_process`](#116-start-process)
17. [`read_process_output`](#117-read-process-output)
18. [`interact_with_process`](#118-interact-with-process)
19. [`force_terminate`](#119-force-terminate)
20. [`list_sessions`](#120-list-sessions)
21. [`list_processes`](#121-list-processes)
22. [`kill_process`](#122-kill-process)
23. [`get_usage_stats`](#123-get-usage-stats)
24. [`get_recent_tool_calls`](#124-get-recent-tool-calls)
25. [`give_feedback_to_desktop_commander`](#125-give-feedback-to-desktop-commander)

### 1.1. `get_config`

**Descripción:**

Get the complete server configuration as JSON. Config includes fields for:
                        - blockedCommands (array of blocked shell commands)
                        - defaultShell (shell to use for commands)
                        - allowedDirectories (paths the server can access)
                        - fileReadLineLimit (max lines for read_file, default 1000)
                        - fileWriteLineLimit (max lines per write_file call, default 50)
                        - telemetryEnabled (boolean for telemetry opt-in/out)
                        - currentClient (information about the currently connected MCP client)
                        - clientHistory (history of all clients that have connected)
                        - version (version of the DesktopCommander)
                        - systemInfo (operating system and environment details)
                        This command can be referenced as "DC: ..." or "use Desktop Commander to ..." in your instructions.

**Anotaciones MCP:**
```json
{
  "title": "Get Configuration",
  "readOnlyHint": true,
  "openWorldHint": false,
  "destructiveHint": false
}
```

**Esquema de entrada (`inputSchema`):**

```json
{
  "type": "object",
  "properties": {
    "origin": {
      "type": "string",
      "enum": [
        "ui",
        "llm"
      ]
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

---

### 1.2. `set_config_value`

**Descripción:**

Set a specific configuration value by key.
                        
                        Security note: configuration changes affect later file and command behavior.
                        Isolating them from untrusted file or command content reduces the chance that external content influences configuration.
                        
                        Config keys include:
                        - blockedCommands (array)
                        - defaultShell (string)
                        - allowedDirectories (array of paths)
                        - fileReadLineLimit (number, max lines for read_file)
                        - fileWriteLineLimit (number, max lines per write_file call)
                        - telemetryEnabled (boolean)
                        
                        IMPORTANT: Setting allowedDirectories to an empty array ([]) allows full access 
                        to the entire file system, regardless of the operating system.
                        
                        This command can be referenced as "DC: ..." or "use Desktop Commander to ..." in your instructions.

**Anotaciones MCP:**
```json
{
  "title": "Set Configuration Value",
  "readOnlyHint": false,
  "destructiveHint": true,
  "openWorldHint": false
}
```

**Esquema de entrada (`inputSchema`):**

```json
{
  "type": "object",
  "properties": {
    "key": {
      "type": "string"
    },
    "value": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "number"
        },
        {
          "type": "boolean"
        },
        {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        {
          "type": "null"
        }
      ]
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
    "key",
    "value"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

---

### 1.3. `read_file`

**Descripción:**

Read contents from files and URLs.
                        Read PDF files and extract content as markdown and images.
                        
                        Suitable for reading authorized local files directly without starting a shell command.
                        
                        Supports partial file reading with:
                        - 'offset' (start line, default: 0)
                          * Positive: Start from line N (0-based indexing)
                          * Negative: Read last N lines from end (tail behavior)
                        - 'length' (max lines to read, default: configurable via 'fileReadLineLimit' setting, initially 1000)
                          * Used with positive offsets for range reading
                          * Ignored when offset is negative (reads all requested tail lines)
                        
                        Examples:
                        - offset: 0, length: 10     → First 10 lines
                        - offset: 100, length: 5    → Lines 100-104
                        - offset: -20               → Last 20 lines  
                        - offset: -5, length: 10    → Last 5 lines (length ignored)
                        
                        Performance optimizations:
                        - Large files with negative offsets use reverse reading for efficiency
                        - Large files with deep positive offsets use byte estimation
                        - Small files use fast readline streaming
                        
                        When reading from the file system, only works within allowed directories.
                        Can fetch content from URLs when isUrl parameter is set to true
                        (URLs are always read in full regardless of offset/length).
                        
                        FORMAT HANDLING (by extension):
                        - Text: Uses offset/length for line-based pagination
                        - Excel (.xlsx, .xls, .xlsm): Returns JSON 2D array
                          * sheet: "Sheet1" (name) or "0" (index as string, 0-based)
                          * range uses FROM:TO format (e.g., "A1:D100", "C1:C1", "B2:B50")
                          * offset/length work as row pagination (optional fallback)
                        - Images (PNG, JPEG, GIF, WebP): Base64 encoded viewable content
                        - PDF: Extracts text content as markdown with page structure
                          * offset/length work as page pagination (0-based)
                          * Includes embedded images when available
                        - DOCX (.docx): Two modes depending on parameters:
                          * DEFAULT (no offset/length): Returns a text-bearing outline — shows paragraphs with text,
                            tables with cell content, styles, image refs. Skips shapes/drawings/SVG noise.
                            Each element shows its body index [0], [1], etc.
                          * WITH offset/length: Returns raw pretty-printed XML with line pagination.
                            Use this to drill into specific sections or see the actual XML for editing.
                          * Raw DOCX XML output is compatible with edit_block's XML find/replace mode using
                            XML fragments copied from the read output.
                          * Raw XML mode requires a non-zero offset (offset=1 starts from line 1).
                            offset=0 returns the outline regardless of length.
                          * Bulk transformations can be performed programmatically against the DOCX archive
                            when the task requires changes across many XML text nodes.

                        Absolute paths are the most reliable because they do not depend on the current working directory. Paths are automatically normalized regardless of slash direction. Relative paths depend on the current working directory, and tilde paths (~/...) may not resolve in every context. Absolute paths are generally the most reliable.
                        This command can be referenced as "DC: ..." or "use Desktop Commander to ..." in your instructions.

**Anotaciones MCP:**
```json
{
  "title": "Read File or URL",
  "readOnlyHint": true,
  "openWorldHint": true,
  "destructiveHint": false
}
```

**Esquema de entrada (`inputSchema`):**

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

---

### 1.4. `read_multiple_files`

**Descripción:**

Read the contents of multiple files simultaneously.
                        
                        Each file's content is returned with its path as a reference.
                        Handles text files normally and renders images as viewable content.
                        Recognized image types: PNG, JPEG, GIF, WebP.
                        
                        Failed reads for individual files won't stop the entire operation.
                        Only works within allowed directories.
                        
                        Absolute paths are the most reliable because they do not depend on the current working directory. Paths are automatically normalized regardless of slash direction. Relative paths depend on the current working directory, and tilde paths (~/...) may not resolve in every context. Absolute paths are generally the most reliable.
                        This command can be referenced as "DC: ..." or "use Desktop Commander to ..." in your instructions.

**Anotaciones MCP:**
```json
{
  "title": "Read Multiple Files",
  "readOnlyHint": true,
  "openWorldHint": false,
  "destructiveHint": false
}
```

**Esquema de entrada (`inputSchema`):**

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

---

### 1.5. `write_file`

**Descripción:**

Write or append to file contents.

                        PDF creation is handled by the dedicated write_pdf tool.
                        Existing DOCX content can be edited with edit_block. New DOCX files can be created here; markdown headings (#, ##, ###) are converted to styled DOCX paragraphs.

                        CHUNKED WRITES:
                        - Repeated calls with mode='rewrite' followed by mode='append' are supported for longer files.
                        - Chunks of roughly 25-30 lines minimize latency when writing long text, multiple files, documentation, code, or configuration files.
                        - Files over 50 lines are still written successfully but may generate performance notes.
                        - For continuation after a partial write, the existing file state can be inspected before appending the remaining content.

                        FORMAT HANDLING (by extension):
                        - Text files: String content
                        - Excel (.xlsx, .xls, .xlsm): JSON 2D array or {"SheetName": [[...]]}
                          Example: '[["Name","Age"],["Alice",30]]'

                        Only works within allowed directories.

                        Absolute paths are the most reliable because they do not depend on the current working directory. Paths are automatically normalized regardless of slash direction. Relative paths depend on the current working directory, and tilde paths (~/...) may not resolve in every context. Absolute paths are generally the most reliable.
                        This command can be referenced as "DC: ..." or "use Desktop Commander to ..." in your instructions.

**Anotaciones MCP:**
```json
{
  "title": "Write File",
  "readOnlyHint": false,
  "destructiveHint": true,
  "openWorldHint": false
}
```

**Esquema de entrada (`inputSchema`):**

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

---

### 1.6. `write_pdf`

**Descripción:**

Create a new PDF file or modify an existing one.

                        Dedicated PDF creation and modification tool.

                        OUTPUT FILES:
                        - Creating a PDF requires 'outputPath' with a new filename (e.g., "result_01.pdf", "analysis_2025_01.pdf", etc.).

                        MODES:
                        1. CREATE NEW PDF:
                           - Pass a markdown string as 'content'.
                           write_pdf(path="doc.pdf", content="# Title\n\nBody text...")

                        2. MODIFY EXISTING PDF:
                           - Pass array of operations as 'content'.
                           - Modifications preserve the original PDF and require a different filename in 'outputPath'.
                           - The result includes the original and output paths for reference.

                           write_pdf(path="doc.pdf", content=[
                               { type: "delete", pageIndexes: [0, 2] },
                               { type: "insert", pageIndex: 1, markdown: "# New Page" }
                           ])

                        OPERATIONS:
                        - delete: Remove pages by 0-based index.
                          { type: "delete", pageIndexes: [0, 1, 5] }

                        - insert: Add pages at a specific 0-based index.
                          { type: "insert", pageIndex: 0, markdown: "..." }
                          { type: "insert", pageIndex: 5, sourcePdfPath: "/path/to/source.pdf" }

                        PAGE BREAKS:
                        To force a page break, use this HTML element:
                        <div style="page-break-before: always;"></div>
                        
                        Example:
                        "# Page 1\n\n<div style=\"page-break-before: always;\"></div>\n\n# Page 2"

                        ADVANCED STYLING:
                        HTML/CSS and inline SVG are supported for:
                        - Text styling: colors, sizes, alignment, highlights
                        - Boxes: borders, backgrounds, padding, rounded corners
                        - SVG graphics: charts, diagrams, icons, shapes
                        - Images: <img src="/absolute/path/image.jpg" width="300" /> or ![alt](/path/image.jpg)

                        Supports standard markdown features including headers, lists, code blocks, tables, and basic formatting.

                        Only works within allowed directories.

                        Absolute paths are the most reliable because they do not depend on the current working directory. Paths are automatically normalized regardless of slash direction. Relative paths depend on the current working directory, and tilde paths (~/...) may not resolve in every context. Absolute paths are generally the most reliable.
                        This command can be referenced as "DC: ..." or "use Desktop Commander to ..." in your instructions.

**Anotaciones MCP:**
```json
{
  "title": "Write/Modify PDF",
  "readOnlyHint": false,
  "destructiveHint": true,
  "openWorldHint": false
}
```

**Esquema de entrada (`inputSchema`):**

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string"
    },
    "content": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "const": "insert"
                  },
                  "pageIndex": {
                    "type": "number"
                  },
                  "markdown": {
                    "type": "string"
                  },
                  "sourcePdfPath": {
                    "type": "string"
                  },
                  "pdfOptions": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": true
                  }
                },
                "required": [
                  "type",
                  "pageIndex"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "const": "delete"
                  },
                  "pageIndexes": {
                    "type": "array",
                    "items": {
                      "type": "number"
                    }
                  }
                },
                "required": [
                  "type",
                  "pageIndexes"
                ],
                "additionalProperties": false
              }
            ]
          }
        }
      ]
    },
    "outputPath": {
      "type": "string"
    },
    "options": {
      "type": "object",
      "properties": {},
      "additionalProperties": true
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

---

### 1.7. `create_directory`

**Descripción:**

Create a new directory or ensure a directory exists.
                        
                        Can create multiple nested directories in one operation.
                        Only works within allowed directories.
                        
                        Absolute paths are the most reliable because they do not depend on the current working directory. Paths are automatically normalized regardless of slash direction. Relative paths depend on the current working directory, and tilde paths (~/...) may not resolve in every context. Absolute paths are generally the most reliable.
                        This command can be referenced as "DC: ..." or "use Desktop Commander to ..." in your instructions.

**Anotaciones MCP:**
```json
{
  "title": "Create Directory",
  "readOnlyHint": false,
  "openWorldHint": false,
  "destructiveHint": false
}
```

**Esquema de entrada (`inputSchema`):**

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

---

### 1.8. `list_directory`

**Descripción:**

Get a detailed listing of all files and directories in a specified path.
                        
                        Returns a structured directory listing without starting a shell command.
                        Results distinguish between files and directories with [FILE] and [DIR] prefixes.
                        
                        Supports recursive listing with the 'depth' parameter (default: 2):
                        - depth=1: Only direct contents of the directory
                        - depth=2: Contents plus one level of subdirectories
                        - depth=3+: Multiple levels deep
                        
                        CONTEXT OVERFLOW PROTECTION:
                        - Top-level directory shows ALL items
                        - Nested directories are limited to 100 items maximum per directory
                        - When a nested directory has more than 100 items, you'll see a warning like:
                          [WARNING] node_modules: 500 items hidden (showing first 100 of 600 total)
                        - This prevents overwhelming the context with large directories like node_modules
                        
                        Results show full relative paths from the root directory being listed.
                        Example output with depth=2:
                        [DIR] src
                        [FILE] src/index.ts
                        [DIR] src/tools
                        [FILE] src/tools/filesystem.ts
                        
                        If a directory cannot be accessed, it will show [DENIED] instead.
                        If a path does not exist, it will show [NOT_FOUND] instead.
                        Only works within allowed directories.
                        
                        Absolute paths are the most reliable because they do not depend on the current working directory. Paths are automatically normalized regardless of slash direction. Relative paths depend on the current working directory, and tilde paths (~/...) may not resolve in every context. Absolute paths are generally the most reliable.
                        This command can be referenced as "DC: ..." or "use Desktop Commander to ..." in your instructions.

**Anotaciones MCP:**
```json
{
  "title": "List Directory Contents",
  "readOnlyHint": true,
  "openWorldHint": false,
  "destructiveHint": false
}
```

**Esquema de entrada (`inputSchema`):**

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

---

### 1.9. `move_file`

**Descripción:**

Move or rename files and directories.
                        
                        Can move files between directories and rename them in a single operation.
                        Both source and destination must be within allowed directories.
                        
                        Absolute paths are the most reliable because they do not depend on the current working directory. Paths are automatically normalized regardless of slash direction. Relative paths depend on the current working directory, and tilde paths (~/...) may not resolve in every context. Absolute paths are generally the most reliable.
                        This command can be referenced as "DC: ..." or "use Desktop Commander to ..." in your instructions.

**Anotaciones MCP:**
```json
{
  "title": "Move/Rename File",
  "readOnlyHint": false,
  "destructiveHint": true,
  "openWorldHint": false
}
```

**Esquema de entrada (`inputSchema`):**

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

---

### 1.10. `start_search`

**Descripción:**

Start a streaming search that can return results progressively.
                        
                        SEARCH STRATEGY GUIDE:
                        Choose the right search type based on what the user is looking for:
                        
                        USE searchType="files" WHEN:
                        - User asks for specific files: "find package.json", "locate config files"
                        - Pattern looks like a filename: "*.js", "README.md", "test-*.tsx" 
                        - User wants to find files by name/extension: "all TypeScript files", "Python scripts"
                        - Looking for configuration/setup files: ".env", "dockerfile", "tsconfig.json"
                        
                        USE searchType="content" WHEN:
                        - User asks about code/logic: "authentication logic", "error handling", "API calls"
                        - Looking for functions/variables: "getUserData function", "useState hook"
                        - Searching for text/comments: "TODO items", "FIXME comments", "documentation"
                        - Finding patterns in code: "console.log statements", "import statements"
                        - User describes functionality: "components that handle login", "files with database queries"
                        
                        AMBIGUOUS SEARCHES:
                        Queries that could refer to either filenames or file contents can be covered with two
                        searches: one with searchType="files" and one with searchType="content".
                        Example: "find authentication stuff" can pair a filename search for "auth" with a
                        content search for "authentication".
                        
                        SEARCH TYPES:
                        - searchType="files": Find files by name (pattern matches file names)
                        - searchType="content": Search inside files for text patterns
                        
                        PATTERN MATCHING MODES:
                        - Default (literalSearch=false): Patterns are treated as regular expressions
                        - Literal (literalSearch=true): Patterns are treated as exact strings
                        
                        literalSearch=true is useful for code patterns with special characters:
                        - Function calls with parentheses and quotes
                        - Array access with brackets
                        - Object methods with dots and parentheses
                        - File paths with backslashes
                        - Any pattern containing: . * + ? ^ $ { } [ ] | \ ( )
                        
                        IMPORTANT PARAMETERS:
                        - pattern: What to search for (file names OR content text)
                        - literalSearch: Use exact string matching instead of regex (default: false)
                        - filePattern: Optional filter to limit search to specific file types (e.g., "*.js", "package.json")
                        - ignoreCase: Case-insensitive search (default: true). Works for both file names and content.
                        - earlyTermination: Stop search early when exact filename match is found (optional: defaults to true for file searches, false for content searches)
                        
                        DECISION EXAMPLES:
                        - "find package.json" → searchType="files", pattern="package.json" (specific file)
                        - "find authentication components" → searchType="content", pattern="authentication" (looking for functionality)
                        - "locate all React components" → searchType="files", pattern="*.tsx" or "*.jsx" (file pattern)
                        - "find TODO comments" → searchType="content", pattern="TODO" (text in files)
                        - "show me login files" → AMBIGUOUS → run both: files with "login" AND content with "login"
                        - "find config" → AMBIGUOUS → run both: config files AND files containing config code
                        
                        COMPREHENSIVE SEARCH EXAMPLES:
                        - Find package.json files: searchType="files", pattern="package.json"
                        - Find all JS files: searchType="files", pattern="*.js"
                        - Search for TODO in code: searchType="content", pattern="TODO", filePattern="*.js|*.ts"
                        - Search for exact code: searchType="content", pattern="toast.error('test')", literalSearch=true
                        - Ambiguous request "find auth stuff": Run two searches:
                          1. searchType="files", pattern="auth"
                          2. searchType="content", pattern="authentication"
                        
                        Ambiguous requests can combine file-name and content searches for broader coverage.
                        
                        This tool starts a background search process and returns immediately with a session ID.
                        Results are available through get_more_search_results, and stop_search can end the search early.
                        
                        Perfect for large directories where you want to see results immediately and
                        have the option to cancel if the search takes too long or you find what you need.
                        
                        Absolute paths are the most reliable because they do not depend on the current working directory. Paths are automatically normalized regardless of slash direction. Relative paths depend on the current working directory, and tilde paths (~/...) may not resolve in every context. Absolute paths are generally the most reliable.
                        This command can be referenced as "DC: ..." or "use Desktop Commander to ..." in your instructions.

**Anotaciones MCP:**
```json
{
  "title": "Start Search",
  "readOnlyHint": true,
  "openWorldHint": false,
  "destructiveHint": false
}
```

**Esquema de entrada (`inputSchema`):**

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

---

### 1.11. `get_more_search_results`

**Descripción:**

Get more results from an active search with offset-based pagination.
                        
                        Supports partial result reading with:
                        - 'offset' (start result index, default: 0)
                          * Positive: Start from result N (0-based indexing)
                          * Negative: Read last N results from end (tail behavior)
                        - 'length' (max results to read, default: 100)
                          * Used with positive offsets for range reading
                          * Ignored when offset is negative (reads all requested tail results)
                        
                        Examples:
                        - offset: 0, length: 100     → First 100 results
                        - offset: 200, length: 50    → Results 200-249
                        - offset: -20                → Last 20 results
                        - offset: -5, length: 10     → Last 5 results (length ignored)
                        
                        Returns only results in the specified range, along with search status.
                        Works like read_process_output - call this repeatedly to get progressive
                        results from a search started with start_search.
                        
                        This command can be referenced as "DC: ..." or "use Desktop Commander to ..." in your instructions.

**Anotaciones MCP:**
```json
{
  "title": "Get Search Results",
  "readOnlyHint": true,
  "openWorldHint": false,
  "destructiveHint": false
}
```

**Esquema de entrada (`inputSchema`):**

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

---

### 1.12. `stop_search`

**Descripción:**

Stop an active search.
                        
                        Stops the background search process gracefully. Use this when you've found
                        what you need or if a search is taking too long. Similar to force_terminate
                        for terminal processes.
                        
                        The search will still be available for reading final results until it's
                        automatically cleaned up after 5 minutes.
                        
                        This command can be referenced as "DC: ..." or "use Desktop Commander to ..." in your instructions.

**Anotaciones MCP:**
```json
{
  "title": "Stop Search",
  "readOnlyHint": false,
  "openWorldHint": false,
  "destructiveHint": false
}
```

**Esquema de entrada (`inputSchema`):**

```json
{
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    }
  },
  "required": [
    "sessionId"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

---

### 1.13. `list_searches`

**Descripción:**

List all active searches.
                        
                        Shows search IDs, search types, patterns, status, and runtime.
                        Similar to list_sessions for terminal processes. Useful for managing
                        multiple concurrent searches.
                        
                        This command can be referenced as "DC: ..." or "use Desktop Commander to ..." in your instructions.

**Anotaciones MCP:**
```json
{
  "title": "List Active Searches",
  "readOnlyHint": true,
  "openWorldHint": false,
  "destructiveHint": false
}
```

**Esquema de entrada (`inputSchema`):**

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

---

### 1.14. `get_file_info`

**Descripción:**

Retrieve detailed metadata about a file or directory including:
                        - size
                        - creation time
                        - last modified time
                        - permissions
                        - type
                        - lineCount (for text files)
                        - lastLine (zero-indexed number of last line, for text files)
                        - appendPosition (line number for appending, for text files)
                        - sheets (for Excel files - array of {name, rowCount, colCount})

                        Only works within allowed directories.
                        
                        Absolute paths are the most reliable because they do not depend on the current working directory. Paths are automatically normalized regardless of slash direction. Relative paths depend on the current working directory, and tilde paths (~/...) may not resolve in every context. Absolute paths are generally the most reliable.
                        This command can be referenced as "DC: ..." or "use Desktop Commander to ..." in your instructions.

**Anotaciones MCP:**
```json
{
  "title": "Get File Information",
  "readOnlyHint": true,
  "openWorldHint": false,
  "destructiveHint": false
}
```

**Esquema de entrada (`inputSchema`):**

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

---

### 1.15. `edit_block`

**Descripción:**

Apply surgical edits to files.

                        Small, focused edits are easier to verify than large multi-purpose replacements.
                        old_string can include enough surrounding context to uniquely identify the intended text.

                        FORMAT HANDLING (by extension):

                        EXCEL FILES (.xlsx, .xls, .xlsm) - Range Update mode:
                        Takes:
                        - file_path: Path to the Excel file
                        - range uses FROM:TO format - "SheetName!A1:C10" or "SheetName!C1:C1"
                        - content: 2D array, e.g., [["H1","H2"],["R1","R2"]]

                        TEXT FILES - Find/Replace mode:
                        Takes:
                        - file_path: Path to the file to edit
                        - old_string: Text to replace
                        - new_string: Replacement text
                        - expected_replacements: Optional number of replacements (default: 1)

                        DOCX FILES (.docx) - XML Find/Replace mode:
                        Takes same parameters as text files (old_string, new_string, expected_replacements).
                        Operates on the pretty-printed XML inside the DOCX — the same XML you see from
                        read_file with offset/length. Copy XML fragments from read output as old_string.
                        After editing, the XML is repacked into a valid DOCX.
                        Also searches headers/footers if not found in document body.
                        Examples:
                        - Replace text: old_string="<w:t>Old Text</w:t>" new_string="<w:t>New Text</w:t>"
                        - Change style: old_string='<w:pStyle w:val="Normal"/>' new_string='<w:pStyle w:val="Heading1"/>'
                        - Add content: include surrounding XML context in old_string, add new elements in new_string

                        By default, replaces only ONE occurrence of the search text.
                        To replace multiple occurrences, provide expected_replacements with
                        the exact number of matches expected.

                        UNIQUENESS REQUIREMENT: When expected_replacements=1 (default), include the minimal
                        amount of context necessary (typically 1-3 lines) before and after the change point,
                        with exact whitespace and indentation.

                        When editing multiple sections, make separate edit_block calls for each distinct change
                        rather than one large replacement.

                        When a close but non-exact match is found, a character-level diff is shown in the format:
                        common_prefix{-removed-}{+added+}common_suffix to help you identify what's different.

                        Similar to write_file, there is a configurable line limit (fileWriteLineLimit) that warns
                        if the edited file exceeds this limit. If this happens, consider breaking your edits into
                        smaller, more focused changes.

                        Absolute paths are the most reliable because they do not depend on the current working directory. Paths are automatically normalized regardless of slash direction. Relative paths depend on the current working directory, and tilde paths (~/...) may not resolve in every context. Absolute paths are generally the most reliable.
                        This command can be referenced as "DC: ..." or "use Desktop Commander to ..." in your instructions.

**Anotaciones MCP:**
```json
{
  "title": "Edit Block",
  "readOnlyHint": false,
  "destructiveHint": true,
  "openWorldHint": false
}
```

**Esquema de entrada (`inputSchema`):**

```json
{
  "type": "object",
  "properties": {
    "file_path": {
      "type": "string"
    },
    "old_string": {
      "type": "string"
    },
    "new_string": {
      "type": "string"
    },
    "expected_replacements": {
      "type": "number",
      "default": 1
    },
    "range": {
      "type": "string"
    },
    "content": {},
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
    "file_path"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

---

### 1.16. `start_process`

**Descripción:**

Start a terminal process on the authorized device with intelligent state detection.
                        
                        Suitable for shell commands, interactive REPL sessions, data-processing scripts,
                        programmatic file analysis, and other long-running terminal work.
                        
                        Running on Windows. Default shell: powershell.exe.
        
WINDOWS-SPECIFIC TROUBLESHOOTING:
- If Node.js/Python commands fail with "not recognized" errors:
  * Alternative shells include "cmd" and "powershell.exe"
  * PowerShell may have execution policy restrictions for some tools
  * CMD typically has better compatibility with development tools
  * defaultShell can be changed with set_config_value if needed
- Windows services and processes use different commands (Get-Process vs ps)
- Package managers: choco, winget, scoop instead of apt/brew
- Environment variables: $env:VAR instead of $VAR
- File permissions work differently than Unix systems
                        
                        Examples:
                        • start_process("python3 -i") → Start an interactive Python REPL
                        • start_process("node -i") → Start an interactive Node.js REPL
                        • start_process("node:local") → Run stateless Node.js code on the MCP server
                        • start_process("wc -l /path/file.csv") → Run a one-shot shell command

                        Interactive process sessions support follow-up input after they are started.
                        Long-running process sessions expose newly available output while they remain active.
                        Binary files can be processed with appropriate command-line tools or libraries available
                        in the selected process environment.

                        SMART DETECTION:
                        - Detects REPL prompts (>>>, >, $, etc.)
                        - Identifies when a process is waiting for input
                        - Recognizes process completion vs timeout
                        - Early exit prevents unnecessary waiting
                        
                        STATES DETECTED:
                        Process waiting for input (shows prompt)
                        Process finished execution
                        Process running (use read_process_output)

                        PERFORMANCE DEBUGGING (verbose_timing parameter):
                        Set verbose_timing: true to get detailed timing information including:
                        - Exit reason (early_exit_quick_pattern, early_exit_periodic_check, process_exit, timeout)
                        - Total duration and time to first output
                        - Complete timeline of all output events with timestamps
                        - Which detection mechanism triggered early exit

                        Absolute paths are the most reliable because they do not depend on the current working directory. Paths are automatically normalized regardless of slash direction. Relative paths depend on the current working directory, and tilde paths (~/...) may not resolve in every context. Absolute paths are generally the most reliable.
                        This command can be referenced as "DC: ..." or "use Desktop Commander to ..." in your instructions.

**Anotaciones MCP:**
```json
{
  "title": "Start Terminal Process",
  "readOnlyHint": false,
  "destructiveHint": true,
  "openWorldHint": true
}
```

**Esquema de entrada (`inputSchema`):**

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

---

### 1.17. `read_process_output`

**Descripción:**

Read output from a running process with file-like pagination support.
                        
                        Supports partial output reading with offset and length parameters (like read_file):
                        - 'offset' (start line, default: 0)
                          * offset=0: Read NEW output since last read (default, like old behavior)
                          * Positive: Read from absolute line position
                          * Negative: Read last N lines from end (tail behavior)
                        - 'length' (max lines to read, default: configurable via 'fileReadLineLimit' setting)
                        
                        Examples:
                        - offset: 0, length: 100     → First 100 NEW lines since last read
                        - offset: 0                  → All new lines (respects config limit)
                        - offset: 500, length: 50    → Lines 500-549 (absolute position)
                        - offset: -20                → Last 20 lines (tail)
                        - offset: -50, length: 10    → Start 50 from end, read 10 lines
                        
                        OUTPUT PROTECTION:
                        - Uses same fileReadLineLimit as read_file (default: 1000 lines)
                        - Returns status like: [Reading 100 lines from line 0 (total: 5000 lines, 4900 remaining)]
                        - Prevents context overflow from verbose processes
                        
                        SMART FEATURES:
                        - For offset=0, waits up to timeout_ms for new output to arrive
                        - Detects REPL prompts and process completion
                        - Shows process state (waiting for input, finished, etc.)
                        
                        DETECTION STATES:
                        Process waiting for input (ready for interact_with_process)
                        Process finished execution
                        Timeout reached (may still be running)

                        This command can be referenced as "DC: ..." or "use Desktop Commander to ..." in your instructions.

**Anotaciones MCP:**
```json
{
  "title": "Read Process Output",
  "readOnlyHint": true,
  "openWorldHint": false,
  "destructiveHint": false
}
```

**Esquema de entrada (`inputSchema`):**

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

---

### 1.18. `interact_with_process`

**Descripción:**

Send input to an existing terminal or REPL process and return newly available output.
                        
                        Useful for interactive shells, Python/Node/R/Julia REPLs, database consoles,
                        and long-running commands started with start_process().
                        
                        Examples:
                        - Interactive Python REPL sessions can be started with `python3 -i`.
                        - Existing interactive sessions accept additional input such as imports or analysis commands.
                        - Interactive sessions can return newly available output while they remain active.
                        
                        SMART DETECTION:
                        - Automatically waits for a recognized prompt when requested
                        - Detects errors and completion states
                        - Early exit prevents unnecessary waiting
                        - Cleans common REPL prompt text from returned output
                        
                        PARAMETERS:
                        - pid: Process ID returned by start_process
                        - input: Text or command to send to the process
                        - timeout_ms: Maximum wait time (default: 8000ms)
                        - wait_for_prompt: Whether to wait for a prompt before returning (default: true)
                        - verbose_timing: Include detailed timing telemetry (default: false)

                        Returns execution result with status indicators.

                        PERFORMANCE DEBUGGING (verbose_timing parameter):
                        When enabled, detailed timing includes:
                        - Exit reason
                        - Total duration and time to first output
                        - Timeline of output events

                        This command can be referenced as "DC: ..." or "use Desktop Commander to ..." in your instructions.

**Anotaciones MCP:**
```json
{
  "title": "Send Input to Process",
  "readOnlyHint": false,
  "destructiveHint": true,
  "openWorldHint": true
}
```

**Esquema de entrada (`inputSchema`):**

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

### 1.19. `force_terminate`

**Descripción:**

Force terminate a running terminal session.
                        
                        This command can be referenced as "DC: ..." or "use Desktop Commander to ..." in your instructions.

**Anotaciones MCP:**
```json
{
  "title": "Force Terminate Process",
  "readOnlyHint": false,
  "destructiveHint": true,
  "openWorldHint": false
}
```

**Esquema de entrada (`inputSchema`):**

```json
{
  "type": "object",
  "properties": {
    "pid": {
      "type": "number"
    }
  },
  "required": [
    "pid"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

---

### 1.20. `list_sessions`

**Descripción:**

List all active terminal sessions.
                        
                        Shows session status including:
                        - PID: Process identifier  
                        - Blocked: Whether session is waiting for input
                        - Runtime: How long the session has been running
                        
                        DEBUGGING REPLs:
                        - "Blocked: true" often means REPL is waiting for input
                        - Use this to verify sessions are running before sending input
                        - Long runtime with blocked status may indicate stuck process
                        
                        This command can be referenced as "DC: ..." or "use Desktop Commander to ..." in your instructions.

**Anotaciones MCP:**
```json
{
  "title": "List Terminal Sessions",
  "readOnlyHint": true,
  "openWorldHint": false,
  "destructiveHint": false
}
```

**Esquema de entrada (`inputSchema`):**

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

---

### 1.21. `list_processes`

**Descripción:**

List all running processes.
                        
                        Returns process information including PID, command name, CPU usage, and memory usage.
                        
                        This command can be referenced as "DC: ..." or "use Desktop Commander to ..." in your instructions.

**Anotaciones MCP:**
```json
{
  "title": "List Running Processes",
  "readOnlyHint": true,
  "openWorldHint": false,
  "destructiveHint": false
}
```

**Esquema de entrada (`inputSchema`):**

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

---

### 1.22. `kill_process`

**Descripción:**

Terminate a running process by PID.

                        Use with caution as this will forcefully terminate the specified process.

                        This command can be referenced as "DC: ..." or "use Desktop Commander to ..." in your instructions.

**Anotaciones MCP:**
```json
{
  "title": "Kill Process",
  "readOnlyHint": false,
  "destructiveHint": true,
  "openWorldHint": false
}
```

**Esquema de entrada (`inputSchema`):**

```json
{
  "type": "object",
  "properties": {
    "pid": {
      "type": "number"
    }
  },
  "required": [
    "pid"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

---

### 1.23. `get_usage_stats`

**Descripción:**

Get usage statistics for debugging and analysis.
                        
                        Returns summary of tool usage, success/failure rates, and performance metrics.
                        
                        This command can be referenced as "DC: ..." or "use Desktop Commander to ..." in your instructions.

**Anotaciones MCP:**
```json
{
  "title": "Get Usage Statistics",
  "readOnlyHint": true,
  "openWorldHint": false,
  "destructiveHint": false
}
```

**Esquema de entrada (`inputSchema`):**

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

---

### 1.24. `get_recent_tool_calls`

**Descripción:**

Get recent local tool call history with arguments and outputs.
                        Returns a chronological list of recent calls loaded from the local history file.
                        
                        Useful for:
                        - Onboarding new chats about work already done
                        - Recovering context after chat history loss
                        - Debugging tool call sequences
                        
                        Note: Does not track its own calls or track_ui_event.
                        History is persisted locally in tool-history.jsonl, keeps up to the last 1000
                        calls in memory, and trims older on-disk history. Stored outputs over 4 KiB
                        are replaced with an omission marker.
                        
                        This command can be referenced as "DC: ..." or "use Desktop Commander to ..." in your instructions.

**Anotaciones MCP:**
```json
{
  "title": "Get Recent Tool Calls",
  "readOnlyHint": true,
  "openWorldHint": false,
  "destructiveHint": false
}
```

**Esquema de entrada (`inputSchema`):**

```json
{
  "type": "object",
  "properties": {
    "maxResults": {
      "type": "number",
      "minimum": 1,
      "maximum": 1000,
      "default": 50
    },
    "toolName": {
      "type": "string"
    },
    "since": {
      "type": "string",
      "format": "date-time"
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

---

### 1.25. `give_feedback_to_desktop_commander`

**Descripción:**

Open feedback form in browser to provide feedback about Desktop Commander.
                        
                        The form itself collects survey answers; this tool does not accept survey responses or
                        pre-fill them. It automatically includes basic usage metadata:
                        - tool_call_count: Number of commands made
                        - days_using: Number of days Desktop Commander has been used
                        - platform: Operating system (Mac/Windows/Linux)
                        - client_id: Analytics identifier

                        No input parameters are required.
                        
                        This command can be referenced as "DC: ..." or "use Desktop Commander to ..." in your instructions.

**Anotaciones MCP:**
```json
{
  "title": "Give Feedback",
  "readOnlyHint": false,
  "openWorldHint": true,
  "destructiveHint": false
}
```

**Esquema de entrada (`inputSchema`):**

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

---

## 2. Servidor `free_search` (11 herramientas)

### Índice de herramientas:
1. [`search`](#21-search)
2. [`fetch`](#22-fetch)
3. [`fetch_batch`](#23-fetch-batch)
4. [`read_doc`](#24-read-doc)
5. [`research`](#25-research)
6. [`paper_graph`](#26-paper-graph)
7. [`cache_search`](#27-cache-search)
8. [`engines`](#28-engines)
9. [`compare`](#29-compare)
10. [`extract_structured`](#210-extract-structured)
11. [`download`](#211-download)

### 2.1. `search` — *Web search (multi-engine, no API key)*

**Descripción:**

Run a multi-engine web search and return a ranked, deduplicated link list.

Best for:
- Discovery queries ("what is X", "find me X", "who is X").
- Getting a list of URLs you can hand to `fetch` / `fetch_batch` next.
- Topics likely to be after your knowledge cutoff (use `freshness="week"`).
- Filtering to specific domains (`include_domains=["python.org"]`) or
  a kind of source (`category="paper"` / `"finance"`, or a sub-group like
  `category="paper.biomed"` / `"finance.filings"`; see `engines()` for the
  full tree).
- Looking a fact up at its registry, with no category needed: a current
  version or support end date ("latest fastapi version"), a CVE
  ("CVE-2024-3094": NVD record, OSV advisories, CISA exploited status),
  a forecast ("上海明天天气"), an exchange rate ("100 usd to cny": ECB, and
  the PBOC parity for 人民币), a coin price, a country indicator ("china
  gdp", "japan population"), public holidays ("2026年放假安排"), the current
  time in a city, a domain's expiry, a company's legal entity, an iOS
  app's version, Wikidata facts ("Shanghai population"). The source that
  fits the words joins the search and its record arrives as the first
  result with the publisher's date in `dated …`, so it can be cited
  without a fetch. Name the thing plainly. `category=` ("software",
  "security", "weather", "finance.fx", "stats", "calendar", "reference",
  "docs", "gov") asks the same sources explicitly.

Not recommended for:
- You already know the URL -> use `fetch` instead.
- You want both links AND their full text in one call -> use `research`.
- You want to query pages already in the local cache -> use `cache_search`.
- Reading PDFs/DOCX from a known URL -> use `read_doc`.
- Following one paper's references or citations -> use `paper_graph`.

Returns:
- markdown (default): numbered list of `n. title`, `<url>`, snippet. About 40%
  fewer tokens than json.
- json: dict with `results` (list of {title,url,snippet,engines,score}),
  `engines`, `cached`, optional `errors` map, optional `hint` string.
  `engines` is what was actually ASKED for this answer; each result's own
  `engines` is what found it. A default engine that failed recently is not
  asked and appears under `benched_engines` instead; a rescue pass that
  substituted a source appears as `rescued_via`.

Common mistakes:
- Answering from snippets. A snippet is an engine's summary of a page as it
  looked when crawled: it drops qualifiers and is often years old. Use
  `search` to find the URL, then read the page (`fetch`, `research`) for
  any date, amount, rule, deadline or number you will state.
- Treating a result as recent because `freshness=` was set. The filter keeps
  undated results; the header says how many could be dated (`dated: 3/10`)
  and each result is marked `dated …`, `… (from snippet text)` or `undated`.
- Passing a URL as `query`: that is `fetch`'s job.
- Cranking `max_results` up hoping for better recall; engines cap around
  10-20 each, anything beyond is duplicate noise (and 50 is the ceiling).
- Naming engines by default. The default pool is already the set that works
  keylessly over plain HTTP, it benches an engine that starts failing and
  seats a reserve when it gets thin, and naming engines switches all of
  that, and `category=` routing, off. Name engines when you want a
  specific index: `engines=["so360","baidu"]` for Chinese-language sites,
  `engines=["brave"]` or `["startpage"]` (both need the browser) for a
  second opinion.
- Using `category="news"` for breaking news without also setting
  `freshness="day"`: the index lags by days.

Args:
    query: Natural-language query (the same string a human would type).
    engines: Subset of `engines()`. None (recommended) = the health-aware
        default pool: duckduckgo, bing, anysearch and mojeek, plus
        googlenews when `freshness` is "day"/"week" and a Chinese index for
        a Chinese query.
    max_results: Merged result count after dedup, clamped to 1-50. It is
        also the PER-ENGINE budget, so it multiplies across the fan-out;
        5-20 is the useful range and anything past that is duplicate noise
        bought with real latency. Omit it for the configured default.
    use_cache: Reuse the last result for this exact (query, engines,
        max_results, AND all active filters: freshness, include/exclude
        domains, category, include/exclude text) within the cache TTL.
        Changing any filter is a different cache entry. False forces a
        re-fetch.
    max_age_hours: Treat cached results older than this as a read miss; a
        fresh result is ALWAYS written back to the cache regardless of this
        value, so caching is never disabled. Use 0 to force-refresh while
        keeping cache writes; None = use server default TTL (7 days).
    freshness: "day"|"week"|"month"|"year". Restricts to recent results.
        Best-effort: applied as an engine time-window param AND a client-side
        date check, but most HTML-engine results carry no parseable date, so
        undated results are kept rather than dropped (unknown != old). Treat
        it as a strong hint, not a hard filter; googlenews dates are exact.
    include_domains: List of domains to restrict to (e.g. ["python.org"]).
    exclude_domains: List of domains to exclude.
    category: Which KIND of source to search. The enum lists every value.
        A bare group widens: "paper" adds one specialist per sub-group to the
        default web pool. A dotted sub-group narrows to just the sources that
        index it ("paper.biomed" => the biomedical indexes only). It also
        RERANKS: engines that natively index the category count double in
        the fusion, so the filing outranks the commentary about it, and a
        record looked up by the query (a PyPI release, a CVE, an ECB rate,
        a forecast) counts five times, so it leads the list. Call
        `engines()` for the group -> sub-group -> engine tree with a line on
        each source. Two behaviours worth knowing: "image"/"dataset" REPLACE
        the web pool rather than augment it (a web engine cannot return an
        image file), and "news"/"paper"/"forum"/"github"/"blog" also filter
        general-web hits by hostname, so a strict category can thin those
        engines out. The specialists it routes to are exempt.
    include_text: Substring required in title or snippet (case-insensitive).
    exclude_text: Substring forbidden in title or snippet.
    format: "markdown" (default) or "json".

**Anotaciones MCP:**
```json
{
  "idempotentHint": false,
  "openWorldHint": true,
  "readOnlyHint": true
}
```

**Esquema de entrada (`inputSchema`):**

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

---

### 2.2. `fetch` — *Fetch a URL: page text, document, or resource*

**Descripción:**

Fetch one URL: page text, or a description of a non-text resource.

Handles any http(s) resource, not just HTML:
- HTML pages -> reader-mode Markdown (nav/footer/scripts stripped).
- PDF/DOCX/XLSX/PPTX/EPUB/CSV/code/archives -> parsed text (same engine as
  `read_doc`, which you should prefer when you need pagination).
- Images, video, audio, fonts, opaque binaries -> a description
  (media type, byte size, dimensions, sha256), NOT the bytes.

Best for:
- You already have a URL (from `search`, the user, or your own knowledge)
  and need the actual page text.
- Verifying a single claim by reading the source.
- Checking what a resource IS before deciding to spend tokens on it.

Not recommended for:
- Multiple URLs at once -> use `fetch_batch` (concurrent, one round-trip).
- "Search then read top N" -> use `research` (one call, not two).
- Long documents you need to page through -> use `read_doc` (start/length).
- You don't have a URL yet -> use `search` first.

Returns:
- markdown (default): a small header (URL, render method, token count)
  plus the cleaned page body.
- json: {url, title, content, method, truncated, tokens_estimated,
  author, published_date, sitename}, plus {media_type, bytes_size, sha256,
  width, height} for non-text resources.
- With `inline=True` on an image: the image itself, viewable by a
  vision-capable model.

Common mistakes:
- Passing a search query instead of a URL.
- Using `render="http"` on a JS-only SPA: it returns near-empty content;
  use "auto" (default) or "browser".
- Setting `inline=True` on a large image out of habit. A 1MB image costs
  well over a thousand tokens; fetch it plainly first and inline only if
  the description says it's worth looking at.
- Forgetting that results are cached 7 days: use `force_refresh=True`
  or `max_age_hours=0` for a fresh pull. The header says `cached N days ago`
  when you are not looking at the live page; for deadlines, prices and
  anything else that moves, that is the cue to refresh.
- Reading `no publication date found` as "recent". It means unknown.

Args:
    url: Absolute http(s) URL.
    render: "auto" (try HTTP, fall back to stealth Chromium), "http"
        (fast, fails on JS), "browser" (slow, robust).
    force_refresh: Bypass the page cache entirely.
    max_age_hours: Treat cached pages older than this as a miss. 0 = same
        as force_refresh. None = server default TTL (7 days).
    inline: For images only. Returns the image itself instead of a
        description, so a vision-capable model can see it. Ignored for
        text resources.
    format: "markdown" or "json".

**Anotaciones MCP:**
```json
{
  "idempotentHint": true,
  "openWorldHint": true,
  "readOnlyHint": true
}
```

**Esquema de entrada (`inputSchema`):**

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

---

### 2.3. `fetch_batch` — *Fetch many URLs concurrently*

**Descripción:**

Fetch a list of URLs in parallel. Per-URL failures do not raise.

Best for:
- 2+ URLs you want to read in one round-trip.
- Reading the top N results of a previous `search` call.

Not recommended for:
- A single URL -> `fetch` (no list-wrapping overhead).
- "Search and then read" -> `research` collapses both into one tool call.
- PDFs/DOCX -> `read_doc` per file.

Returns:
- markdown (default): each page rendered as a Markdown section, separated
  by horizontal rules; failed URLs become inline error notes.
- json: list[dict], one entry per URL, with `error` set on failures.

Common mistakes:
- Passing a single URL inside a 1-element list: use `fetch` directly.
- Assuming an exception means the whole batch failed; check each item's
  `error` field instead.

Args:
    urls: List of absolute http(s) URLs (max 20 per call).
    render: Same as `fetch`.
    format: "markdown" or "json".

**Anotaciones MCP:**
```json
{
  "idempotentHint": true,
  "openWorldHint": true,
  "readOnlyHint": true
}
```

**Esquema de entrada (`inputSchema`):**

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

---

### 2.4. `read_doc` — *Read a remote (or sandboxed local) document*

**Descripción:**

Read an http(s) document (or a sandboxed local file) into Markdown.

Best for:
- Remote PDFs and DOCX from an http(s) URL (parsed locally, no remote API).
- Local PDF/DOCX/text/Markdown files, ONLY when local reads are enabled
  (see Security below).
- Paginating through a long document via `start` / `length`.

Not recommended for:
- Arbitrary HTML web pages -> `fetch` does reader-mode cleanup that this
  tool does not.
- Pages discovered through search -> `fetch` or `research`.

Security (local files are sandboxed and OFF by default):
- Local-file reads are DISABLED unless the server operator sets the
  SEARCH_MCP_DOCUMENT_ROOT env var to a directory. With it unset, a local
  path raises a "local file reads are disabled" error. Pass an http(s)
  URL instead, or ask the operator to enable the sandbox.
- When enabled, `source` must resolve INSIDE that root; relative paths
  resolve against the root (not the process CWD) and any `..` traversal
  that escapes the root is rejected. `file://` URLs are always rejected.
- Remote http(s) sources are unaffected by this setting.

Returns:
- markdown (default): rendered document text with a small header.
- json: {content, title, format, total_chars, start, returned_chars,
  truncated}. Use `total_chars` and `returned_chars` to drive pagination.

Common mistakes:
- Calling this on a normal article URL: you'll get raw HTML noise. Use
  `fetch` instead.
- Forgetting to advance `start` when paginating: next call should pass
  `start = previous_start + returned_chars`.
- Passing a negative `length` (raises an error) or a `start` past the end
  (clamped to EOF: you'll get `returned_chars == 0`, `start == total_chars`,
  and `truncated == False`, which is the signal you've paged off the end).

Args:
    source: http(s) URL, or a local path UNDER SEARCH_MCP_DOCUMENT_ROOT when
        local reads are enabled (disabled by default; see Security).
    start: Character offset to begin reading from. Default 0. Clamped into
        [0, total_chars]; a negative value is treated as 0.
    length: Max characters to return; None = read to end (still capped by
        the per-call max content size). Must be >= 0. A negative length
        is rejected with a ValueError.
    format: "markdown" or "json".

**Anotaciones MCP:**
```json
{
  "idempotentHint": true,
  "openWorldHint": true,
  "readOnlyHint": true
}
```

**Esquema de entrada (`inputSchema`):**

```json
{
  "properties": {
    "source": {
      "title": "Source",
      "type": "string"
    },
    "start": {
      "default": 0,
      "title": "Start",
      "type": "integer"
    },
    "length": {
      "anyOf": [
        {
          "type": "integer"
        },
        {
          "type": "null"
        }
      ],
      "default": null,
      "title": "Length"
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
    "source"
  ],
  "type": "object",
  "title": "read_docArguments"
}
```

---

### 2.5. `research` — *Search and read in one call*

**Descripción:**

One-shot research: search the web, fetch the top results, return both.

Best for:
- Open-ended questions that need finding sources AND reading them
  ("what's new with X", "summarize the controversy around Y").
- Replacing a `search` + N x `fetch` chain with one call.
- Producing a citable brief with [n]-style source references.

Not recommended for:
- You only need links -> `search` (cheaper, no fetching).
- You only need to read one URL you already have -> `fetch`.
- You want to query previously-fetched cached pages -> `cache_search`.
- Checking or expanding one paper's citations -> `paper_graph`.

Returns:
- markdown (default): a "Research brief" with a Sources index then the
  full Markdown body of each fetched document, separated by horizontal
  rules; includes a token estimate.
- json: {question, engines, sources:[{rank,title,url,snippet,...}],
  documents:[...], tokens_estimated, errors}.

Common mistakes:
- Using `depth=8` for a quick lookup: that's 8 page fetches, and 2-3 is
  almost always enough.
- Calling `research` for a known URL: that is what `fetch` is for.
- Forgetting that `fetch=False` returns sources only (much cheaper if
  the LLM only needs to pick which one to read).

Args:
    question: What you want to know, in natural language.
    depth: How many top results to fetch (1-8). 3 is a good default.
    engines: Override the engine set (see `engines()` for names). Prefer
        `category=`. Naming engines turns category routing off.
    fetch: If False, return source list without reading them.
    freshness: "day"|"week"|"month"|"year". Restricts to recent results.
        Best-effort; undated results are kept rather than dropped.
    include_domains: Restrict to these domains (e.g. ["python.org"]).
    exclude_domains: Drop results from these domains.
    category: Which KIND of source to search; a bare group widens, a dotted
        sub-group narrows. Same values as `search`; see `engines()`.
    include_text: Substring required in title or snippet (case-insensitive).
    exclude_text: Substring forbidden in title or snippet.
    use_cache: Reuse cached search/page data within TTL.
    max_age_hours: Treat cached search results AND cached page bodies older
        than this as a read miss; fresh data is always written back. 0 =
        force-refresh both the engine search and every fetched page body;
        None = server default TTL (7 days). A non-zero value is honored for
        both halves (it used to be ignored for anything but 0).
    format: "markdown" or "json".

**Anotaciones MCP:**
```json
{
  "idempotentHint": false,
  "openWorldHint": true,
  "readOnlyHint": true
}
```

**Esquema de entrada (`inputSchema`):**

```json
{
  "properties": {
    "question": {
      "title": "Question",
      "type": "string"
    },
    "depth": {
      "default": 3,
      "title": "Depth",
      "type": "integer"
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
    "fetch": {
      "default": true,
      "title": "Fetch",
      "type": "boolean"
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
    "question"
  ],
  "type": "object",
  "title": "researchArguments"
}
```

---

### 2.6. `paper_graph` — *Walk a paper's citation graph*

**Descripción:**

Follow the citations of ONE paper, and check whether it still stands.

`search` finds papers that MENTION your words. This follows the edges
instead: what a specific paper built on, and what has built on it since.

Best for:
- Checking a citation before repeating it: is the DOI real, and has the
  paper been retracted or corrected?
- "What happened after this result": citing works come back ordered by how
  much the field cited them, so a 2019 paper leads to the current state of
  the art rather than to the most recent preprint about it.
- Building a reading list backwards from one good paper.

Not recommended for:
- Finding papers by topic -> `search(category="paper")`, or a sub-group
  like `"paper.biomed"` / `"paper.cs"` / `"paper.preprint"`.
- Reading the paper itself -> `read_doc` on the returned URL.

Returns:
- markdown (default): the paper with its retraction/correction notices,
  then "References" and "Cited by" sections.
- json: {paper, references, citations, notes}, where `paper.crossref`
  carries `registered` and every post-publication `notices` entry.

Common mistakes:
- Passing a topic instead of a paper. A title resolves to its single best
  match; a phrase that names no specific paper resolves to the wrong one.
- Reading an empty `citations` list as "uncited" when `notes` says the
  lookup was truncated.

Args:
    paper: DOI (`10.1145/1571941.1572114`, or a doi.org URL), an OpenAlex
        ID (`W2148972377`), or the paper's exact title.
    direction: "both", "references" (what it cites) or "citations" (what
        cites it).
    limit: Max neighbours per direction, 1-50.
    format: "markdown" or "json".

**Anotaciones MCP:**
```json
{
  "idempotentHint": true,
  "openWorldHint": true,
  "readOnlyHint": true
}
```

**Esquema de entrada (`inputSchema`):**

```json
{
  "properties": {
    "paper": {
      "title": "Paper",
      "type": "string"
    },
    "direction": {
      "default": "both",
      "enum": [
        "both",
        "references",
        "citations"
      ],
      "title": "Direction",
      "type": "string"
    },
    "limit": {
      "default": 10,
      "title": "Limit",
      "type": "integer"
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
    "paper"
  ],
  "type": "object",
  "title": "paper_graphArguments"
}
```

---

### 2.7. `cache_search` — *Search local cache (FTS5)*

**Descripción:**

Full-text search over pages already fetched into the local SQLite FTS5 index.

Best for:
- Recalling something the user/agent fetched earlier in the conversation
  ("what did that Wikipedia page say about X").
- Avoiding re-fetching content already in the local cache.
- Quick keyword grep across the corpus you've built up.

Not recommended for:
- Discovering new pages on the open web -> use `search` or `research`.
- When the cache is empty (fresh install) -> `search`/`research` first to
  populate it.

Returns:
- markdown (default): a per-hit list of title, URL, and a `[bracket]`-
  highlighted snippet around the matched terms.
- json: list of {url, title, snippet, author, date, sitename}. The last
  three are "" when the cached row predates metadata capture.

Common mistakes:
- Treating this like web search: it ONLY hits pages already in the local
  cache. If the user hasn't fetched anything, you'll get zero hits.
- Using natural-language phrases without quoting them; FTS5 splits on
  whitespace as AND. For an exact phrase use `"like this"`.

Args:
    query: FTS5 query. Bare terms = AND. Supports OR / NOT, prefix
        (`term*`), and phrase (`"exact phrase"`).
    limit: Max hits to return.
    format: "markdown" or "json".

**Anotaciones MCP:**
```json
{
  "idempotentHint": true,
  "openWorldHint": false,
  "readOnlyHint": true
}
```

**Esquema de entrada (`inputSchema`):**

```json
{
  "properties": {
    "query": {
      "title": "Query",
      "type": "string"
    },
    "limit": {
      "default": 10,
      "title": "Limit",
      "type": "integer"
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
  "title": "cache_searchArguments"
}
```

---

### 2.8. `engines` — *List available search engines*

**Descripción:**

List the available sources, grouped by what they index.

Best for:
- Choosing a source deliberately: which one indexes filings, or preprints,
  or Chinese-language pages.
- Checking a name before passing it to `engines=` on `search` / `research`.

Not recommended for:
- Calling on every search: the list is static, so read it once.

Returns (markdown): a `group -> sub-group -> engine` tree, one line of
description per engine. `group="paper"` restricts it to that group.
Returns (json): `{"engines": [...names...], "taxonomy": {...},
"descriptions": {...}}`.

Prefer `category=` over `engines=`. `category="paper"` WIDENS: it routes to
one specialist per sub-group. A dotted sub-group NARROWS: `"paper.biomed"`
queries only the biomedical indexes. Naming engines explicitly turns that
routing off entirely, so reach for it only to force a specific source.

Common mistakes:
- Passing one of these names as `query`: they belong in `engines=`.
- Passing a key-only engine with no key configured; it returns an
  actionable error, not results.

**Anotaciones MCP:**
```json
{
  "idempotentHint": true,
  "openWorldHint": false,
  "readOnlyHint": true
}
```

**Esquema de entrada (`inputSchema`):**

```json
{
  "properties": {
    "group": {
      "anyOf": [
        {
          "enum": [
            "web",
            "news",
            "paper",
            "github",
            "forum",
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
            "calendar"
          ],
          "type": "string"
        },
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
      "title": "Group"
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
  "type": "object",
  "title": "enginesArguments"
}
```

---

### 2.9. `compare` — *Compare URLs side-by-side*

**Descripción:**

Fetch 2-5 URLs concurrently and return per-URL excerpts so the LLM can
compare them against a single question in one round trip.

Best for:
- Side-by-side product/feature/article comparisons.
- "Compare X to Y" or "How does A differ from B" queries.
- Triangulating a fact across multiple sources.

Not recommended for:
- >5 URLs -> use `fetch_batch`.
- 1 URL -> use `fetch`.
- Don't have URLs yet -> use `search` or `research` first.

Returns:
- markdown (default): a comparison brief with per-URL sections, each
  containing title, sitename, published date, and a smart-truncated excerpt.
- json: {question, urls, excerpts:[{url, title, excerpt, ...}],
  tokens_estimated}.

Common mistakes:
- Asking `compare` to actually answer the question: it returns material,
  the LLM does the comparison.
- Passing >5 URLs and expecting them all to fit in context: use
  `fetch_batch` for bulk reads.

Args:
    question: The comparison question the LLM will answer using the
        returned excerpts.
    urls: 2-5 absolute http(s) URLs.
    format: "markdown" (default) or "json".

**Anotaciones MCP:**
```json
{
  "idempotentHint": true,
  "openWorldHint": true,
  "readOnlyHint": true
}
```

**Esquema de entrada (`inputSchema`):**

```json
{
  "properties": {
    "question": {
      "title": "Question",
      "type": "string"
    },
    "urls": {
      "items": {
        "type": "string"
      },
      "title": "Urls",
      "type": "array"
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
    "question",
    "urls"
  ],
  "type": "object",
  "title": "compareArguments"
}
```

---

### 2.10. `extract_structured` — *Extract structured data from a URL*

**Descripción:**

Pull JSON-LD, OpenGraph, Twitter cards, and microdata from a web page.

Best for:
- Product pages (price, currency, availability, brand, rating).
- Article pages (author, publish date, image, headline).
- Recipe / event / video pages where rich metadata IS the answer.
- Cases where `fetch` returns prose but you need fields.

Not recommended for:
- Just reading a page -> use `fetch`.
- PDFs / DOCX -> use `read_doc`.
- Pages that don't publish schema.org metadata (most blogs): you'll get
  empty lists; fall back to `fetch`.

Returns:
- json: {url, json_ld:[], microdata:[], opengraph:[], rdfa:[]}. Twitter
  card meta tags are surfaced inside the `opengraph` list.
- markdown (default): a flattened key/value view with each block printed
  as a JSON code block under its syntax heading.

Common mistakes:
- Calling on every URL "just in case": most sites have no structured
  data, and `fetch` is what you actually want.

Args:
    url: Absolute http(s) URL.
    format: "markdown" (default) or "json".

**Anotaciones MCP:**
```json
{
  "idempotentHint": true,
  "openWorldHint": true,
  "readOnlyHint": true
}
```

**Esquema de entrada (`inputSchema`):**

```json
{
  "properties": {
    "url": {
      "title": "Url",
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
    "url"
  ],
  "type": "object",
  "title": "extract_structuredArguments"
}
```

---

### 2.11. `download` — *Download a file to disk*

**Descripción:**

Save a file from a URL to a local, auto-expiring download directory.

Downloads are enabled by default and saved under
`SEARCH_MCP_CACHE_DIR/downloads`. Set `SEARCH_MCP_DOWNLOAD_ENABLED=false`
to disable them or `SEARCH_MCP_DOWNLOAD_DIR` to override the destination.

Best for:
- Keeping an actual file (installer, dataset, archive, image) rather than
  its text.
- Handing a path to another tool that needs a real file on disk.

Not recommended for:
- Reading a document's contents -> use `read_doc`, which parses it without
  touching the filesystem.
- Looking at a web page -> use `fetch`.
- Viewing an image -> use `fetch(inline=True)`.

Returns:
- markdown (default): where the file was saved, its size and type.
- json: {url, saved_path, media_type, bytes_size, sha256, expires_in_hours}.
  An expires_in_hours value of 0 means TTL cleanup is disabled.

Retention: files older than SEARCH_MCP_DOWNLOAD_TTL_HOURS (default 24) are
deleted before the next download and at startup. A value of 0 disables TTL
cleanup. Otherwise, treat the path as short-lived and copy it elsewhere if
you need to keep it.

Args:
    url: Absolute http(s) URL of the file to save.
    format: "markdown" or "json".

**Anotaciones MCP:**
```json
{
  "idempotentHint": true,
  "openWorldHint": true,
  "readOnlyHint": false
}
```

**Esquema de entrada (`inputSchema`):**

```json
{
  "properties": {
    "url": {
      "title": "Url",
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
    "url"
  ],
  "type": "object",
  "title": "downloadArguments"
}
```

---

