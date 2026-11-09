// Sonda da #582: executáveis nativos que já existem no host (ps, systemd-run, systemctl) como
// alternativa a ler /proc e /sys, que no Deno 2.x exigem --allow-all.
//
// Mede: (1) custo de uma amostra da árvore por `ps`; (2) custo de lançar o worker dentro de um
// scope do systemd do usuário, com limites; (3) leitura de CPU, memória e tarefas do scope por
// `systemctl show` (sem tocar em /sys) e, com --direct, lendo o cgroup em /sys; (4) encerramento
// pelo systemd, que alcança processos que trocaram de grupo. Só Linux com systemd.
//
// Uso:
//   deno run --allow-run docs/investigations/deno-system-apis/probe-native-tools.ts [--runs 10]
//   deno run -A docs/investigations/deno-system-apis/probe-native-tools.ts --direct
// Deno.kill exige --allow-run sem lista (--allow-run=bash,ps,... falha com NotCapable), e ler
// /sys/fs/cgroup exige --allow-all.

const runs = Number(Deno.args[Deno.args.indexOf("--runs") + 1]) || 10;
const direct = Deno.args.includes("--direct");
const WORKER = "(timeout 30 bash -c 'while :; do :; done') & sleep 30 & wait";

function pct(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return +s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(2);
}

async function out(cmd: string, args: string[]) {
  const o = await new Deno.Command(cmd, { args, stdout: "piped", stderr: "piped" }).output();
  const d = new TextDecoder();
  return { code: o.code, stdout: d.decode(o.stdout), stderr: d.decode(o.stderr) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// (1) ps: uma chamada lista todos os processos da sessão do worker.
async function probePs() {
  const root = new Deno.Command("bash", {
    args: ["-c", WORKER],
    detached: true,
    stdout: "null",
    stderr: "null",
  }).spawn();
  const cost: number[] = [];
  let rows = 0;
  try {
    await sleep(300);
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      const r = await out("ps", ["-o", "pid=,ppid=,pgid=,rss=,cputimes=", "-s", String(root.pid)]);
      cost.push(performance.now() - t0);
      rows = r.stdout.trim().split("\n").length;
    }
  } finally {
    // -s <sid> alcança quem trocou de grupo mas ficou na sessão (o `timeout` faz setpgid).
    const left = await out("ps", ["-o", "pid=", "-s", String(root.pid)]);
    for (const pid of left.stdout.trim().split("\n").filter(Boolean).map(Number)) {
      try {
        Deno.kill(pid, "SIGKILL");
      } catch { /* saiu */ }
    }
    await root.status;
  }
  return { rows, costMs: { p50: pct(cost, 0.5), p95: pct(cost, 0.95) } };
}

// (2)-(4) systemd-run --user --scope: o worker nasce num cgroup próprio, com limites.
async function probeScope() {
  const unit = `vetor-probe-${Deno.pid}.scope`;
  const t0 = performance.now();
  const scoped = new Deno.Command("systemd-run", {
    args: [
      "--user",
      "--scope",
      "--quiet",
      `--unit=${unit}`,
      "-p",
      "MemoryMax=256M",
      "-p",
      "CPUQuota=50%",
      "bash",
      "-c",
      WORKER,
    ],
    stdout: "null",
    stderr: "null",
  }).spawn();
  try {
    let active = false;
    for (let i = 0; i < 200 && !active; i++) {
      active = (await out("systemctl", ["--user", "is-active", unit])).stdout.trim() === "active";
      if (!active) await sleep(5);
    }
    const readyMs = performance.now() - t0;

    const props = ["CPUUsageNSec", "MemoryCurrent", "TasksCurrent", "MemoryMax", "CPUQuotaPerSecUSec", "ControlGroup"];
    const show = async () => {
      const r = await out("systemctl", ["--user", "show", unit, ...props.flatMap((p) => ["-p", p])]);
      return Object.fromEntries(r.stdout.trim().split("\n").map((l) => l.split(/=(.*)/s).slice(0, 2)));
    };

    await sleep(1000);
    const cost: number[] = [];
    const first = await show();
    const w0 = performance.now();
    let last = first;
    for (let i = 0; i < runs; i++) {
      const s = performance.now();
      last = await show();
      cost.push(performance.now() - s);
      await sleep(100);
    }
    const cpuPct = (Number(last.CPUUsageNSec) - Number(first.CPUUsageNSec)) / 1e6 /
      (performance.now() - w0) * 100;

    let directRead: unknown = "não medido (rode com -A --direct)";
    if (direct) {
      const cg = `/sys/fs/cgroup${last.ControlGroup}`;
      const dc: number[] = [];
      for (let i = 0; i < runs; i++) {
        const s = performance.now();
        Deno.readTextFileSync(`${cg}/cpu.stat`);
        Deno.readTextFileSync(`${cg}/memory.current`);
        Deno.readTextFileSync(`${cg}/cgroup.procs`);
        dc.push(performance.now() - s);
      }
      directRead = { costMs: { p50: pct(dc, 0.5), p95: pct(dc, 0.95) } };
    }

    const k0 = performance.now();
    const stop = await out("systemctl", ["--user", "stop", unit]);
    await scoped.status;
    const stopMs = performance.now() - k0;
    const after = (await out("systemctl", ["--user", "is-active", unit])).stdout.trim();

    return {
      readyMs: +readyMs.toFixed(1),
      controlGroup: last.ControlGroup,
      tasks: Number(last.TasksCurrent),
      cpuPctUnderQuota50: +cpuPct.toFixed(1),
      memoryCurrentMiB: +(Number(last.MemoryCurrent) / 2 ** 20).toFixed(2),
      limits: { MemoryMax: last.MemoryMax, CPUQuotaPerSecUSec: last.CPUQuotaPerSecUSec },
      systemctlShowCostMs: { p50: pct(cost, 0.5), p95: pct(cost, 0.95) },
      directRead,
      stop: { code: stop.code, ms: +stopMs.toFixed(1), afterStop: after },
    };
  } finally {
    await out("systemctl", ["--user", "stop", unit]); // idempotente
  }
}

console.log(JSON.stringify(
  { deno: Deno.version.deno, ps: await probePs(), systemdScope: await probeScope() },
  null,
  2,
));
