// Sonda da #582: supervisão de uma árvore de processos de "worker" só com APIs do Deno e /proc.
//
// Lança um worker sintético (bash com filhos: um laço de CPU e um sleep), descobre a árvore,
// amostra CPU e memória por /proc, mede o custo de cada amostra e encerra a árvore pelo grupo de
// processos. Só Linux: em macOS e Windows o script sai com 2 e diz o motivo.
//
// Uso:
//   deno run -A docs/investigations/deno-system-apis/probe-tree.ts [--samples 20] [--detached]
// No Deno 2.x, ler /proc/<pid>/* exige --allow-all: com --allow-read=/proc a sonda falha com
// NotCapable (é a evidência da #582 §4.3).

const args = Deno.args;
const samples = Number(args[args.indexOf("--samples") + 1]) || 20;
const detached = args.includes("--detached");

if (Deno.build.os !== "linux") {
  console.error(`probe-tree: /proc só existe no Linux (os=${Deno.build.os})`);
  Deno.exit(2);
}

const CLK_TCK = 100; // sysconf(_SC_CLK_TCK); 100 em todo kernel x86_64/arm64 comum
const PAGE = 4096;

interface ProcStat {
  pid: number;
  ppid: number;
  pgrp: number;
  session: number;
  utime: number;
  stime: number;
  rssPages: number;
}

function readStat(pid: number): ProcStat | null {
  try {
    const raw = Deno.readTextFileSync(`/proc/${pid}/stat`);
    // O campo comm pode ter espaços e parênteses: corta depois do último ")".
    const rest = raw.slice(raw.lastIndexOf(")") + 2).split(" ");
    return {
      pid,
      ppid: Number(rest[1]),
      pgrp: Number(rest[2]),
      session: Number(rest[3]),
      utime: Number(rest[11]),
      stime: Number(rest[12]),
      rssPages: Number(rest[21]),
    };
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null; // saiu entre a listagem e a leitura
    throw e; // NotCapable: no Deno 2.x, /proc/<pid>/* exige --allow-all
  }
}

/** Filhos diretos via /proc/<pid>/task/<tid>/children (CONFIG_PROC_CHILDREN). */
function children(pid: number): number[] {
  const out: number[] = [];
  try {
    for (const t of Deno.readDirSync(`/proc/${pid}/task`)) {
      const c = Deno.readTextFileSync(`/proc/${pid}/task/${t.name}/children`).trim();
      if (c) out.push(...c.split(" ").map(Number));
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  return out;
}

function tree(root: number): number[] {
  const seen: number[] = [];
  const stack = [root];
  while (stack.length) {
    const p = stack.pop()!;
    seen.push(p);
    stack.push(...children(p));
  }
  return seen;
}

function sampleTree(root: number) {
  const pids = tree(root);
  let ticks = 0;
  let rss = 0;
  for (const pid of pids) {
    const s = readStat(pid);
    if (!s) continue;
    ticks += s.utime + s.stime;
    rss += s.rssPages * PAGE;
  }
  return { pids, ticks, rss };
}

// Worker sintético: um laço de CPU e um sleep, os dois filhos do bash. O `timeout 30` é a rede de
// segurança: se a sonda morrer antes de encerrar a árvore, os filhos não ficam órfãos para sempre.
const child = new Deno.Command("bash", {
  args: ["-c", "(timeout 30 bash -c 'while :; do :; done') & sleep 30 & wait"],
  stdout: "null",
  stderr: "null",
  detached,
}).spawn();
// Qualquer exceção daqui em diante ainda tenta encerrar o bash raiz.
globalThis.addEventListener("unhandledrejection", () => {
  try {
    Deno.kill(detached ? -child.pid : child.pid, "SIGKILL");
  } catch { /* já saiu */ }
});

await new Promise((r) => setTimeout(r, 300));

const rootStat = readStat(child.pid)!;
const self = readStat(Deno.pid)!;

const t0 = performance.now();
let first = sampleTree(child.pid);
const firstMs = performance.now() - t0;

const costs: number[] = [];
let prev = first;
let prevAt = performance.now();
const cpuPct: number[] = [];
for (let i = 0; i < samples; i++) {
  await new Promise((r) => setTimeout(r, 100));
  const s0 = performance.now();
  const s = sampleTree(child.pid);
  const s1 = performance.now();
  costs.push(s1 - s0);
  const wallSec = (s1 - prevAt) / 1000;
  cpuPct.push(((s.ticks - prev.ticks) / CLK_TCK) / wallSec * 100);
  prev = s;
  prevAt = s1;
}
first = prev;

// Encerramento: com detached o bash é líder de um grupo novo, e -pgid alcança os netos.
const k0 = performance.now();
let killMode: string;
if (detached && rootStat.pgrp === child.pid) {
  Deno.kill(-child.pid, "SIGKILL");
  killMode = "Deno.kill(-pgid)";
} else {
  // Sem grupo próprio, -pgid mataria o próprio Deno: mata pid a pid, folhas primeiro.
  for (const pid of tree(child.pid).reverse()) {
    try {
      Deno.kill(pid, "SIGKILL");
    } catch { /* já saiu */ }
  }
  killMode = "Deno.kill(pid) por nó";
}
await child.status;
await new Promise((r) => setTimeout(r, 100));
const survivors = first.pids.filter((p) => readStat(p) !== null);
const killMs = performance.now() - k0;

const sorted = [...costs].sort((a, b) => a - b);
const pct = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

console.log(JSON.stringify(
  {
    deno: Deno.version.deno,
    detached,
    rootPgrpIsOwn: rootStat.pgrp === child.pid,
    rootSessionIsOwn: rootStat.session === child.pid,
    selfPgrp: self.pgrp,
    treeSize: first.pids.length,
    firstSampleMs: +firstMs.toFixed(3),
    sampleCostMs: { p50: +pct(0.5).toFixed(3), p95: +pct(0.95).toFixed(3), max: +sorted.at(-1)!.toFixed(3) },
    treeCpuPct: { p50: +cpuPct.sort((a, b) => a - b)[Math.floor(cpuPct.length / 2)].toFixed(1) },
    treeRssMiB: +(first.rss / 2 ** 20).toFixed(2),
    killMode,
    killMs: +killMs.toFixed(1),
    survivors,
    host: { mem: Deno.systemMemoryInfo(), loadavg: Deno.loadavg() },
  },
  null,
  2,
));
