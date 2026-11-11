/** Formato de los mensajes de Telegram: Markdown de JARVIS -> HTML de Telegram y partición en mensajes. */

export const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Tope de caracteres de un mensaje de Telegram (4096) con margen para las etiquetas HTML. */
export const MESSAGE_MAX = 3500;

export function mdToHtml(md: string): string {
  const blocks: string[] = [];
  let s = md.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_m, c: string) => {
    blocks.push(`<pre>${esc(c.trimEnd())}</pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  s = esc(s)
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/(?<![*\w])\*([^*\n]+)\*(?!\w)/g, "<i>$1</i>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => blocks[Number(i)]);
}

/** Parte un texto en trozos de a lo sumo `max` caracteres, cortando por líneas y, si una línea no entra, a la fuerza. */
export function chunk(text: string, max = MESSAGE_MAX): string[] {
  const out: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur && cur.length + line.length + 1 > max) {
      out.push(cur);
      cur = "";
    }
    cur = cur ? `${cur}\n${line}` : line;
    while (cur.length > max) {
      out.push(cur.slice(0, max));
      cur = cur.slice(max);
    }
  }
  if (cur) out.push(cur);
  return out;
}
