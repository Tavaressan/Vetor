// Sonda da #585: a FFI do Deno (Deno.dlopen) como alternativa a um binário nativo próprio.
//
// No Linux, carrega a libc e chama duas funções de sistema que o Deno não expõe:
// - prctl(PR_SET_CHILD_SUBREAPER): o supervisor vira "subreaper", e os netos órfãos de um worker
//   passam a ser filhos dele, em vez do systemd --user (o problema visto na #582 §4.2);
// - getpgid(pid): grupo de processos de um pid, sem ler /proc.
// Mede o custo de abrir a biblioteca e de cada chamada. No Windows, o mesmo mecanismo abriria a
// kernel32.dll (Job Objects); não há host Windows nesta investigação.
//
// Uso:
//   deno run --allow-ffi --allow-run=bash docs/investigations/native-backend/ffi-probe.ts

if (Deno.build.os !== "linux") {
  console.error(`ffi-probe: só Linux nesta sonda (os=${Deno.build.os})`);
  Deno.exit(2);
}

const PR_SET_CHILD_SUBREAPER = 36;
const PR_GET_CHILD_SUBREAPER = 37;

const t0 = performance.now();
const libc = Deno.dlopen("libc.so.6", {
  prctl: { parameters: ["i32", "u64", "u64", "u64", "u64"], result: "i32" },
  getpgid: { parameters: ["i32"], result: "i32" },
  getpid: { parameters: [], result: "i32" },
});
const dlopenMs = performance.now() - t0;

// Custo por chamada (getpid como referência de uma ida e volta pela FFI).
const n = 100_000;
const c0 = performance.now();
for (let i = 0; i < n; i++) libc.symbols.getpid();
const perCallUs = (performance.now() - c0) / n * 1000;

// Subreaper: antes, órfãos iam para o systemd --user; depois, para este processo.
const out = new Uint8Array(4);
const before = libc.symbols.prctl(PR_GET_CHILD_SUBREAPER, BigInt(Deno.UnsafePointer.value(Deno.UnsafePointer.of(out))), 0n, 0n, 0n);
const subreaperBefore = new DataView(out.buffer).getInt32(0, true);
const set = libc.symbols.prctl(PR_SET_CHILD_SUBREAPER, 1n, 0n, 0n, 0n);

// bash cria um neto e sai na hora: o neto fica órfão e é reparentado.
const child = new Deno.Command("bash", {
  args: ["-c", "(sleep 2 & echo $!) ; exit 0"],
  stdout: "piped",
}).spawn();
const grandchild = Number(new TextDecoder().decode((await child.output()).stdout).trim());
await new Promise((r) => setTimeout(r, 200));
const ppid = await new Deno.Command("ps", { args: ["-o", "ppid=", "-p", String(grandchild)], stdout: "piped" })
  .output().then((o) => Number(new TextDecoder().decode(o.stdout).trim()));

console.log(JSON.stringify(
  {
    deno: Deno.version.deno,
    dlopenMs: +dlopenMs.toFixed(3),
    ffiCallUs: +perCallUs.toFixed(3),
    pid: libc.symbols.getpid(),
    pgid: libc.symbols.getpgid(0),
    prctlGetResult: before,
    subreaperBefore,
    prctlSetResult: set,
    grandchild,
    grandchildPpidAfterOrphaned: ppid,
    reparentedToThisProcess: ppid === Deno.pid,
  },
  null,
  2,
));
try {
  Deno.kill(grandchild, "SIGKILL");
} catch { /* já saiu */ }
libc.close();
