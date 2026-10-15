import { assert } from "@std/assert";

Deno.test("ai-memory-check valida initialize, tools/list e memory_status via SSE", async () => {
  const requests: Array<{ method: string; id?: number }> = [];
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0 }, async (request) => {
    const body = await request.json();
    requests.push(body);
    let result: unknown = {};
    if (body.method === "tools/list") result = { tools: [{ name: "memory_status" }] };
    if (body.method === "tools/call") {
      result = { content: [{ type: "text", text: '{"scope":"test"}' }] };
    }
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    return new Response(`data: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result })}\n\n`, {
      headers: { "content-type": "text/event-stream", "Mcp-Session-Id": "test-session" },
    });
  });
  await using _server = server;
  const address = server.addr as Deno.NetAddr;
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-net",
      new URL("../ai-memory-check.ts", import.meta.url).pathname,
      `http://${address.hostname}:${address.port}/mcp`,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  assert(output.success, new TextDecoder().decode(output.stderr));
  assert(requests.some((request) => request.method === "initialize"));
  assert(requests.some((request) => request.method === "tools/call"));
});
