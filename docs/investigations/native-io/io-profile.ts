// Protótipo da #584: perfil de CPU e de espera por I/O dos fluxos do Vetor.
//
// Cada fluxo roda num scope próprio do systemd do usuário. Ao terminar, o script lê do cgroup do
// scope: CPU (usuário e sistema), tempo parado esperando I/O (PSI: `io.pressure`, linha `some`) e
// pico de memória. Se `cpu + espera de I/O` é bem menor que o tempo de parede, o fluxo espera outra
// coisa (rede, subprocesso, sleep), não disco.
//
// Uso (ler /sys/fs/cgroup exige --allow-all no Deno 2.x):
//   deno run -A docs/investigations/native-io/io-profile.ts [--runs 3] [--skip-tests]
// Rode a partir da raiz de um checkout do Vetor.

const runs = Number(Deno.args[Deno.args.indexOf("--runs") + 1]) || 3;
const skipTests = Deno.args.includes("--skip-tests");
const root = Deno.cwd();
const tmp = await Deno.makeTempDir({ prefix: "vetor-io-" });

const flows: { name: string; cmd: string; cleanup?: string }[] = [
  {
    name: "git worktree add",
    cmd: `git worktree add -q --detach ${tmp}/wt HEAD`,
    cleanup: `git worktree remove --force ${tmp}/wt`,
  },
  { name: "prepare-worktree --path (deno)", cmd: `deno run -A scripts/prepare-worktree.ts --path . --source .` },
  { name: "repo-map sem cache", cmd: `rm -f ${tmp}/rm.json; deno run -A scripts/repo-map.ts --cache-path ${tmp}/rm.json` },
  { name: "repo-map com cache", cmd: `deno run -A scripts/repo-map.ts --cache-path ${tmp}/rm.json` },
  { name: "vetor-status.sh", cmd: `bash scripts/vetor-status.sh` },
  { name: "guardian-audit", cmd: `deno run -A scripts/guardian-audit.ts --format json .` },
  { name: "now-probe", cmd: `deno run -A scripts/now-probe.ts` },
];
if (!skipTests) flows.push({ name: "deno task test", cmd: `deno task test` });

async function out(cmd: string, args: string[]) {
  const o = await new Deno.Command(cmd, { args, stdout: "piped", stderr: "piped" }).output();
  return new TextDecoder().decode(o.stdout).trim();
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function profile(flow: { name: string; cmd: string }, i: number) {
  const unit = `vetor-io-${Deno.pid}-${i}.scope`;
  const marker = `${tmp}/done-${i}`;
  // O `sleep 30` mantém o cgroup vivo até a leitura; o stop no finally encerra antes.
  const script = `cd '${root}' && { ${flow.cmd}; } >/dev/null 2>&1; echo $? > '${marker}'; sleep 30`;
  const t0 = performance.now();
  const child = new Deno.Command("systemd-run", {
    args: ["--user", "--scope", "--quiet", `--unit=${unit}`, "bash", "-c", script],
    stdout: "null",
    stderr: "null",
  }).spawn();
  try {
    let cg = "";
    while (true) {
      if (!cg) {
        const p = await out("systemctl", ["--user", "show", "-p", "ControlGroup", "--value", unit]);
        if (p) cg = `/sys/fs/cgroup${p}`;
      }
      try {
        const code = Deno.readTextFileSync(marker).trim();
        const wallMs = performance.now() - t0;
        const cpu = Object.fromEntries(
          Deno.readTextFileSync(`${cg}/cpu.stat`).trim().split("\n").map((l) => l.split(" ")),
        );
        const io = Deno.readTextFileSync(`${cg}/io.pressure`);
        const ioSomeUs = Number(io.match(/some .* total=(\d+)/)![1]);
        const ioFullUs = Number(io.match(/full .* total=(\d+)/)![1]);
        const peak = Number(Deno.readTextFileSync(`${cg}/memory.peak`));
        return {
          exit: Number(code),
          wallMs,
          userMs: Number(cpu.user_usec) / 1000,
          sysMs: Number(cpu.system_usec) / 1000,
          ioSomeMs: ioSomeUs / 1000,
          ioFullMs: ioFullUs / 1000,
          peakMiB: peak / 2 ** 20,
        };
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) throw e;
        await sleep(20);
      }
    }
  } finally {
    await out("systemctl", ["--user", "stop", unit]);
    await out("systemctl", ["--user", "reset-failed", unit]);
    await child.status;
  }
}

const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const rows = [];
let i = 0;
try {
  for (const flow of flows) {
    const samples = [];
    for (let r = 0; r < runs; r++) {
      samples.push(await profile(flow, i++));
      if (flow.cleanup) await new Deno.Command("bash", { args: ["-c", flow.cleanup], cwd: root }).output();
    }
    const m = (k: keyof (typeof samples)[number]) => +med(samples.map((s) => s[k] as number)).toFixed(1);
    const wall = m("wallMs");
    rows.push({
      flow: flow.name,
      exits: samples.map((s) => s.exit).join(","),
      wallMs: wall,
      cpuMs: +(m("userMs") + m("sysMs")).toFixed(1),
      sysMs: m("sysMs"),
      ioStallMs: m("ioSomeMs"),
      ioStallPctOfWall: +(m("ioSomeMs") / wall * 100).toFixed(2),
      peakMiB: m("peakMiB"),
    });
  }
} finally {
  await new Deno.Command("bash", { args: ["-c", `git worktree remove --force ${tmp}/wt 2>/dev/null; git worktree prune`], cwd: root }).output();
  await Deno.remove(tmp, { recursive: true });
}

console.log(JSON.stringify({ deno: Deno.version.deno, runs, rows }, null, 2));
