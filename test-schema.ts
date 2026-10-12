const URL = "http://localhost:11434/v1/chat/completions"; // ajustá a tu qwenUrl
const MODEL = "qwen3.5:9b";                                // ajustá a tu qwenModel
const ROUTES = ["windows", "desktop_commander", "free_search"];

const body = {
    model: MODEL,
    messages: [
        { role: "system", content: "Eres un asistente amable. Responde en prosa, de forma conversacional." },
        { role: "user", content: "Contame qué ruta usarías para buscar el clima en Madrid." },
    ],
    temperature: 0.1,
    stream: false,
    reasoning_effort: "none",
    response_format: {
        type: "json_schema",
        json_schema: {
            name: "test",
            strict: true,
            schema: {
                type: "object",
                properties: { route: { type: "string", enum: ROUTES } },
                required: ["route"],
                additionalProperties: false,
            },
        },
    },
};

let ok = 0;
const N = 10;
for (let i = 0; i < N; i++) {
    const r = await fetch(URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const data = await r.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    try {
        const parsed = JSON.parse(content);
        if (ROUTES.includes(parsed.route)) { ok++; continue; }
    } catch { /* no es JSON */ }
    console.log(`#${i + 1} FALLÓ:`, content.slice(0, 120).replace(/\n/g, " "));
}
console.log(`Válidos: ${ok}/${N}`);