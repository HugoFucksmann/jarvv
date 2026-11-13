import React, { useMemo } from "react";
import { Terminal } from "lucide-react";
import { CopyButton } from "./CopyButton.tsx";
import { JsonText } from "./JsonView.tsx";

interface MarkdownRendererProps {
  content: string;
  className?: string;
  /** Texto algo mayor y más aireado, para respuestas que se leen de corrido. */
  large?: boolean;
}

type Block =
  | { type: "code"; language: string; code: string }
  | { type: "header"; level: number; text: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "blockquote"; text: string }
  | { type: "hr" }
  | { type: "paragraph"; text: string };

/**
 * Parsea texto Markdown inline (negrita, cursiva, código, tachado y enlaces)
 * en nodos de React seguros sin librerías externas ni peligro de XSS.
 */
function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Regex para tokens inline: code, bold, italic, strike, link
  const inlineRegex =
    /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/g;

  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let keyCount = 0;

  while ((match = inlineRegex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      nodes.push(text.slice(lastIdx, match.index));
    }

    const token = match[0];
    const key = `inline-${keyCount++}`;

    if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code
          key={key}
          className="px-1.5 py-0.5 text-[13px] font-mono bg-slate-800 text-accent-300 rounded border border-slate-700/60"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (
      (token.startsWith("**") && token.endsWith("**")) ||
      (token.startsWith("__") && token.endsWith("__"))
    ) {
      nodes.push(
        <strong key={key} className="font-semibold text-white">
          {renderInline(token.slice(2, -2))}
        </strong>
      );
    } else if (
      (token.startsWith("*") && token.endsWith("*")) ||
      (token.startsWith("_") && token.endsWith("_"))
    ) {
      nodes.push(
        <em key={key} className="italic text-slate-300">
          {renderInline(token.slice(1, -1))}
        </em>
      );
    } else if (token.startsWith("~~") && token.endsWith("~~")) {
      nodes.push(
        <del key={key} className="line-through text-slate-500">
          {renderInline(token.slice(2, -2))}
        </del>
      );
    } else if (token.startsWith("[") && token.includes("](") && token.endsWith(")")) {
      const linkMatch = token.match(/^\[(.*?)\]\((.*?)\)$/);
      if (linkMatch && /^(https?:|mailto:)/i.test(linkMatch[2].trim())) {
        nodes.push(
          <a
            key={key}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-400 hover:text-accent-300 underline underline-offset-2 transition-colors"
          >
            {linkMatch[1]}
          </a>
        );
      } else {
        nodes.push(token);
      }
    } else {
      nodes.push(token);
    }

    lastIdx = match.index + token.length;
  }

  if (lastIdx < text.length) {
    nodes.push(text.slice(lastIdx));
  }

  return nodes.length > 0 ? nodes : [text];
}

/**
 * Tokeniza el texto completo en bloques estructurales (código, tablas, encabezados, listas, citas)
 */
function parseBlocks(markdown: string): Block[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 1. Bloque de código multi-línea ```lang
    if (line.trim().startsWith("```")) {
      const langMatch = line.trim().match(/^```([a-zA-Z0-9_-]*)/);
      const language = langMatch?.[1] || "código";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].trim().startsWith("```")) {
        i++; // consumir cierre ```
      }
      blocks.push({
        type: "code",
        language,
        code: codeLines.join("\n"),
      });
      continue;
    }

    // 2. Separador horizontal --- o *** o ___
    if (/^(\s*[-*_]\s*){3,}$/.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // 3. Encabezados #, ##, ###, ####
    const headerMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headerMatch) {
      blocks.push({
        type: "header",
        level: headerMatch[1].length,
        text: headerMatch[2].trim(),
      });
      i++;
      continue;
    }

    // 4. Bloque de Cita (> texto)
    if (line.trim().startsWith(">")) {
      const quoteLines: string[] = [line.replace(/^\s*>\s?/, "")];
      i++;
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({
        type: "blockquote",
        text: quoteLines.join("\n"),
      });
      continue;
    }

    // 5. Tabla Markdown (| Col 1 | Col 2 |)
    if (line.trim().startsWith("|") && line.trim().endsWith("|") && lines[i + 1]?.includes("---")) {
      const parseCells = (row: string) =>
        row
          .trim()
          .slice(1, -1)
          .split("|")
          .map((c) => c.trim());

      const headers = parseCells(line);
      i += 2; // saltar encabezado y línea separadora |---|---|
      const rows: string[][] = [];

      while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
        rows.push(parseCells(lines[i]));
        i++;
      }

      blocks.push({ type: "table", headers, rows });
      continue;
    }

    // 6. Lista desordenada (- o * o •)
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, "").trim());
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    // 7. Lista numerada (1. 2. etc.)
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, "").trim());
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    // 8. Línea vacía
    if (!line.trim()) {
      i++;
      continue;
    }

    // 9. Párrafo común
    const paragraphLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith("```") &&
      !lines[i].match(/^(#{1,4})\s+/) &&
      !lines[i].trim().startsWith(">") &&
      !lines[i].trim().startsWith("|") &&
      !/^\s*[-*•]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^(\s*[-*_]\s*){3,}$/.test(lines[i])
    ) {
      paragraphLines.push(lines[i]);
      i++;
    }

    blocks.push({
      type: "paragraph",
      text: paragraphLines.join("\n"),
    });
  }

  return blocks;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className = "",
  large = false,
}) => {
  const blocks = useMemo(() => parseBlocks(content), [content]);

  return (
    <div
      className={`flex flex-col text-slate-200 leading-relaxed ${large ? "gap-4 text-[15px]" : "gap-3 text-sm"
        } ${className}`}
    >
      {blocks.map((block, idx) => {
        switch (block.type) {
          case "code": {
            return (
              <div
                key={idx}
                className="flex flex-col rounded-lg border border-slate-800 bg-slate-950 overflow-hidden font-mono text-xs my-1"
              >
                <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900 border-b border-slate-800 text-[11px] text-slate-400">
                  <div className="flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-accent-400" />
                    <span className="font-semibold text-slate-300 uppercase">{block.language}</span>
                  </div>
                  <CopyButton
                    text={block.code}
                    ariaLabel={`Copiar fragmento de código ${block.language}`}
                    className="gap-1 text-slate-400 hover:text-slate-200"
                  />
                </div>
                {block.language.toLowerCase() === "json" ? (
                  <div className="p-3 overflow-x-auto">
                    <JsonText text={block.code} defaultDepth={4} />
                  </div>
                ) : (
                  <pre className="p-3 overflow-x-auto text-slate-200 text-[13px] leading-relaxed font-mono whitespace-pre">
                    <code>{block.code}</code>
                  </pre>
                )}
              </div>
            );
          }

          case "header": {
            if (block.level === 1) {
              return (
                <h1
                  key={idx}
                  className="text-lg font-bold text-slate-50 border-b border-slate-800 pb-2 mt-3"
                >
                  {renderInline(block.text)}
                </h1>
              );
            }
            if (block.level === 2) {
              return (
                <h2 key={idx} className="text-base font-semibold text-slate-50 mt-3">
                  {renderInline(block.text)}
                </h2>
              );
            }
            if (block.level === 3) {
              return (
                <h3 key={idx} className="text-sm font-semibold text-accent-300 mt-2">
                  {renderInline(block.text)}
                </h3>
              );
            }
            return (
              <h4 key={idx} className="text-sm font-medium text-slate-400 mt-1">
                {renderInline(block.text)}
              </h4>
            );
          }

          case "table": {
            return (
              <div key={idx} className="overflow-x-auto my-2 rounded-lg border border-slate-800 bg-slate-950">
                <table className="w-full text-left text-[13px] divide-y divide-slate-800">
                  <thead className="bg-slate-900 text-slate-100 font-semibold">
                    <tr>
                      {block.headers.map((h, hIdx) => (
                        <th key={hIdx} className="px-3 py-2 border-r border-slate-800 last:border-r-0">
                          {renderInline(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-300">
                    {block.rows.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-slate-900/50 transition-colors">
                        {row.map((cell, cIdx) => (
                          <td
                            key={cIdx}
                            className="px-3 py-2 border-r border-slate-800/50 last:border-r-0 align-top"
                          >
                            {renderInline(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }

          case "ul": {
            return (
              <ul key={idx} className="flex flex-col gap-1.5 pl-2 my-0.5">
                {block.items.map((item, itemIdx) => (
                  <li key={itemIdx} className="flex items-start gap-2.5 text-slate-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent-400 shrink-0 mt-2.5" />
                    <span className="flex-1">{renderInline(item)}</span>
                  </li>
                ))}
              </ul>
            );
          }

          case "ol": {
            return (
              <ol key={idx} className="flex flex-col gap-1.5 pl-2 my-0.5">
                {block.items.map((item, itemIdx) => (
                  <li key={itemIdx} className="flex items-start gap-2.5 text-slate-200">
                    <span className="font-mono text-accent-400 text-xs tabular-nums shrink-0 mt-1 w-4 text-right">
                      {itemIdx + 1}.
                    </span>
                    <span className="flex-1">{renderInline(item)}</span>
                  </li>
                ))}
              </ol>
            );
          }

          case "blockquote": {
            return (
              <blockquote
                key={idx}
                className="border-l-2 border-accent-500/70 bg-slate-900/60 pl-3 py-2 pr-2 text-slate-300 italic text-[13px] rounded-r my-1"
              >
                {renderInline(block.text)}
              </blockquote>
            );
          }

          case "hr": {
            return <hr key={idx} className="border-t border-slate-800 my-2" />;
          }

          case "paragraph":
          default: {
            return (
              <p key={idx} className="text-slate-200 whitespace-pre-wrap leading-relaxed">
                {renderInline(block.text)}
              </p>
            );
          }
        }
      })}
    </div>
  );
};