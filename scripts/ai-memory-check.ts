const url = Deno.args[0];
export async function checkAiMemory(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<{ tools: string[]; memory_status: unknown }> {
  let nextId = 1;
  let sessionId: string | null = null;
  async function rpc(method: string, params: Record<string, unknown> = {}) {
    const id = nextId++;
    const response = await fetcher(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    sessionId = response.headers.get("Mcp-Session-Id") ?? sessionId;
    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();
    let message: Record<string, unknown> | undefined;
    if (contentType.includes("text/event-stream")) {
      for (const line of body.split(/\r?\n/)) {
        if (line.startsWith("data:")) {
          try {
            const candidate = JSON.parse(line.slice(5).trim());
            if (candidate.id === id) message = candidate;
          } catch { /* Ignora keep-alive e eventos não JSON-RPC. */ }
        }
      }
    } else if (body.trim()) {
      message = JSON.parse(body);
    }
    if (message?.error) throw new Error(JSON.stringify(message.error));
    return message?.result;
  }

  // Notificação JSON-RPC não carrega `id`; o servidor responde 202/204 sem corpo (ambos são 2xx).
  async function notify(method: string, params: Record<string, unknown> = {}) {
    const response = await fetcher(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", method, params }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await response.body?.cancel();
  }

  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "vetor-ai-memory-check", version: "1.0.0" },
  });
  await notify("notifications/initialized");
  const listed = await rpc("tools/list") as { tools?: Array<{ name: string }> };
  if (!listed?.tools?.some((tool) => tool.name === "memory_status")) {
    throw new Error("A ferramenta memory_status não foi anunciada.");
  }
  const status = await rpc("tools/call", { name: "memory_status", arguments: {} });
  return { tools: listed.tools.map((tool) => tool.name), memory_status: status };
}

if (import.meta.main) {
  if (!url) throw new Error("Uso: deno run --allow-net scripts/ai-memory-check.ts <url>");
  console.log(JSON.stringify(await checkAiMemory(url), null, 2));
}
