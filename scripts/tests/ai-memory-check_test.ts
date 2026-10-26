import { assert, assertEquals, assertRejects } from "@std/assert";
import { checkAiMemory } from "../ai-memory-check.ts";

type RpcBody = { id?: number; method: string; params?: unknown };

// Fetcher que imita um servidor MCP: notificação com `id` é rejeitada (400), sem `id` responde
// `notificationStatus` sem corpo (202/204), e os requests recebem JSON-RPC normal.
function mcpFetcher(notificationStatus: number) {
  const calls: Array<{ body: RpcBody; headers: Headers }> = [];
  const fetcher = ((_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as RpcBody;
    calls.push({ body, headers: new Headers(init?.headers) });
    if (body.method === "notifications/initialized") {
      return Promise.resolve(
        new Response(null, { status: "id" in body ? 400 : notificationStatus }),
      );
    }
    let result: unknown = {};
    if (body.method === "tools/list") result = { tools: [{ name: "memory_status" }] };
    if (body.method === "tools/call") result = { content: [{ type: "text", text: "{}" }] };
    return Promise.resolve(
      Response.json({ jsonrpc: "2.0", id: body.id, result }, {
        headers: { "Mcp-Session-Id": "test-session" },
      }),
    );
  }) as typeof fetch;
  return { fetcher, calls };
}

for (const status of [202, 204]) {
  Deno.test(`ai-memory-check envia notifications/initialized sem id e aceita ${status} sem corpo`, async () => {
    const { fetcher, calls } = mcpFetcher(status);
    const result = await checkAiMemory("http://127.0.0.1:0/mcp", fetcher);

    assertEquals(result.tools, ["memory_status"]);
    const notification = calls.find((call) => call.body.method === "notifications/initialized");
    assert(notification, "a notificação initialized não foi enviada");
    assert(!("id" in notification.body), "notificação JSON-RPC não pode carregar id");
    assertEquals(notification.headers.get("Mcp-Session-Id"), "test-session");
  });
}

Deno.test("ai-memory-check falha quando a notificação initialized recebe status de erro", async () => {
  const { fetcher, calls } = mcpFetcher(500);
  await assertRejects(() => checkAiMemory("http://127.0.0.1:0/mcp", fetcher), Error, "HTTP 500");
  assertEquals(calls.map((call) => call.body.method), ["initialize", "notifications/initialized"]);
});

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
