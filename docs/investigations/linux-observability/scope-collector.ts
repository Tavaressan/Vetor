// Protótipo da #583: workers em scopes do systemd do usuário (cgroups v2, sem root) e um coletor
// único, sob demanda, que lê todos os scopes `vetor-obs-*` do host com taxa limitada.
//
// Mede: o que cada scope expõe (CPU, memória, pico, eventos de OOM, tarefas, PSI, I/O), a
// atribuição por metadado da unit (Description) e não por diretório, o custo do coletor por amostra
// com 1, 5 e 10 workers, e o efeito de MemoryMax num worker que estoura o limite.
// Nada fica rodando: todo scope criado aqui é parado num `finally`, e cada worker tem `timeout`.
//
// Uso (ler /sys/fs/cgroup exige --allow-all no Deno 2.x, #582 §4.3):
//   deno run -A docs/investigations/linux-observability/scope-collector.ts [--hz 1] [--seconds 10]

const hz = Number(Deno.args[Deno.args.indexOf("--hz") + 1]) || 1;
const seconds = Number(Deno.args[Deno.args.indexOf("--seconds") + 1]) || 10;
const PREFIX = `vetor-obs-${Deno.pid}`;
const USER_ROOT = `/sys/fs/cgroup/user.slice/user-${Deno.uid()}.slice/user@${Deno.uid()}.service`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function out(cmd: string, args: string[]) {
  const o = await new Deno.Command(cmd, { args, stdout: "piped", stderr: "piped" }).output();
  const d = new TextDecoder();
  return { code: o.code, stdout: d.decode(o.stdout), stderr: d.decode(o.stderr) };
}
function pct(xs: number[], q: number) {
  const s = [...xs].sort((a, b) => a - b);
  return +s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(3);
}
function selfCpuMs(): number {
  const rest = Deno.readTextFileSync("/proc/self/stat").split(") ")[1].split(" ");
  return (Number(rest[11]) + Number(rest[12])) * 10; // CLK_TCK = 100
}

/** Lança um worker sintético num scope próprio, com metadado de atribuição na Description. */
function launch(name: string, meta: string, limits: string[], script: string) {
  return new Deno.Command("systemd-run", {
    args: [
      "--user",
      "--scope",
      "--quiet",
      `--unit=${name}.scope`,
      `--description=${meta}`,
      ...limits.flatMap((l) => ["-p", l]),
      "bash",
      "-c",
      script,
    ],
    stdout: "null",
    stderr: "null",
  }).spawn();
}

/** Coletor: um único processo, uma passada por todos os scopes vetor-obs-* do usuário. */
function findScopes(): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 3) return;
    for (const e of Deno.readDirSync(dir)) {
      if (!e.isDirectory) continue;
      const p = `${dir}/${e.name}`;
      if (e.name.startsWith(PREFIX) && e.name.endsWith(".scope")) found.push(p);
      else if (e.name.endsWith(".slice")) walk(p, depth + 1);
    }
  };
  walk(USER_ROOT, 0);
  return found;
}

function readKv(path: string): Record<string, number> {
  try {
    return Object.fromEntries(
      Deno.readTextFileSync(path).trim().split("\n").map((l) => {
        const [k, v] = l.split(" ");
        return [k, Number(v)];
      }),
    );
  } catch {
    return {};
  }
}
function readNum(path: string): number | null {
  try {
    const v = Deno.readTextFileSync(path).trim();
    return v === "max" ? Infinity : Number(v);
  } catch {
    return null;
  }
}
function readPsi(path: string): number | null {
  try {
    return Number(Deno.readTextFileSync(path).match(/some avg10=([\d.]+)/)![1]);
  } catch {
    return null;
  }
}

function sample(scope: string) {
  return {
    unit: scope.split("/").at(-1)!,
    cpuUsec: readKv(`${scope}/cpu.stat`).usage_usec ?? null,
    memCurrent: readNum(`${scope}/memory.current`),
    memPeak: readNum(`${scope}/memory.peak`),
    memMax: readNum(`${scope}/memory.max`),
    memEvents: readKv(`${scope}/memory.events`),
    pids: readNum(`${scope}/pids.current`),
    cpuPressure10: readPsi(`${scope}/cpu.pressure`),
    memPressure10: readPsi(`${scope}/memory.pressure`),
    ioStat: (() => {
      try {
        return Deno.readTextFileSync(`${scope}/io.stat`).trim() || "(vazio)";
      } catch (e) {
        return `indisponível: ${(e as Error).name}`;
      }
    })(),
  };
}

const CPU_WORKER = "(timeout 60 bash -c 'while :; do :; done') & sleep 60 & wait";
// Aloca ~200 MiB em blocos de 10 MiB; com MemoryMax=64M o kernel deve matar o processo.
const MEM_WORKER = "timeout 60 python3 -c 'import time\nb=[]\nfor i in range(20):\n b.append(bytearray(10*2**20)); time.sleep(0.05)\ntime.sleep(30)'";

const created: string[] = [];
const results: Record<string, unknown> = { deno: Deno.version.deno, hz, seconds };
try {
  // 1. Atribuição e métricas de um worker.
  const first = `${PREFIX}-w1`;
  created.push(first);
  launch(first, "vetor dispatch=ctx_demo1 issue=583 worktree=/tmp/x", ["MemoryMax=256M", "TasksMax=64"], CPU_WORKER);
  await sleep(1500);
  const desc = await out("systemctl", ["--user", "show", "-p", "Description", "--value", `${first}.scope`]);
  results.attribution = { unit: `${first}.scope`, description: desc.stdout.trim() };
  results.oneScope = sample(findScopes()[0]);

  // 2. OOM: o limite é aplicado pelo kernel e fica registrado em memory.events.
  const oom = `${PREFIX}-oom`;
  created.push(oom);
  const t0 = performance.now();
  const oomChild = launch(oom, "vetor dispatch=ctx_demo_oom issue=583", ["MemoryMax=64M", "MemorySwapMax=0"], MEM_WORKER);
  const oomStatus = await oomChild.status;
  results.oom = {
    exitCode: oomStatus.code,
    signal: oomStatus.signal,
    ms: Math.round(performance.now() - t0),
    unitAfter: (await out("systemctl", ["--user", "is-active", `${oom}.scope`])).stdout.trim(),
    // O cgroup some com a unit; o systemd guarda o desfecho até o reset-failed.
    systemd: Object.fromEntries(
      (await out("systemctl", ["--user", "show", "-p", "Result", "-p", "MemoryPeak", `${oom}.scope`]))
        .stdout.trim().split("\n").map((l) => l.split("=")),
    ),
  };

  // 3. Custo do coletor com 1, 5 e 10 workers, à taxa pedida.
  const cost: Record<string, unknown> = {};
  for (const n of [1, 5, 10]) {
    while (created.filter((c) => c.includes("-w")).length < n) {
      const name = `${PREFIX}-w${created.length + 1}`;
      created.push(name);
      launch(name, `vetor dispatch=ctx_demo${created.length} issue=583`, ["MemoryMax=256M", "CPUQuota=20%"], CPU_WORKER);
    }
    await sleep(1000);
    const perSample: number[] = [];
    const cpu0 = selfCpuMs();
    const w0 = performance.now();
    let scopes = 0;
    for (let i = 0; i < seconds * hz; i++) {
      const s = performance.now();
      const all = findScopes().map(sample);
      perSample.push(performance.now() - s);
      scopes = all.length;
      await sleep(1000 / hz);
    }
    const wallMs = performance.now() - w0;
    cost[`workers=${n}`] = {
      scopesSeen: scopes,
      sampleMs: { p50: pct(perSample, 0.5), p95: pct(perSample, 0.95), max: pct(perSample, 1) },
      collectorCpuPct: +((selfCpuMs() - cpu0) / wallMs * 100).toFixed(3),
      collectorRssMiB: +(Deno.memoryUsage().rss / 2 ** 20).toFixed(1),
    };
  }
  results.collectorCost = cost;
} finally {
  for (const c of created) await out("systemctl", ["--user", "stop", `${c}.scope`]);
  // Uma unit que falhou (ex.: OOM) continua listada como `failed` até o reset-failed.
  for (const c of created) await out("systemctl", ["--user", "reset-failed", `${c}.scope`]);
  const left = await out("systemctl", ["--user", "list-units", "--all", `${PREFIX}*`, "--no-legend", "--plain"]);
  results.leftoverUnits = left.stdout.trim() || "nenhuma";
}

console.log(JSON.stringify(results, null, 2));
