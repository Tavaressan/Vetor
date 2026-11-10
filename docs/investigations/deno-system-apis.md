# Investigação: capacidades de sistema nas APIs do Deno, por plataforma

**Issue:** #582 — spike(system): capacidades de sistema disponíveis nas APIs do Deno, por plataforma
**Data:** 2026-11-09
**Base:** `master` em `f6ab98f`
**Contexto:** ADR-001, INV-004 (P1), §5, §8 e §10.2. Linha de base para a #583 (cgroups/eBPF), a #584
(I/O nativo) e a #585 (Rust).

**Rótulos:** **[Fato]** medido neste host ou lido na fonte citada · **[Doc]** documentação embutida do
Deno 2.9.8 (`deno doc --filter <símbolo>`), não executada naquela plataforma · **[Inferência]** ·
**[Opinião]** · **[Não verificado]**.

---

## 1. Pergunta

O que as APIs do Deno já entregam para supervisionar processos e medir recursos em Linux, macOS e
Windows, com quais permissões e a que custo, antes de considerar Rust?

1. O que `Deno.Command`, `Deno.ChildProcess`, `Deno.kill`, `Deno.systemMemoryInfo`, `Deno.loadavg` e
   o filesystem cobrem?
2. Dá para obter CPU e memória por processo e pela árvore de um worker sem binário nativo?
3. Quais flags de permissão cada caso exige, e como isso afeta hooks e scripts?
4. Executáveis já existentes (`systemd-run`, `ps`, `cgexec`) resolvem algum caso sem Rust?
5. Como seria a detecção de capacidades da ADR §8.1?

## 2. Ambiente

| Item | Valor |
| --- | --- |
| Deno | 2.9.8 (V8 15.0.245.2, TypeScript 6.0.3) |
| SO | Omarchy (Arch), kernel 7.2.15, x86_64, 12 CPUs, 16 GB de RAM |
| cgroups | v2 (`cgroup2fs`); controladores delegados ao usuário: `cpu memory pids` |
| systemd | 262, `systemctl --user is-system-running` = `running` |
| Ausentes | `cgexec`, `bpftool`, `/usr/bin/time`, `hyperfine` |
| macOS / Windows | **sem host disponível**: as colunas dessas plataformas vêm da documentação e ficam marcadas |

Este terminal roda num scope criado pelo Orca
(`/proc/self/cgroup` = `…/orca_ptys_orca_daemon_…slice/orca_pty_orca_daemon_…_2.scope`).

## 3. Resumo

- **[Fato]** No Linux, o Deno sozinho mede CPU e RSS de toda a árvore de um worker lendo `/proc`, a
  **0,24 ms por amostra** (p50, árvore de 4 processos), e encerra a árvore. Não precisa de binário
  nativo.
- **[Fato]** **Ler `/proc/<pid>/*` e `/sys/fs/cgroup/*` exige `--allow-all` no Deno 2.9.8.**
  `--allow-read=/proc` falha com `NotCapable: Requires all access to "/proc/<pid>/stat"`. E o
  `Deno.kill` exige `--allow-run` **sem lista**: `--allow-run=bash,ps` falha com `NotCapable`.
- **[Fato]** **Matar o grupo de processos não alcança a árvore inteira.** Com `detached: true` o filho
  ganha sessão e grupo próprios, mas `Deno.kill(-pgid)` deixou 2 de 4 processos vivos, porque o GNU
  `timeout` cria um grupo próprio. Percorrer a árvore pelo `/proc`, pelo `ps -s <sid>` ou pelo scope
  do systemd pegou todos.
- **[Fato]** **Quando o Deno sai, os filhos continuam**: foram reparentados para o `systemd --user`
  (PID 1086), sem nenhum sinal. Um supervisor em Deno precisa encerrar a árvore explicitamente.
- **[Fato]** `systemd-run --user --scope` resolve, **sem root e sem Rust**, as três coisas que o
  `/proc` não resolve bem: limite de CPU e memória aplicado pelo kernel (47,1 % sob `CPUQuota=50%`),
  contabilidade por cgroup e encerramento garantido de tudo no scope (`systemctl --user stop`, 70 ms).
  O scope sobe em 38 ms, e a leitura por `systemctl show` custa 5,8 ms sem precisar de `--allow-all`.
- **[Doc]** macOS e Windows não têm `/proc`. `Deno.kill` com PID negativo lança erro no Windows, e o
  `Deno.loadavg` lá devolve `[0, 0, 0]`. Nos dois, a árvore de processos depende de executável do SO
  (`ps` no macOS, `taskkill /T` no Windows). **[Não verificado]** nesta máquina.
- **[Opinião]** Nenhuma capacidade medida aqui exige Rust. A lacuna real é de **permissão**, não de
  API: o caminho por `/proc` exige `-A`, e o caminho por executáveis do SO cabe em `--allow-run`.

## 4. Evidências

### 4.1 Sondas executáveis

Ficam em `docs/investigations/deno-system-apis/`, fora de `scripts/`, então não entram em
`deno task test`, `lint` nem `check`.

| Arquivo | O que faz | Permissão mínima que funcionou |
| --- | --- | --- |
| `probe-tree.ts` | lança um worker sintético (bash, laço de CPU, sleep), percorre a árvore por `/proc/<pid>/task/*/children`, amostra CPU e RSS, encerra por grupo (`--detached`) ou nó a nó | `-A` |
| `probe-native-tools.ts` | mesma árvore por `ps -s <sid>`; o worker dentro de `systemd-run --user --scope` com `MemoryMax=256M` e `CPUQuota=50%`; leitura por `systemctl show`; com `--direct`, leitura de `/sys/fs/cgroup` | `--allow-run` (com `--direct`: `-A`) |

Os dois limitam o worker com `timeout 30` e encerram a árvore num `finally`, para não deixar órfãos.

### 4.2 Saídas registradas

`deno run -A probe-tree.ts --samples 30 --detached`:

```json
{ "deno": "2.9.8", "detached": true, "rootPgrpIsOwn": true, "rootSessionIsOwn": true,
  "treeSize": 4, "firstSampleMs": 0.351,
  "sampleCostMs": { "p50": 0.236, "p95": 0.322, "max": 0.323 },
  "treeCpuPct": { "p50": 98.5 }, "treeRssMiB": 12.81,
  "killMode": "Deno.kill(-pgid)", "killMs": 102.3, "survivors": [592171, 592173] }
```

`deno run -A probe-tree.ts --samples 30` (sem `detached`):

```json
{ "detached": false, "rootPgrpIsOwn": false, "rootSessionIsOwn": false, "treeSize": 4,
  "sampleCostMs": { "p50": 0.244, "p95": 0.329, "max": 0.362 }, "treeCpuPct": { "p50": 98.5 },
  "treeRssMiB": 12.72, "killMode": "Deno.kill(pid) por nó", "killMs": 102.4, "survivors": [] }
```

Os dois sobreviventes da primeira rodada eram o `timeout 30` e o laço filho dele, que estavam num
grupo próprio.

`deno run --allow-run probe-native-tools.ts --runs 20`:

```json
{ "ps": { "rows": 4, "costMs": { "p50": 11.05, "p95": 12.1 } },
  "systemdScope": { "readyMs": 38.3, "tasks": 4, "cpuPctUnderQuota50": 47.1, "memoryCurrentMiB": 1.47,
    "limits": { "MemoryMax": "268435456", "CPUQuotaPerSecUSec": "500ms" },
    "systemctlShowCostMs": { "p50": 5.78, "p95": 6.56 },
    "stop": { "code": 0, "ms": 70.3, "afterStop": "inactive" } } }
```

Com `-A --direct`, ler `cpu.stat`, `memory.current` e `cgroup.procs` do scope custou **0,04 ms** (p50).

**[Fato]** O RSS somado pelo `/proc` (12,8 MiB) e o `memory.current` do cgroup (1,5 MiB) medem coisas
diferentes: o RSS conta páginas compartilhadas (bash, libc) em cada processo, e o cgroup conta só a
memória cobrada ao scope. Para limitar ou atribuir consumo, o número certo é o do cgroup.

### 4.3 Permissões testadas

```text
deno run --allow-run=bash --allow-read=/proc --allow-sys=systemMemoryInfo,loadavg probe-tree.ts
  → NotCapable: Requires all access to "/proc/592155/stat"
deno run --allow-read=/proc  (ler /proc/<pid>/stat e /proc/<pid>/task)
  → NotCapable: Requires all access to "/proc/591981/task", run again with the --allow-all flag
deno run --allow-run=bash,ps,systemd-run,systemctl …  (Deno.kill(-pid))
  → NotCapable: Requires run access, run again with the --allow-run flag
deno run --allow-run --allow-read=/sys/fs/cgroup …  (ler cpu.stat do scope)
  → NotCapable: Requires all access to "/sys/fs/cgroup/…/vetor-probe-593057.scope/cpu.stat"
```

**[Fato]** O mesmo `deno eval`, que roda com permissão total, leu `/proc/<pid>/stat` normalmente.

**[Fato]** A consulta de permissão não reflete a exigência de `-A`:

```text
--allow-read=/proc  → { "query": "granted", "read": "NotCapable" }
-A                  → { "query": "granted", "read": "ok" }
(sem flag)          → { "query": "prompt",  "read": "NotCapable" }
```

(`Deno.permissions.querySync({ name: "read", path: "/proc/self/stat" })` contra uma leitura real de
`/proc/<Deno.pid>/stat`.)

### 4.4 Inicialização e memória

| Medida | Valor | Como |
| --- | --- | --- |
| `deno run` de um script mínimo (`systemMemoryInfo` + `loadavg`) | p50 **16 ms**, p95 16 ms (n = 15) | `time` do bash, cache quente |
| RSS de um processo Deno mínimo | **~55 MiB** (`Deno.memoryUsage().rss` = 57 335 808) | informado pelo próprio script |
| `bash scripts/vetor-checks.sh repo-root` | p50 8 ms | idem |
| `deno run -A scripts/stalled-workers.ts` | p50 20 ms | idem |
| `systemctl --user is-system-running` | 3 ms | idem |
| `systemd-run --user --scope --quiet true` | 5 ms (14 ms na primeira) | idem |

## 5. Matriz de capacidades

Legenda: ✅ funciona e foi medido · 📄 documentado, não executado · ⚠️ parcial · ❌ não existe.

| Capacidade | Linux | macOS | Windows | API ou executável | Permissão Deno | Custo medido (Linux) |
| --- | --- | --- | --- | --- | --- | --- |
| Lançar processo com cwd e env | ✅ | 📄 | 📄 | `Deno.Command` (`cwd`, `env`, `clearEnv`) | `--allow-run[=bin]` | parte dos 16 ms de um `deno run` |
| Lançar em sessão e grupo novos | ✅ `detached: true` → `setsid` | 📄 `detached` existe | 📄 `detached` existe; grupo **[Não verificado]** | `CommandOptions.detached` | `--allow-run[=bin]` | — |
| Timeout ou cancelamento | ✅ | 📄 | 📄 | `CommandOptions.signal` (`AbortSignal`) | `--allow-run[=bin]` | — |
| Sinal a um processo | ✅ | 📄 | ⚠️ 📄 só término | `Deno.kill(pid, sig)`, `child.kill()` | `--allow-run` **sem lista** | — |
| Sinal ao grupo | ⚠️ não alcança quem troca de grupo | 📄 | ❌ 📄 "An error will be thrown if a negative pid is used on Windows" | `Deno.kill(-pgid)` | `--allow-run` sem lista | 102 ms até confirmar |
| Árvore de processos | ✅ `/proc/<pid>/task/*/children` | ⚠️ só por `ps` | ⚠️ só por executável (`wmic`/PowerShell) **[Não verificado]** | fs ou `Deno.Command` | `/proc`: `-A`; `ps`: `--allow-run` | `/proc` 0,24 ms; `ps` 11 ms |
| CPU e RSS por processo | ✅ `/proc/<pid>/stat` | ⚠️ `ps -o rss,time` | ⚠️ executável | idem | idem | idem |
| Encerrar a árvore inteira | ✅ nó a nó pelo `/proc`, por `ps -s`, ou pelo scope | ⚠️ `ps` + `Deno.kill` | 📄 `taskkill /T /F` **[Não verificado]** | — | `--allow-run` sem lista | 70–102 ms |
| Limite de CPU e memória | ✅ `systemd-run --user --scope -p …` | ❌ sem equivalente sem privilégio | ⚠️ Job Objects só por API nativa ou PowerShell **[Não verificado]** | executável | `--allow-run` | 38 ms para subir o scope |
| Contabilidade por cgroup | ✅ `systemctl show` ou `/sys/fs/cgroup` | ❌ | ❌ | executável ou fs | `--allow-run` ou `-A` | 5,8 ms ou 0,04 ms |
| Memória do host | ✅ | 📄 | 📄 | `Deno.systemMemoryInfo()` | `--allow-sys=systemMemoryInfo` | < 1 ms |
| Carga do host | ✅ | 📄 | ❌ 📄 "returns `[0, 0, 0]`" | `Deno.loadavg()` | `--allow-sys=loadavg` | < 1 ms |
| Memória do próprio Deno | ✅ | 📄 | 📄 | `Deno.memoryUsage()` | nenhuma | — |
| Sinais recebidos | ✅ | 📄 | ⚠️ 📄 só `SIGINT`, `SIGBREAK` | `Deno.addSignalListener` | nenhuma | — |
| Filhos sobrevivem à saída do Deno | ✅ sim (reparentados ao subreaper) | 📄 | **[Não verificado]** | — | — | — |

## 6. Respostas

### 6.1 Pergunta 1: o que as APIs cobrem

**[Fato]** `Deno.Command` cobre lançamento, cwd, env, timeout por `AbortSignal` e sessão própria
(`detached`). `Deno.ChildProcess` dá `pid`, `status` e `kill`. `Deno.kill` cobre sinal a processo e,
fora do Windows, a grupo. `Deno.systemMemoryInfo` e `Deno.loadavg` cobrem o host. **Não há** API do
Deno para listar processos, ler o consumo de outro processo nem aplicar limite de recurso.

### 6.2 Pergunta 2: CPU e memória por árvore sem binário nativo

- **Linux:** sim. Lendo `/proc`, uma amostra da árvore custa 0,24 ms. Com o worker num scope do
  systemd, o cgroup dá o número correto de memória e o encerramento garantido.
- **macOS:** só chamando `ps`, a ~11 ms por amostra no Linux (no macOS, **[Não verificado]**). Sem
  limite de recurso sem privilégio.
- **Windows:** só por executável do SO. **[Não verificado]**.

### 6.3 Pergunta 3: permissões

| Caso | Flag necessária | Efeito nos scripts atuais |
| --- | --- | --- |
| Ler `/proc/<pid>/*` ou `/sys/fs/cgroup/*` | `--allow-all` (`-A`) | Nenhum: os hooks já rodam com `deno run -A` (`hooks/hooks.json`, `hooks/hooks-codex.json`), assim como os scripts citados nas skills |
| Enviar sinal (`Deno.kill`) | `--allow-run` sem lista | Nenhum hoje (`-A`). Impede restringir um supervisor a `--allow-run=<agente>` |
| Lançar processo | `--allow-run=<bin>` | Um supervisor que lança o CLI do harness (`opencode`, `codex`, `claude`) precisa da lista dos binários |
| Memória e carga do host | `--allow-sys=systemMemoryInfo,loadavg` | — |

**[Inferência]** Como tudo no Vetor já roda com `-A`, a exigência não muda nada hoje. Ela só pesa se o
projeto quiser estreitar permissões de um supervisor no futuro, e nesse caso o caminho por
executáveis (`ps`, `systemctl`) é o único que cabe em `--allow-run`.

### 6.4 Pergunta 4: executáveis já existentes

| Executável | Resolve | Custo | Disponibilidade |
| --- | --- | --- | --- |
| `systemd-run --user --scope` + `systemctl --user` | limite de CPU e memória, contabilidade por cgroup, encerramento de tudo no scope, inclusive quem trocou de grupo | 38 ms para subir; 5,8 ms por leitura; 70 ms para parar | Linux com systemd e sessão de usuário. Não existe em containers sem systemd, WSL sem systemd, macOS nem Windows |
| `ps -o … -s <sid>` | árvore, CPU acumulada e RSS sem `-A` | 11 ms por amostra | Linux; no macOS o `ps` BSD tem outras flags (**[Não verificado]**) |
| `cgexec` | — | — | não instalado aqui; o `systemd-run` cobre o mesmo caso em hosts com systemd |
| `taskkill /T /F /PID` | árvore no Windows | — | **[Não verificado]** |

**[Fato]** O `systemd-run` resolve sem Rust o caso que a #583 quer investigar (limitar e medir um
worker e os filhos sem root). A #583 deve partir daqui, não do zero.

### 6.5 Pergunta 5: detecção de capacidades

A ADR §8.1 exige que uma capacidade só seja reportada quando funciona de fato. Com o que foi medido,
dá para fazer a detecção barata e sob demanda:

| Capacidade | Teste de detecção | Custo |
| --- | --- | --- |
| `processMetrics` | Linux e uma leitura real de `/proc/<Deno.pid>/stat` sem erro, ou `ps` no PATH. **Não** use `Deno.permissions.querySync`: com `--allow-read=/proc` ele responde `granted` e a leitura falha com `NotCapable` (§4.3) | < 1 ms ou `command -v` |
| `processSupervision` | sempre `true` onde `Deno.Command` existe; `treeKill` só com `/proc`, `ps -s` ou scope | — |
| `resourceLimits` | `systemctl --user is-system-running` = `running` **e** `cpu memory` em `cgroup.subtree_control` do `user@<uid>.service` | 3 ms + leitura (com `-A`) ou `systemctl show` |
| `advancedTelemetry` | `false` até a #583 | — |
| `nativeAsyncIO` | `false` até a #584 | — |

## 7. Proposta preliminar de `SystemCapabilities`

**[Opinião]** Sem registro genérico e sem daemon (ADR §8.3). É uma função pura sobre fatos já
coletados, para que o teste não dependa do host, e o chamador decide quando coletá-los (uma vez por
sessão, sob demanda).

```ts
export interface SystemFacts {
  os: typeof Deno.build.os;
  procReadable: boolean;           // leitura real de /proc/<pid>/stat deu certo (exige -A no Deno 2.x)
  psPath: string | null;           // command -v ps
  systemdUser: boolean;            // systemctl --user is-system-running == running
  userCgroupControllers: string[]; // ex.: ["cpu", "memory", "pids"]
}

export interface SystemCapabilities {
  processMetrics: "proc" | "ps" | null;   // fonte de CPU/RSS por árvore
  processSupervision: boolean;            // lançar, aguardar, timeout
  treeKill: "proc" | "ps-session" | "scope" | null;
  resourceLimits: "systemd-scope" | null;
  advancedTelemetry: false;               // até a #583
  nativeAsyncIO: false;                   // até a #584
}

export function systemCapabilities(f: SystemFacts): SystemCapabilities {
  const scope = f.os === "linux" && f.systemdUser &&
    ["cpu", "memory"].every((c) => f.userCgroupControllers.includes(c));
  return {
    processMetrics: f.os === "linux" && f.procReadable ? "proc" : f.psPath ? "ps" : null,
    processSupervision: true,
    treeKill: scope ? "scope" : f.os === "linux" && f.procReadable ? "proc" : f.psPath ? "ps-session" : null,
    resourceLimits: scope ? "systemd-scope" : null,
    advancedTelemetry: false,
    nativeAsyncIO: false,
  };
}
```

O primeiro consumidor concreto é o executor de workers por processo apontado na #586 (lacuna P0).

## 8. Capacidades que o Deno não cobre de forma adequada (entrada da #585)

| # | Lacuna | Plataforma | Alternativa sem Rust | Rust ajudaria? |
| --- | --- | --- | --- | --- |
| L1 | Ler `/proc` e `/sys` sem `--allow-all` | Linux | executáveis (`ps`, `systemctl show`) em `--allow-run` | Não: um binário Rust também precisaria de `--allow-run` para ser chamado |
| L2 | `Deno.kill` restrito a binários listados | todas | nenhuma; é regra do Deno | Não |
| L3 | Limite de recurso sem systemd | Linux sem systemd, macOS | nenhuma sem privilégio | Não no macOS (não há mecanismo sem privilégio); talvez no Linux com cgroup delegado manualmente, caso raro |
| L4 | Job Objects (limite e encerramento da árvore) | Windows | PowerShell ou `taskkill /T` (**[Não verificado]**) | **Sim, candidato**: Job Objects exigem API Win32 que o Deno não expõe. Só vale se houver usuário Windows com essa necessidade |
| L5 | Árvore de processos no macOS e Windows sem `exec` por amostra | macOS, Windows | `ps` a ~11 ms por amostra | Marginal: 11 ms por amostra a uma taxa limitada (ex.: 1 Hz) é desprezível |
| L6 | Eventos de processo (fork, exec, exit) em vez de amostragem | Linux | nenhuma no Deno | Só com eBPF ou netlink (escopo da #583) |

## 9. Opções avaliadas

| Opção | Descrição | Avaliação |
| --- | --- | --- |
| A. Só Deno + `/proc` | supervisor lê `/proc` com `-A` | Mais rápido (0,24 ms), mas só Linux, e o kill por grupo é insuficiente; precisa percorrer a árvore |
| B. Deno + executáveis do SO | `ps`, `systemd-run`, `systemctl`, `taskkill` por `Deno.Command` | Cabe em `--allow-run`, cobre limite e encerramento no Linux; custo de ms por chamada |
| C. Binário nativo próprio | Rust via IPC | Nenhuma lacuna de Linux exige; candidato só para Windows (L4) |
| **D. B com A como otimização** | executáveis como caminho portátil; `/proc` quando `-A` e Linux | **Recomendada** |

## 10. Recomendação

**[Opinião]**

1. **Não há caso para Rust a partir desta linha de base** no Linux e no macOS. A #585 deve tratar só a
   L4 (Job Objects no Windows), e só se houver demanda real de usuário Windows.
2. **Supervisor de worker em Deno (opção D):** lançar com `detached: true`; no Linux com systemd,
   preferir `systemd-run --user --scope` para ter limite e encerramento garantidos; sem systemd,
   percorrer a árvore pelo `/proc` (com `-A`) ou por `ps -s <sid>`. **Nunca confiar só em
   `kill(-pgid)`.**
3. **Toda supervisão encerra a árvore explicitamente**, porque os filhos sobrevivem à saída do Deno.
4. **Adotar a `SystemCapabilities` do §7** só junto com o primeiro consumidor (o executor da #586),
   como manda a ADR §8.3.
5. **A #583 parte do §6.4:** cgroups v2 sem root já funcionam por `systemd-run --user --scope` neste
   host. Ela precisa medir só o que falta (eventos por eBPF, coleta compartilhada entre sessões).
6. **A #584 deve medir o I/O dos fluxos** antes de tudo; nada aqui sugere gargalo de I/O.

A decisão continua humana: este spike não altera código de produto nem cria issues de follow-up.
