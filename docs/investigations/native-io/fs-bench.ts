// Microbenchmark da #584, pergunta 2: o I/O de arquivo do Deno já basta?
//
// Lê todos os arquivos rastreados do repositório de três jeitos: síncrono em sequência, assíncrono
// em sequência e assíncrono em paralelo (Promise.all, com limite). Cache de página quente (ler sem
// cache exige root para `drop_caches`). Compara com `cat` de todos os arquivos, como piso do SO.
//
// Uso, a partir da raiz de um checkout:
//   deno run -A docs/investigations/native-io/fs-bench.ts [--runs 10]

const runs = Number(Deno.args[Deno.args.indexOf("--runs") + 1]) || 10;
const ls = await new Deno.Command("git", { args: ["ls-files", "-z"], stdout: "piped" }).output();
const files = new TextDecoder().decode(ls.stdout).split("\0").filter(Boolean)
  .filter((f) => {
    try {
      return Deno.statSync(f).isFile;
    } catch {
      return false;
    }
  });
const bytes = files.reduce((n, f) => n + Deno.statSync(f).size, 0);

async function pool<T>(items: T[], limit: number, fn: (t: T) => Promise<unknown>) {
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

const variants: Record<string, () => Promise<void> | void> = {
  "readFileSync sequencial": () => {
    for (const f of files) Deno.readFileSync(f);
  },
  "readFile sequencial": async () => {
    for (const f of files) await Deno.readFile(f);
  },
  "readFile paralelo (64)": () => pool(files, 64, (f) => Deno.readFile(f)),
  "cat (processo externo)": async () => {
    const p = new Deno.Command("xargs", { args: ["-0", "cat"], stdin: "piped", stdout: "null" })
      .spawn();
    const w = p.stdin.getWriter();
    await w.write(new TextEncoder().encode(files.join("\0")));
    await w.close();
    await p.status;
  },
};

const result: Record<string, unknown> = { deno: Deno.version.deno, files: files.length, MiB: +(bytes / 2 ** 20).toFixed(2), runs };
for (const [name, fn] of Object.entries(variants)) {
  await fn(); // aquece o cache de página
  const t: number[] = [];
  for (let r = 0; r < runs; r++) {
    const s = performance.now();
    await fn();
    t.push(performance.now() - s);
  }
  t.sort((a, b) => a - b);
  result[name] = { p50Ms: +t[Math.floor(runs / 2)].toFixed(2), minMs: +t[0].toFixed(2) };
}
console.log(JSON.stringify(result, null, 2));
