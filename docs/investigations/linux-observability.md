# Investigação: observabilidade no Linux com cgroups v2 e eBPF para workers

**Issue:** #583 — spike(system): observabilidade no Linux com cgroups v2 e eBPF para workers
**Data:** 2026-11-09
**Base:** `master` em `f6ab98f`
**Contexto:** ADR-001, INV-006 (P2), §9.1, §10 e §11. Parte da linha de base da #582
(`docs/investigations/deno-system-apis.md`), cujas medições não são repetidas aqui.

**Rótulos:** **[Fato]** medido neste host ou lido na configuração dele · **[Inferência]** ·
**[Opinião]** · **[Não verificado]**.

---

## 1. Pergunta

Com vários agentes rodando ao mesmo tempo, o Vetor não sabe quanto CPU, memória e I/O cada worker
consome, nem consegue limitar um worker descontrolado.

1. Quais métricas não estão disponíveis pelas APIs levantadas na #582?
2. cgroups v2 sem root (`systemd-run --user --scope`) bastam para limitar e medir um worker e seus
   filhos?
3. Quais permissões o eBPF exige, e isso é aceitável para um plugin de desenvolvimento?
4. A coleta pode ser compartilhada entre sessões, sem um coletor por worktree?
5. Qual o custo de CPU e memória com taxa de amostragem limitada?
6. Se Rust for necessário, quais bibliotecas servem?

## 2. Ambiente

| Item | Valor |
| --- | --- |
| Host | o mesmo da #582: Omarchy (Arch), kernel 7.2.15, 12 CPUs, 16 GB, Deno 2.9.8, systemd 262 |
| Controladores delegados ao usuário (`user@1000.service/cgroup.subtree_control`) | `cpu memory pids` (**sem `io`**) |
| `app.slice/cgroup.subtree_control` | `memory pids` |
| PSI | `CONFIG_PSI=y`; `cpu.pressure`, `memory.pressure` e `io.pressure` por cgroup |
| eBPF | `CONFIG_BPF_SYSCALL=y`, `CONFIG_BPF_JIT=y`, `CONFIG_DEBUG_INFO_BTF=y` (`/sys/kernel/btf/vmlinux` presente) |
| Restrições | `kernel.unprivileged_bpf_disabled=2`, `kernel.perf_event_paranoid=2`; capacidades do processo: `CapEff=0` |
| Ferramentas | sem `bpftool` nem `bpftrace`; `capsh` e `setcap` presentes |

## 3. Resumo

- **[Fato]** `systemd-run --user --scope` **basta** para limitar e medir um worker com todos os
  filhos, sem root. Um worker que tentou alocar ~200 MiB com `MemoryMax=64M` foi morto pelo kernel em
  ~340 ms (SIGKILL, exit 137), e o systemd registrou `Result=oom-kill` e `MemoryPeak=67108864`.
- **[Fato]** **Um coletor único e sob demanda** lê todos os scopes `vetor-*` do usuário numa passada:
  **~1 ms por amostra com 1 worker e ~2,1 ms com 10**. A 1 Hz custa **0,1–0,3 % de CPU**; a 10 Hz,
  1,2–2,4 %. O RSS é ~73 MiB, quase todo do próprio Deno (~55 MiB, #582).
- **[Fato]** A atribuição fica no metadado da unit (`--unit=vetor-…` e `--description="vetor
  dispatch=… issue=…"`), e não no nome do diretório, como pede a ADR §10.1.
- **[Fato]** **I/O por worker não sai do cgroup** neste host: o controlador `io` não está delegado ao
  usuário (`io.stat` não existe no scope). O que existe sem root é `io.pressure` por scope e
  `/proc/<pid>/io` por processo do próprio usuário.
- **[Fato]** **eBPF exige root** aqui: `unprivileged_bpf_disabled=2` bloqueia BPF sem privilégio, e o
  processo não tem capacidade nenhuma. Programas de tracing pedem `CAP_BPF` e `CAP_PERFMON`, ou seja,
  root ou um binário com `setcap`.
- **[Opinião]** **Recomendação: cgroups v2 por `systemd-run`, sem eBPF e sem Rust.** O eBPF só
  acrescentaria eventos (exec, exit, I/O e rede por processo), não justifica um componente privilegiado
  num plugin de desenvolvimento e fica descartado até haver um caso concreto.

## 4. Evidências

### 4.1 Protótipo

`docs/investigations/linux-observability/scope-collector.ts` (fora de `scripts/`, então fora de
test/lint/check). Ele:

1. lança workers sintéticos (laço de CPU e `sleep`, ou um alocador em Python) cada um num scope
   `vetor-obs-<pid>-<n>.scope`, com `--description` de atribuição e limites (`MemoryMax`,
   `TasksMax`, `CPUQuota`);
2. roda um coletor que percorre `/sys/fs/cgroup/user.slice/user-<uid>.slice/user@<uid>.service`,
   acha os scopes do prefixo e lê `cpu.stat`, `memory.current`, `memory.peak`, `memory.max`,
   `memory.events`, `pids.current`, `cpu.pressure`, `memory.pressure` e `io.stat`;
3. mede o custo por amostra e a CPU do coletor com 1, 5 e 10 workers, à taxa pedida;
4. num `finally`, para (`systemctl --user stop`) e limpa (`reset-failed`) toda unit criada.

Cada worker tem `timeout 60`, e nada fica rodando depois (§4.5).

```sh
deno run -A docs/investigations/linux-observability/scope-collector.ts --hz 1 --seconds 10
deno run -A docs/investigations/linux-observability/scope-collector.ts --hz 10 --seconds 10
```

### 4.2 Atribuição e métricas de um scope (1 Hz)

```json
"attribution": { "unit": "vetor-obs-671662-w1.scope",
                 "description": "vetor dispatch=ctx_demo1 issue=583 worktree=/tmp/x" },
"oneScope": { "cpuUsec": 1501894, "memCurrent": 1687552, "memPeak": 2564096, "memMax": 268435456,
  "memEvents": { "low": 0, "high": 0, "max": 0, "oom": 0, "oom_kill": 0, "oom_group_kill": 0, "sock_throttled": 0 },
  "pids": 4, "cpuPressure10": 0, "memPressure10": 0, "ioStat": "indisponível: NotFound" }
```

### 4.3 Limite de memória (OOM)

```json
"oom": { "exitCode": 137, "signal": "SIGKILL", "ms": 340, "unitAfter": "failed",
         "systemd": { "Result": "oom-kill", "MemoryPeak": "67108864" } }
```

**[Fato]** O cgroup do scope some quando a unit falha, então `memory.events` não pode ser lido depois.
O desfecho fica no systemd até o `reset-failed` (`systemctl --user show -p Result -p MemoryPeak`).
Sem o `reset-failed`, a unit continua listada como `failed`: a primeira versão do protótipo deixou
uma assim, e foi o que motivou a limpeza no `finally`.

### 4.4 Custo do coletor

| Taxa | Workers | Amostra p50 | Amostra p95 | CPU do coletor | RSS do coletor |
| --- | --- | --- | --- | --- | --- |
| 1 Hz | 1 | 0,996 ms | 1,216 ms | 0,1 % | 72,7 MiB |
| 1 Hz | 5 | 1,631 ms | 2,168 ms | 0,2 % | 72,7 MiB |
| 1 Hz | 10 | 2,095 ms | 2,656 ms | 0,3 % | 73,0 MiB |
| 10 Hz | 1 | 0,897 ms | 1,176 ms | 1,2 % | 78,3 MiB |
| 10 Hz | 5 | 1,481 ms | 1,813 ms | 1,7 % | 83,1 MiB |
| 10 Hz | 10 | 2,135 ms | 2,982 ms | 2,4 % | 84,4 MiB |

A CPU do coletor vem de `utime + stime` de `/proc/self/stat`, com resolução de 10 ms (`CLK_TCK=100`);
a 1 Hz, os valores ficam perto dessa resolução. A primeira rodada a 1 Hz deu números equivalentes
(0,96 / 1,58 / 2,23 ms; 0,1–0,2 %).

### 4.5 Limpeza verificada

Depois de cada rodada: `systemctl --user list-units 'vetor-obs-*' --all` → 0 units, e nenhum processo
do worker sintético vivo (`ps`).

### 4.6 Scopes que o Orca já cria

**[Fato]** Este terminal roda em
`…/orca_ptys_orca_daemon_d9b0…slice/orca_pty_orca_daemon_d9b0…_2.scope`, criado por `systemd-run` (a
`Description` é a linha de comando do shell). O slice do Orca habilita `memory pids`, e o scope expõe
`memory.current/peak/events/stat`, `pids.current/peak/events`, `cpu.stat` e os três `*.pressure`.
No momento da leitura: `memory.current=702218240`, `pids.current=68`.

**[Inferência]** Os workers do Orca já estão isolados em scopes por terminal. Só que a `Description`
não traz o handle do terminal, então ligar um desses scopes a um Dispatch exigiria cruzar PIDs com
`ORCA_TERMINAL_HANDLE` em `/proc/<pid>/environ`. Além disso, relançar o worker num scope `vetor-*`
o tira do scope do terminal (o `systemd-run --scope` coloca o processo em `app.slice`, #582 §4.2), e
aí fechar o terminal no Orca deixa de matar o worker.

### 4.7 I/O

```text
/proc/self/io           → rchar: 2884  wchar: 0 ...          (legível)
/proc/<bash do usuário>/io → rchar: 1953448  wchar: 653 ...  (legível)
/proc/1/io              → Permissão negada                    (processo de root)
io.stat no scope        → NotFound                            (controlador io não delegado)
```

## 5. Respostas

### 5.1 Pergunta 1: métricas que faltam nas APIs da #582

| Métrica | Pela #582 (`/proc`, `ps`) | Pelo cgroup do scope | Só com eBPF |
| --- | --- | --- | --- |
| CPU da árvore | ✅ soma por processo (perde filhos que já saíram) | ✅ `cpu.stat` inclui tudo que passou pelo scope | — |
| Memória | ⚠️ RSS conta páginas compartilhadas várias vezes | ✅ `memory.current`, memória cobrada de fato | — |
| Pico de memória | ❌ | ✅ `memory.peak` (e `MemoryPeak` após o fim) | — |
| OOM e estouro de limite | ❌ | ✅ `memory.events`, `Result=oom-kill` | — |
| Throttling de CPU | ❌ | ⚠️ `cpu.stat nr_throttled` só com o controlador `cpu` habilitado no slice (não está no `app.slice`) | — |
| Pressão (PSI) | ⚠️ só do host (`/proc/pressure/*`) | ✅ por scope | — |
| Número de tarefas | ✅ tamanho da árvore | ✅ `pids.current`, com limite `TasksMax` | — |
| I/O em bytes | ⚠️ `/proc/<pid>/io` por processo vivo | ❌ sem o controlador `io` delegado | ✅ |
| Processos de vida curta, exec e exit | ❌ a amostragem perde | ❌ | ✅ |
| Rede por processo | ❌ | ❌ | ✅ |

### 5.2 Pergunta 2: `systemd-run --user --scope` sem root

**Sim**, para CPU (cota e uso), memória (limite, uso, pico, OOM) e tarefas. **Não** para I/O, que
depende de o administrador delegar o controlador `io` ao `user@.service` (configuração de root, fora do
alcance de um plugin). A #582 já mostrou que o scope encerra a árvore inteira em ~70 ms, inclusive os
processos que trocam de grupo.

Requisito do host: Linux com systemd e sessão de usuário ativa (`systemctl --user is-system-running`).
Não existe em containers sem systemd, em WSL sem systemd nem em macOS e Windows. Nesses casos vale o
fallback da #582 (`/proc` ou `ps`, sem limites).

### 5.3 Pergunta 3: permissões do eBPF

**[Fato]** Neste host, `kernel.unprivileged_bpf_disabled=2` (BPF sem privilégio desligado; só o
administrador muda) e o processo roda com `CapEff=0`. **[Não verificado]**, pela documentação do kernel:
desde o 5.8, carregar programas de tracing exige `CAP_BPF` mais `CAP_PERFMON` (ou `CAP_SYS_ADMIN`), e
anexá-los a eventos de perf também esbarra no `perf_event_paranoid=2`.

**[Opinião]** Não é aceitável para um plugin de desenvolvimento:

- exigiria `sudo` a cada coleta ou um binário com `setcap cap_bpf,cap_perfmon+ep`, que qualquer
  processo do usuário poderia executar (escalada de privilégio para tracing do host inteiro);
- a ADR §11 pede "No unnecessary elevated permissions" e "No implicit privilege escalation";
- o ganho (eventos de exec e exit, I/O e rede por processo) não tem consumidor hoje.

### 5.4 Pergunta 4: coleta compartilhada

**Sim.** Um único processo lê todos os scopes do usuário pelo prefixo, e a hierarquia do cgroup já
separa os workers de todas as sessões. Não precisa de coletor por worktree nem de daemon: o coletor
roda quando alguém pede (por exemplo, `vetor-status.sh` ou o monitoramento do coordinator) e sai.

### 5.5 Pergunta 5: custo

A 1 Hz, abaixo de 0,3 % de uma CPU e ~2 ms por amostra com 10 workers (§4.4). O custo cresce com o
número de scopes (~0,13 ms por scope) e quase não depende da taxa por amostra; a CPU total é linear na
taxa.

### 5.6 Pergunta 6: Rust

Não é necessário para nada recomendado aqui: tudo é leitura de arquivo e chamadas a `systemd-run` e
`systemctl`, que o Deno faz. Para referência futura, se o eBPF voltar com um caso concreto: `aya`
(eBPF em Rust puro, CO-RE com o BTF do kernel), `libbpf-rs` (bindings da libbpf) e `cgroups-rs`
(manipulação de cgroups, desnecessária com o systemd). **[Não verificado]**: nenhuma foi compilada.

## 6. Revisão de segurança (ADR §11)

| Item | cgroups v2 por `systemd-run --user` | eBPF |
| --- | --- | --- |
| Privilégio | nenhum; usa a delegação que o systemd já dá ao usuário | root ou `CAP_BPF` + `CAP_PERFMON` |
| Escopo | só os processos que o Vetor lançou | o kernel inteiro (pode observar processos de outros usuários) |
| Mudança no host | nenhuma; a unit some no `stop` e no `reset-failed` | carregar programas no kernel |
| Falha | `systemd-run` falha → worker roda sem scope (fallback da #582), com aviso | — |
| Entrada externa | nome da unit e `Description` vêm do Vetor; validar contra `[A-Za-z0-9._-]` antes de passar ao `systemd-run` | — |
| Limites do coletor | uma passada por chamada, taxa limitada pelo chamador, sem processo residente | — |

## 7. Opções avaliadas

| Opção | Avaliação |
| --- | --- |
| **A. cgroups v2 por `systemd-run --user --scope`** | **Recomendada.** Limite, medição e encerramento sem root; custo desprezível a 1 Hz. Só Linux com systemd |
| B. eBPF | Root ou `setcap`; eventos sem consumidor; descartada até haver caso concreto |
| C. A + eBPF opcional | Mantém um caminho privilegiado sem demanda; descartada pelo mesmo motivo |
| D. Nenhum | Perde o limite de memória e a contabilidade correta, que resolvem o "worker descontrolado" do enunciado |
| E. Reaproveitar os scopes do Orca | Útil quando o worker é do Orca; atribuição por PID é frágil (§4.6). Fica como integração da #588, não como mecanismo geral |

## 8. Recomendação

**[Opinião]**

1. **cgroups v2, sem eBPF e sem Rust.** Quando o executor de workers da #586 existir, ele lança cada
   worker com `systemd-run --user --scope --unit=vetor-<dispatch>.scope
   --description="vetor dispatch=<id> issue=<n> worktree=<path>"` e limites configuráveis
   (`MemoryMax`, `TasksMax`; `CPUQuota` opcional), e para com `systemctl --user stop` mais
   `reset-failed`.
2. **Coletor sob demanda**, sem daemon: uma função que lê os scopes `vetor-*` e devolve CPU, memória,
   pico, eventos de OOM, tarefas e PSI. Chamada pelo monitoramento do coordinator, a no máximo 1 Hz.
3. **Nada por padrão:** o scope e os limites ficam atrás de uma opção de config (ex.:
   `workers.resourceLimits`), desligada por padrão, e só valem com `resourceLimits: "systemd-scope"`
   detectado (#582 §7). Sem systemd, o worker roda como hoje.
4. **I/O fica fora** até haver demanda: exige configuração de root (delegar `io`). `io.pressure` por
   scope e `/proc/<pid>/io` cobrem um diagnóstico grosseiro.
5. **eBPF descartado**, pelo motivo do §5.3. Reabrir só com um consumidor concreto que precise de
   eventos e com revisão de segurança própria.
6. **Workers do Orca:** não relançar dentro de um scope `vetor-*` (fechar o terminal deixaria de
   matá-los). Ler o scope do próprio terminal do Orca, se a atribuição por handle ficar disponível.

A decisão continua humana: este spike não altera código de produto nem cria issues de follow-up.
