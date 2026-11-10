// Servidor MCP mínimo por stdio para probar el transporte. Herramientas: `echo` (devuelve el texto), `split` (responde partiendo un
// carácter multibyte entre dos escrituras), `slow` (no responde nunca) y `die` (termina el proceso sin responder).
import readline from "node:readline";

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.id === undefined) return;
  if (msg.method === "initialize") return send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "fake", version: "0" } } });
  if (msg.method === "tools/list") return send({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "echo", description: "", inputSchema: { type: "object" } }] } });
  if (msg.method !== "tools/call") return;
  const { name, arguments: args } = msg.params;
  if (name === "slow") return;
  if (name === "die") process.exit(3);
  const reply = JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: String(args?.text ?? "") }] } }) + "\n";
  if (name !== "split") return process.stdout.write(reply);
  const bytes = Buffer.from(reply, "utf8");
  const cut = bytes.indexOf(0xc3) + 1; // entre los dos bytes de la primera "ñ"
  process.stdout.write(bytes.subarray(0, cut));
  setTimeout(() => process.stdout.write(bytes.subarray(cut)), 50);
});
