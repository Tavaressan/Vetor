// Microbenchmark da #584 (pergunta 3) e da #585 (pergunta 4): custo de ida e volta de IPC entre o
// Deno e um processo filho, por JSON-RPC em stdio (linhas JSON) e por Unix Domain Socket.
//
// O filho é um eco em Deno, então o número inclui serialização dos dois lados. Um filho em Rust
// teria o lado dele mais barato; o lado do Deno (o que o núcleo paga) é o mesmo. Também mede o custo
// de iniciar o filho, que um backend sob demanda pagaria uma vez por sessão.
//
// Uso:
//   deno run -A docs/investigations/native-io/ipc-bench.ts [--n 2000]
// (o filho é este mesmo arquivo com --child-stdio ou --child-uds <path>)

const enc = new TextEncoder();
const dec = new TextDecoder();

async function* lines(r: ReadableStream<Uint8Array>) {
  let buf = "";
  for await (const chunk of r) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      yield buf.slice(0, i);
      buf = buf.slice(i + 1);
    }
  }
}

// ---- filhos -------------------------------------------------------------------------------
if (Deno.args[0] === "--child-stdio") {
  const w = Deno.stdout.writable.getWriter();
  for await (const l of lines(Deno.stdin.readable)) {
    const m = JSON.parse(l);
    await w.write(enc.encode(JSON.stringify({ id: m.id, result: m.params }) + "\n"));
  }
  Deno.exit(0);
}
if (Deno.args[0] === "--child-uds") {
  const listener = Deno.listen({ transport: "unix", path: Deno.args[1] });
  console.log("ready");
  const conn = await listener.accept();
  const w = conn.writable.getWriter();
  for await (const l of lines(conn.readable)) {
    const m = JSON.parse(l);
    await w.write(enc.encode(JSON.stringify({ id: m.id, result: m.params }) + "\n"));
  }
  Deno.exit(0);
}

// ---- pai ------------------------------------------------------------------------------------
const n = Number(Deno.args[Deno.args.indexOf("--n") + 1]) || 2000;
const self = new URL(import.meta.url).pathname;
const sizes = [100, 10_000, 1_000_000];

function stats(t: number[]) {
  t.sort((a, b) => a - b);
  const q = (p: number) => +t[Math.min(t.length - 1, Math.floor(p * t.length))].toFixed(3);
  return { p50: q(0.5), p95: q(0.95), p99: q(0.99) };
}

async function bench(
  w: WritableStreamDefaultWriter<Uint8Array>,
  it: AsyncGenerator<string>,
) {
  const out: Record<string, unknown> = {};
  for (const size of sizes) {
    const payload = "x".repeat(size);
    const count = size >= 1_000_000 ? Math.min(n, 100) : n;
    const t: number[] = [];
    for (let id = 0; id < count; id++) {
      const s = performance.now();
      await w.write(enc.encode(JSON.stringify({ jsonrpc: "2.0", id, method: "echo", params: payload }) + "\n"));
      const r = JSON.parse((await it.next()).value);
      if (r.id !== id) throw new Error("resposta fora de ordem");
      t.push(performance.now() - s);
    }
    out[`${size} B`] = { roundTripMs: stats(t), count };
  }
  return out;
}

const result: Record<string, unknown> = { deno: Deno.version.deno, n };

// stdio
{
  const s0 = performance.now();
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", self, "--child-stdio"],
    stdin: "piped",
    stdout: "piped",
  }).spawn();
  const w = child.stdin.getWriter();
  const it = lines(child.stdout);
  await w.write(enc.encode(JSON.stringify({ id: -1, params: "warm" }) + "\n"));
  await it.next();
  const startMs = performance.now() - s0;
  result["stdio JSON-RPC"] = { startToFirstReplyMs: +startMs.toFixed(1), ...(await bench(w, it)) };
  await w.close();
  await child.status;
}

// Unix Domain Socket
{
  const path = `${await Deno.makeTempDir()}/ipc.sock`;
  const s0 = performance.now();
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", self, "--child-uds", path],
    stdout: "piped",
  }).spawn();
  await lines(child.stdout).next(); // "ready"
  const conn = await Deno.connect({ transport: "unix", path });
  const w = conn.writable.getWriter();
  const it = lines(conn.readable);
  await w.write(enc.encode(JSON.stringify({ id: -1, params: "warm" }) + "\n"));
  await it.next();
  const startMs = performance.now() - s0;
  result["Unix Domain Socket"] = { startToFirstReplyMs: +startMs.toFixed(1), ...(await bench(w, it)) };
  await w.close();
  await child.status;
  await Deno.remove(path.replace(/\/ipc.sock$/, ""), { recursive: true });
}

// Referência: chamada de função no mesmo processo, com a mesma serialização.
{
  const t: number[] = [];
  const payload = "x".repeat(10_000);
  for (let id = 0; id < n; id++) {
    const s = performance.now();
    const m = JSON.parse(JSON.stringify({ jsonrpc: "2.0", id, method: "echo", params: payload }));
    JSON.parse(JSON.stringify({ id: m.id, result: m.params }));
    t.push(performance.now() - s);
  }
  result["mesmo processo, 10000 B, só JSON"] = { roundTripMs: stats(t) };
}

console.log(JSON.stringify(result, null, 2));
