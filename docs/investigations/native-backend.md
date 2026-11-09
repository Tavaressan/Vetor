# Investigação: viabilidade de um backend nativo opcional em Rust

**Issue:** #585 — spike(native): viabilidade de um backend nativo opcional em Rust
**Data:** 2026-11-09
**Base:** `master` em `90d819f` (v1.4.0)
**Contexto:** ADR-001, INV-005 (P2), §9, §10.2 e Fase 3. Depende da #582, da #583 e da #584, cujos
relatórios são as entradas daqui:
`docs/investigations/deno-system-apis.md`, `linux-observability.md` e `native-io.md`.

**Rótulos:** **[Fato]** medido neste host ou lido na fonte citada · **[Inferência]** · **[Opinião]** ·
**[Não verificado]**.

---

## 1. Pergunta

1. Quais capacidades não podem ser implementadas de forma adequada em Deno, segundo a #582, a #583 e a
   #584?
2. Qual o custo esperado de manutenção (toolchain, CI, revisão em duas linguagens)?
3. Como distribuir binários para Linux, macOS e Windows pelo instalador (`cli/`) e pelos harnesses, sem
   tornar o binário obrigatório?
4. Qual mecanismo de IPC tem o melhor custo-benefício?
5. Ciclo de vida: inicialização sob demanda, reuso entre sessões e encerramento explícito, sem daemon.
6. Um backend nativo é necessário?

## 2. Resumo

- **[Fato]** **Nenhuma capacidade levantada exige Rust.** Das seis lacunas da #582 §8, quatro não se
  resolvem com Rust, a do macOS tem custo desprezível em Deno, e a única candidata (Job Objects no
  Windows) pode ser feita pela **FFI do próprio Deno**. A #583 resolveu limites e métricas com
  `systemd-run` e descartou o eBPF, e a #584 mostrou que I/O não é gargalo.
- **[Fato]** **A FFI do Deno 2.9.8 é estável**: `Deno.dlopen` funcionou sem flag instável, exige só
  `--allow-ffi`, abre a `libc` em 0,47 ms e custa 0,39 µs por chamada. Com ela, o
  `prctl(PR_SET_CHILD_SUBREAPER)` fez o próprio Deno herdar os netos órfãos de um worker, o problema
  visto na #582 §4.2, sem binário nenhum.
- **[Fato]** O custo de adotar Rust é desproporcional ao que o Vetor tem hoje: o CI é um job
  `ubuntu-latest` de ~50 s, sem macOS nem Windows, e não há toolchain Rust instalada neste host.
  Distribuir binário por npm ou por download tem falhas documentadas, e o `bin/` de plugin é exclusivo
  do Claude Code.
- **[Fato]** O IPC mais barato medido é **JSON-RPC por stdio** (#584 §4.3): ~23 ms para subir e
  dezenas de µs por mensagem pequena. O Unix Domain Socket foi mais lento em todos os tamanhos.
- **[Opinião]** **Recomendação: não adotar** um backend nativo em Rust. Usar a FFI do Deno, atrás de
  detecção de capacidade, para o único caso de API de sistema que o Deno não expõe. Sem protótipo
  Rust, porque o critério de aceite só o pede se houver adoção.

## 3. Pergunta 1: o que o Deno não cobre

Consolidação das lacunas das três investigações anteriores.

| # | Lacuna | Origem | Rust resolve? | Alternativa sem binário próprio |
| --- | --- | --- | --- | --- |
| L1 | Ler `/proc` e `/sys` exige `--allow-all` | #582 §4.3 | Não: chamar o binário também exige `--allow-run` | Executáveis do SO (`ps`, `systemctl show`) ou `-A`, que os hooks já usam |
| L2 | `Deno.kill` exige `--allow-run` sem lista | #582 §4.3 | Não: é regra de permissão do Deno | — |
| L3 | Limite de recurso sem systemd (macOS, containers) | #582 §8, #583 §5.2 | Não no macOS: não há mecanismo sem privilégio | Nenhuma; fica sem limite, com fallback documentado |
| L4 | Job Objects no Windows (limite e encerramento da árvore) | #582 §8 | Sim | **FFI do Deno sobre a `kernel32.dll`** (§4) |
| L5 | Árvore de processos no macOS e no Windows sem `exec` por amostra | #582 §8 | Marginal | `ps` a ~11 ms por amostra; desprezível a 1 Hz |
| L6 | Eventos de processo (exec, exit) e I/O por processo | #582 §8, #583 §5.1 | Só com eBPF | eBPF descartado na #583 (exige root) |
| — | Limitar e medir workers no Linux | #583 | Não necessário | `systemd-run --user --scope` |
| — | I/O nativo (io_uring) | #584 | Não necessário | I/O não é gargalo; o Deno lê o repositório em 3 ms |
| — | Herdar netos órfãos de um worker | #582 §4.2 | Sim | **FFI**: `prctl(PR_SET_CHILD_SUBREAPER)` (§4.1) |

## 4. FFI do Deno como alternativa

### 4.1 Sonda no Linux

`docs/investigations/native-backend/ffi-probe.ts` abre a `libc.so.6` com `Deno.dlopen` e chama
`getpid`, `getpgid` e `prctl`. Depois lança um `bash` que cria um neto e sai na hora, e confere quem
herdou o neto órfão.

```text
$ deno run --allow-run docs/investigations/native-backend/ffi-probe.ts
NotCapable: Requires ffi access to ...

$ deno run --allow-ffi --allow-run docs/investigations/native-backend/ffi-probe.ts
{ "deno": "2.9.8", "dlopenMs": 0.47, "ffiCallUs": 0.385, "pid": 1194918, "pgid": 1194917,
  "prctlGetResult": 0, "subreaperBefore": 0, "prctlSetResult": 0,
  "grandchild": 1194930, "grandchildPpidAfterOrphaned": 1194918, "reparentedToThisProcess": true }
```

**[Fato]**
- A FFI não precisou de `--unstable-ffi`. Sem `--allow-ffi`, a chamada falha com `NotCapable`.
- O custo é desprezível: 0,47 ms para abrir a biblioteca e 0,39 µs por chamada.
- Com o subreaper ligado, o neto órfão passou a ser filho do Deno (PID 1194918). Na #582, os órfãos
  iam para o `systemd --user` e sobreviviam ao supervisor.

### 4.2 Windows: Job Objects pela FFI

**[Não verificado]** em host Windows: não há um nesta investigação. O que segue vem da documentação da
Win32 e da do Deno, conferida em busca própria a partir do rascunho delegado ao OpenCode.

| Passo | API Win32 (`kernel32.dll`) | Pela FFI do Deno |
| --- | --- | --- |
| Criar o job | `CreateJobObjectW` | `Deno.dlopen("kernel32.dll", …)` |
| Limites e encerramento da árvore | `SetInformationJobObject` com `JOBOBJECT_EXTENDED_LIMIT_INFORMATION` (`JobMemoryLimit`, `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) e `JOBOBJECT_CPU_RATE_CONTROL_INFORMATION` (teto de CPU, Windows 8+) | structs montadas num `ArrayBuffer`, passadas por ponteiro |
| Colocar o worker no job | `OpenProcess(pid)` com `PROCESS_SET_QUOTA` e `PROCESS_TERMINATE`, depois `AssignProcessToJobObject` | o `Deno.ChildProcess` só expõe `pid`, sem handle, então o `OpenProcess` também passa pela FFI |
| Matar a árvore | `TerminateJobObject`, ou fechar o último handle com `KILL_ON_JOB_CLOSE` | uma chamada |
| Medir | `QueryInformationJobObject` com `JobObjectBasicAccountingInformation` (`TotalUserTime`, `TotalKernelTime`, `ActiveProcesses`) | uma chamada |

**Corrida na criação.** A atribuição depois do `spawn` deixa uma janela em que o worker pode criar
filhos ainda fora do job. O padrão clássico (criar suspenso, atribuir, retomar) e o atributo
`PROC_THREAD_ATTRIBUTE_JOB_LIST` (Windows 10+, que atribui antes de a primeira thread rodar) exigem
controlar o `CreateProcess`. O `Deno.Command` não expõe flags de criação nem lista de atributos.

**[Inferência]** A saída sem binário próprio é usar a herança: um processo filho nasce no job do pai.
O supervisor se coloca num job com `KILL_ON_JOB_CLOSE` **antes** de lançar os workers. Assim, todo
worker e todo neto nascem dentro dele, sem janela, e morrem quando o supervisor fecha o handle ou
morre. Para limites por worker, um job aninhado por worker (Windows 8+) atribuído depois do `spawn`.
Aí a janela só afeta a atribuição do limite, não o encerramento, que o job do supervisor já garante.
Validar num host Windows antes de implementar.

### 4.3 Custo da FFI em segurança

**[Fato]** Pela documentação de FFI do Deno, uma biblioteca nativa carregada roda fora das checagens
de permissão da camada JavaScript. **[Inferência]** Na prática, `--allow-ffi` concede tanto quanto
`--allow-all`. Isso não muda a postura do Vetor, porque hooks e scripts já rodam com `deno run -A`
(#582 §6.3). Para não espalhar a superfície, a FFI deve ficar num único módulo, carregado só quando a
capacidade for pedida, e só chamar bibliotecas do sistema (`libc`, `kernel32`), nunca uma biblioteca
baixada.

## 5. Pergunta 2: custo de manutenção

| Item | Hoje | Com um backend Rust |
| --- | --- | --- |
| Linguagens | TypeScript (Deno) e JavaScript (CLI em Node) | mais Rust |
| Toolchain local | Deno; Node para a CLI | mais `rustup`/`cargo`. Não está instalado neste host (`mise`: "No version is set for shim: cargo") |
| CI | `ci.yml`: um job `ubuntu-latest` (~50 s nas 5 últimas execuções) | matriz de build para no mínimo 5 alvos (Linux x64/arm64, macOS x64/arm64, Windows x64), testes em cada SO e um job de release com os artefatos |
| Testes cross-platform | não há runner macOS nem Windows | obrigatórios, porque o motivo do binário seria justamente o comportamento por SO |
| Revisão | um revisor de TypeScript basta | revisor de Rust e de código `unsafe` de FFI do lado nativo |
| Release | `version` em 4 manifestos e a tag (`wiki/Desenvolvimento.md`) | mais binários assinados ou com checksum por alvo e por versão |

**[Inferência]** Só a matriz de CI multiplica o tempo e a superfície de manutenção várias vezes, para um
ganho que a FFI entrega sem build.

## 6. Pergunta 3: distribuição

| Canal | Como funcionaria | Problema |
| --- | --- | --- |
| npm, pacotes por plataforma (`optionalDependencies` com `os`/`cpu`, como o esbuild) | a CLI `@tavaressan/vetor` declararia `@tavaressan/vetor-native-<os>-<cpu>` | Falhas documentadas: `--no-optional`/`--ignore-optional` deixam o binário de fora; lockfile gerado em outro SO omite o pacote da plataforma (npm/cli#4828); regressões do npm 11 com entradas sem versão e no `npm ci` (npm/cli#9343, #9362, #10115) |
| Download sob demanda do GitHub Releases, com checksum | a CLI ou o próprio script baixa o binário na primeira vez | Exige rede no primeiro uso, verificação de integridade e uma pasta de cache por usuário. No macOS, um binário baixado com `curl` não recebe `com.apple.quarantine`, então o Gatekeeper não o barra; **[Não verificado]**: o binário arm64 ainda precisa de assinatura ad-hoc para executar |
| Plugin copiado do git (Claude Code, OpenCode, Antigravity) | binários versionados no repositório | Infla o repositório com 5 binários por versão. O `bin/` de plugin que entra no PATH é recurso do Claude Code (2.1.91+, segundo guias de terceiros), e a memória do projeto proíbe depender dele nos outros harnesses |

**[Fato]** O CLI de hoje (`cli/package.json`) não tem `postinstall`, `optionalDependencies` nem
binário nativo: publica só `bin/`, `lib/` e `templates/`. Qualquer canal acima seria infraestrutura nova.

## 7. Pergunta 4: IPC

Medido na #584 §4.3, com um filho em Deno (o lado do Deno, que é o que o núcleo paga, não muda com um
filho em Rust):

| Transporte | Início | 100 B | 10 KB | 1 MB |
| --- | ---: | ---: | ---: | ---: |
| stdio, JSON por linha | 23,1 ms | 0,046 ms | 0,070 ms | 6,98 ms |
| Unix Domain Socket | 48,7 ms | 0,119 ms | 0,092 ms | 7,71 ms |
| FFI no mesmo processo (esta investigação) | 0,47 ms | 0,000385 ms por chamada | — | — |

**[Fato]** Para um backend em processo separado, o stdio ganha em todos os tamanhos e não precisa de
caminho de socket nem de named pipe por plataforma. **[Inferência]** A FFI dispensa processo e
serialização: é cerca de 100 vezes mais barata por chamada que o stdio para mensagens pequenas.

## 8. Pergunta 5: ciclo de vida

| Requisito da ADR §9.4 | Backend Rust por stdio | FFI do Deno |
| --- | --- | --- |
| Opcional | processo só existe se o binário estiver instalado | `dlopen` só quando a capacidade é pedida |
| Inicialização sob demanda | sobe no primeiro pedido (~23 ms medidos com filho Deno; menos com Rust) | 0,47 ms no primeiro pedido |
| Reuso entre sessões | exigiria um processo que sobrevive à sessão, ou seja, um daemon, que a ADR proíbe sem requisito | não se aplica: vive no processo que o usa |
| Encerramento explícito | fechar o stdin; o filho sai no EOF. Se o pai morre, o EOF também chega | `lib.close()`; acaba com o processo |
| Independente do worktree | sim | sim |

**[Inferência]** "Reuso entre sessões" e "sem daemon" puxam em direções opostas para um processo
separado. A FFI não tem esse conflito.

## 9. Opções avaliadas

| Opção | Avaliação |
| --- | --- |
| A. Backend Rust opcional por stdio | Nenhuma lacuna exige; custo de CI, distribuição e revisão desproporcional (§5, §6) |
| B. Rust só para Windows (Job Objects) | Mesmo custo de distribuição para um alvo que não tem CI nem usuário conhecido; a FFI cobre (§4.2) |
| **C. FFI do Deno, atrás de detecção de capacidade** | **Recomendada.** Sem build, sem distribuição, custo de chamada desprezível; a permissão já está concedida aos scripts (`-A`) |
| D. Nada nativo | Perde o subreaper e os Job Objects. Os workers continuam sobrevivendo ao supervisor quando ele morre sem encerrar a árvore |

## 10. Recomendação

**[Opinião]**

1. **Não adotar Rust.** Registrar a decisão na ADR-001 como resposta da Fase 3: nenhum caso de uso
   concreto passou no critério do §9 ("capabilities that require direct operating system integration
   or demonstrate measurable technical advantages") que a FFI não atenda.
2. **FFI do Deno para as duas APIs de sistema que faltam**, num único módulo carregado sob demanda,
   quando o executor de workers da #586 existir:
   - Linux: `prctl(PR_SET_CHILD_SUBREAPER)` no supervisor, para herdar e encerrar netos órfãos;
   - Windows: Job Object com `KILL_ON_JOB_CLOSE` para cada worker (§4.2), validado num host Windows
     antes de entrar.
   Cada uma é reportada na `SystemCapabilities` da #582 §7 só quando a chamada funciona de fato.
3. **Reabrir a decisão sobre Rust só se** surgir um caso que a FFI não atenda (por exemplo, código
   nativo com estado complexo ou callbacks de alta frequência), medido contra a FFI e não contra o
   Deno puro.

O Vetor continua funcionando sem nada nativo em qualquer cenário: a FFI só entra quando a capacidade é
detectada, e o fallback é o comportamento atual.

A decisão continua humana: este spike não altera código de produto nem cria issues de follow-up.

## 11. Fontes

- Distribuição por npm:
  [npm/cli#4828](https://github.com/npm/cli/issues/4828),
  [npm/cli#9343](https://github.com/npm/cli/pull/9343),
  [npm/cli#9362](https://github.com/npm/cli/pull/9362),
  [npm/cli#10115](https://www.gitclear.com/open_repos/npm/cli/pull_requests/10709507),
  [esbuild#789](https://www.github.com/evanw/esbuild/issues/789),
  [instalador do esbuild](https://chromium.googlesource.com/devtools/devtools-frontend/+/0a3621c/node_modules/esbuild/install.js).
- macOS e `curl`:
  [Apple Discussions 256200611](https://discussions.apple.com/thread/256200611),
  [Apple Developer Forums 773755](https://developer.apple.com/forums/thread/773755),
  [commit do rclone](https://git.frostfs.info/KurlesHS/rclone/commit/d72f3e31c0a82bf49079a40f5b933096a7498d1d),
  [Unit 42](https://unit42.paloaltonetworks.com/?p=137110).
- `bin/` em plugins do Claude Code (guias de terceiros, não a referência oficial):
  [plugin directory layout](https://brewpirate.github.io/claude-code-docs/plugins/plugin-directory-layout/),
  [plugins reference](https://docs.claude.com/en/docs/claude-code/plugins-reference).

- Job Objects:
  [AssignProcessToJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject),
  [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects),
  [Nested jobs](https://learn.microsoft.com/en-us/windows/win32/procthread/nested-jobs),
  [TerminateJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-terminatejobobject),
  [JOBOBJECT_EXTENDED_LIMIT_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information),
  [UpdateProcThreadAttribute (PROC_THREAD_ATTRIBUTE_JOB_LIST)](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute),
  [Raymond Chen: "A more direct and mistake-free way of creating a process in a job object"](https://devblogs.microsoft.com/oldnewthing/20230209-00/?p=107812).
- Deno:
  [FFI](https://docs.deno.com/runtime/fundamentals/ffi/),
  [segurança](https://docs.deno.com/runtime/fundamentals/security),
  [`Deno.ChildProcess`](https://docs.deno.com/api/deno/~/Deno.ChildProcess),
  [`Deno.Command`](https://docs.deno.com/api/deno/~/Deno.Command).

A pesquisa de distribuição foi delegada ao Antigravity, que não produziu saída (permissão de comando
negada no modo headless); ela foi feita inline. A da §4.2 foi delegada ao OpenCode, que entregou um
rascunho, mas saiu com código 1 (uma busca cancelada no modo headless). Dele só entrou o que foi
conferido nas fontes acima. Uma frase atribuída à documentação do Deno ("equivalent to
`--allow-all`") não foi encontrada e ficou de fora.
