import asyncio, sys, json
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

question = sys.argv[1]
fmt = sys.argv[2] if len(sys.argv) > 2 else "markdown"
out = sys.argv[3] if len(sys.argv) > 3 else "research_out.txt"

def pick(obj, *names):
    for n in names:
        if hasattr(obj, n):
            return getattr(obj, n)
    return None

async def main():
    params = StdioServerParameters(command="uvx", args=["free-search-mcp==0.18.0"])
    async with stdio_client(params) as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize()
            res = await s.call_tool(
                "research", {"question": question, "depth": 3, "format": fmt}
            )

    lines = [f"is_error: {pick(res, 'is_error', 'isError')}"]
    sc = pick(res, "structured_content", "structuredContent")
    lines.append("structured_content: " + (json.dumps(sc, ensure_ascii=False, indent=2) if sc else "None"))
    lines.append("--- content ---")
    for c in res.content:
        lines.append(getattr(c, "text", repr(c)))
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("listo ->", out)

asyncio.run(main())