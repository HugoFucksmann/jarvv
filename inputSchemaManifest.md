# Input Schemas — Herramientas del Manifest de Jarvis

Documento generado automáticamente con los esquemas de entrada (`inputSchema`) de las herramientas declaradas en `SYSTEM_TOOL_MANIFEST` (las que Jarvis realmente utiliza en sus rutas: files, locate, terminal y web).

---

# MCP Server: desktop_commander

Total de herramientas en manifest: 11

## Tool: `read_file`

### Descripción MCP
```
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
```

### inputSchema
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

## Tool: `read_multiple_files`

### Descripción MCP
```
Read the contents of multiple files simultaneously.
                        
                        Each file's content is returned with its path as a reference.
                        Handles text files normally and renders images as viewable content.
                        Recognized image types: PNG, JPEG, GIF, WebP.
                        
                        Failed reads for individual files won't stop the entire operation.
                        Only works within allowed directories.
                        
                        Absolute paths are the most reliable because they do not depend on the current working directory. Paths are automatically normalized regardless of slash direction. Relative paths depend on the current working directory, and tilde paths (~/...) may not resolve in every context. Absolute paths are generally the most reliable.
                        This command can be referenced as "DC: ..." or "use Desktop Commander to ..." in your instructions.
```

### inputSchema
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

## Tool: `write_file`

### Descripción MCP
```
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
```

### inputSchema
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

## Tool: `create_directory`

### Descripción MCP
```
Create a new directory or ensure a directory exists.
                        
                        Can create multiple nested directories in one operation.
                        Only works within allowed directories.
                        
                        Absolute paths are the most reliable because they do not depend on the current working directory. Paths are automatically normalized regardless of slash direction. Relative paths depend on the current working directory, and tilde paths (~/...) may not resolve in every context. Absolute paths are generally the most reliable.
                        This command can be referenced as "DC: ..." or "use Desktop Commander to ..." in your instructions.
```

### inputSchema
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

## Tool: `list_directory`

### Descripción MCP
```
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
```

### inputSchema
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

## Tool: `move_file`

### Descripción MCP
```
Move or rename files and directories.
                        
                        Can move files between directories and rename them in a single operation.
                        Both source and destination must be within allowed directories.
                        
                        Absolute paths are the most reliable because they do not depend on the current working directory. Paths are automatically normalized regardless of slash direction. Relative paths depend on the current working directory, and tilde paths (~/...) may not resolve in every context. Absolute paths are generally the most reliable.
                        This command can be referenced as "DC: ..." or "use Desktop Commander to ..." in your instructions.
```

### inputSchema
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

## Tool: `start_search`

### Descripción MCP
```
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
```

### inputSchema
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

## Tool: `get_more_search_results`

### Descripción MCP
```
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
```

### inputSchema
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

## Tool: `start_process`

### Descripción MCP
```
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
```

### inputSchema
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

## Tool: `read_process_output`

### Descripción MCP
```
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
```

### inputSchema
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

## Tool: `interact_with_process`

### Descripción MCP
```
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
```

### inputSchema
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

# MCP Server: free_search

Total de herramientas en manifest: 3

## Tool: `search`

### Descripción MCP
```
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
```

### inputSchema
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

## Tool: `fetch`

### Descripción MCP
```
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
```

### inputSchema
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

## Tool: `fetch_batch`

### Descripción MCP
```
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
```

### inputSchema
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
