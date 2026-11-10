# Investigação: io_uring e I/O nativo para cargas do Vetor

**Issue:** #584 — spike(system): io_uring e I/O nativo para cargas do Vetor
**Data:** 2026-11-09
**Base:** `master` em `f6ab98f`
**Contexto:** ADR-001, INV-007 (P3), §9.1 e §10 ("No advanced I/O optimization without benchmarks").
Usa a linha de base da #582 (`docs/investigations/deno-system-apis.md`).

**Rótulos:** **[Fato]** medido neste host ou lido na fonte citada · **[Inferência]** · **[Opinião]** ·
**[Não verificado]**.

---

## 1. Pergunta

1. I/O é gargalo em algum fluxo do Vetor (preparação de worktree, varredura do repo map, leitura de
   status, testes)? Em qual, e quanto do tempo total?
2. O I/O assíncrono do Deno (tokio por baixo) já basta para esses casos?
3. Que carga justificaria um worker nativo, e qual seria o custo de IPC para trazer o resultado de
   volta?

## 2. Resumo

- **[Fato]** **I/O não é gargalo em nenhum fluxo medido.** O tempo parado esperando I/O (PSI do
  cgroup, `io.pressure some`) ficou entre **0 % e 0,07 %** do tempo de parede. A suíte de testes é
  limitada por CPU (25,1 s de parede para 28,6 s de CPU). Os fluxos mais lentos fora dela
  (`guardian-audit`, 2,3 s; `now-probe`, 0,8 s) gastam o tempo esperando outra coisa: a CPU deles
  cobre só 16 % e 25 % do tempo de parede, sem espera de disco.
- **[Fato]** **O Deno basta:** ler os 355 arquivos rastreados do repositório (4,32 MiB) leva
  **3,35 ms** (p50) com `Deno.readFile` em paralelo, menos que um `cat` externo dos mesmos arquivos
  (4,14 ms).
- **[Fato]** **Um worker nativo seria mais lento para trazer dados:** a ida e volta de 1 MB por
  JSON-RPC em stdio custa ~7 ms (p50), mais que ler o repositório inteiro dentro do próprio Deno.
- **[Fato]** O Deno não usa io_uring: as operações assíncronas de arquivo rodam num pool de threads
  bloqueantes (`spawn_blocking`). No ecossistema, o Node.js desligou o io_uring da libuv por padrão
  depois da CVE-2024-22017.
- **[Opinião]** **Recomendação: descartar io_uring e qualquer worker de I/O nativo.** Reabrir só com o
  dado do §8.

## 3. Ambiente

O mesmo host da #582 e da #583: kernel 7.2.15, 12 CPUs, 16 GB, Deno 2.9.8. O repositório fica num SSD
(`/home` em LVM/LUKS sobre `sdb`, não rotacional). `kernel.io_uring_disabled=0`.

**Limites das medições:**
- O cache de página estava quente. Esvaziá-lo (`echo 3 > /proc/sys/vm/drop_caches`) exige root e
  não foi feito. Por isso, os números valem para o caso comum de um repositório em uso, não para a
  primeira leitura depois de um boot.
- A carga do host variava. O load average era 5,4–6,7 durante os microbenchmarks, que rodaram
  junto com um agente de pesquisa delegado. O perfil dos fluxos rodou em outro momento. Os números
  servem para comparar ordens de grandeza, não frações de milissegundo.
- O repositório do Vetor é pequeno (355 arquivos, 5,1 MiB fora do `.git`). O §7 discute
  repositórios maiores.

## 4. Evidências

### 4.1 Perfil dos fluxos (pergunta 1)

`docs/investigations/native-io/io-profile.ts` roda cada fluxo num scope próprio do systemd do usuário
e lê do cgroup, ao terminar, a CPU (`cpu.stat`), o tempo parado esperando I/O (`io.pressure`, linha
`some`) e o pico de memória. Cada fluxo rodou 3 vezes; a tabela traz as medianas. A saída bruta está em
`docs/investigations/native-io/io-profile-2026-11-09.json`.

```sh
deno run -A docs/investigations/native-io/io-profile.ts --runs 3
```

| Fluxo | Parede | CPU | Espera de I/O | % da parede | Pico de memória |
| --- | ---: | ---: | ---: | ---: | ---: |
| `git worktree add` | 57,4 ms | 24,7 ms | 0 ms | 0 % | 8,8 MiB |
| `prepare-worktree --path` (projeto Deno) | 55,3 ms | 24,2 ms | 0 ms | 0 % | 14,2 MiB |
| `repo-map` sem cache | 418,0 ms | 711,2 ms | 0,3 ms | 0,07 % | 126,8 MiB |
| `repo-map` com cache | 76,9 ms | 63,4 ms | 0 ms | 0 % | 35,0 MiB |
| `vetor-status.sh` | 55,6 ms | 40,5 ms | 0 ms | 0 % | 6,0 MiB |
| `guardian-audit` | 2 288,6 ms | 368,0 ms | 0 ms | 0 % | 44,9 MiB |
| `now-probe` | 820,1 ms | 202,7 ms | 0 ms | 0 % | 44,6 MiB |
| `deno task test` | 25 117,3 ms | 28 594,7 ms | 11,3 ms | 0,04 % | 329,6 MiB |

**[Fato]** O `guardian-audit` saiu com 1 nas três rodadas, o que pelo contrato do script significa
"achados", não falha. Os outros fluxos saíram com 0.

**[Inferência]**
- O `repo-map` sem cache e a suíte têm mais CPU que tempo de parede: usam mais de um núcleo e são
  limitados por CPU (o parse de AST do `repo-map`; a execução dos testes).
- O `guardian-audit` e o `now-probe` passam 75 % a 84 % do tempo sem usar CPU e sem esperar disco.
  O tempo vai para subprocessos e rede (`gh`, `git`, `docker`), que é onde uma otimização teria
  efeito, não no I/O de arquivo.

### 4.2 Leitura de arquivos pelo Deno (pergunta 2)

`docs/investigations/native-io/fs-bench.ts` lê os 355 arquivos rastreados (4,32 MiB) de quatro jeitos,
15 rodadas cada, com o cache quente:

| Variante | p50 | mínimo |
| --- | ---: | ---: |
| `Deno.readFileSync` em sequência | 5,79 ms | 3,67 ms |
| `Deno.readFile` em sequência | 9,50 ms | 7,80 ms |
| `Deno.readFile` em paralelo (64 por vez) | **3,35 ms** | 2,13 ms |
| `xargs -0 cat` (processo externo, piso do SO) | 4,14 ms | 3,89 ms |

**[Fato]** O assíncrono em sequência é o mais lento: cada chamada passa pelo pool de threads e volta. O
paralelo esconde esse custo e fica abaixo de um `cat` externo.

**[Fato]** Como o Deno faz isso: no crate `deno_fs`, cada operação assíncrona chama a versão síncrona
dentro de `spawn_blocking`. As versões antigas usavam `tokio::task::spawn_blocking`, e as recentes
importam `spawn_blocking` de `deno_core::unsync`, "to more easily experiment with alternative
spawn_blocking implementations" (fontes no §9). Nenhuma fonte encontrada indica io_uring no Deno.
**[Não verificado]** no código-fonte da 2.9.8 especificamente.

### 4.3 Custo de IPC (pergunta 3)

`docs/investigations/native-io/ipc-bench.ts` mede a ida e volta de uma mensagem JSON-RPC entre o Deno e
um processo filho que devolve o eco. O filho é outro Deno, então o número inclui a serialização dos dois
lados. Um filho em Rust barateia só o lado dele; o lado do Deno, que é o que o núcleo paga, continua
igual.

| Transporte | Início até a 1ª resposta | 100 B (p50 / p99) | 10 KB (p50 / p99) | 1 MB (p50 / p99) |
| --- | ---: | ---: | ---: | ---: |
| stdio, linhas JSON | 23,1 ms | 0,046 / 0,215 ms | 0,070 / 0,234 ms | 6,98 / 14,66 ms |
| Unix Domain Socket | 48,7 ms | 0,119 / 0,838 ms | 0,092 / 0,652 ms | 7,71 / 18,43 ms |
| mesmo processo, só `JSON` (referência) | — | — | 0,011 / 0,069 ms | — |

n = 2 000 por tamanho (100 para 1 MB). O "início" do UDS inclui o filho abrir o socket e avisar que
está pronto.

**[Fato]**
- Mensagens pequenas custam dezenas de microssegundos. O stdio foi mais barato que o UDS em todos os
  tamanhos.
- Trazer **1 MB** de volta custa **~7 ms**, o dobro de ler os 4,3 MiB do repositório inteiro dentro do
  Deno (§4.2).

## 5. Respostas

1. **I/O é gargalo?** Não. Em nenhum fluxo a espera por I/O passou de 0,07 % do tempo de parede. O
   que domina é CPU (`repo-map` sem cache, testes) ou subprocessos e rede (`guardian-audit`,
   `now-probe`).
2. **O Deno basta?** Sim. Ler o repositório inteiro leva 3 ms em paralelo. O pool de threads do Deno
   já entrega leitura assíncrona sem bloquear o event loop, e a diferença para o piso do SO é de
   frações de milissegundo.
3. **Que carga justificaria um worker nativo?** Nenhuma das atuais. **[Inferência]** Para compensar,
   um worker nativo teria de economizar mais tempo de I/O do que gasta trazendo o resultado: ~7 ms por
   MB por stdio, mais ~23 ms para subir. Só um caso em que o worker processa muito dado e devolve
   pouco (por exemplo, varrer centenas de milhares de arquivos com o cache frio e devolver um índice
   pequeno) poderia ganhar, e mesmo aí o io_uring disputaria com o pool de threads, que já paraleliza
   a leitura.

## 6. Disponibilidade e segurança do io_uring

Pesquisa delegada ao Antigravity e conferida em busca própria; o que não foi confirmado está marcado.

| Fato | Fonte |
| --- | --- |
| **[Fato]** O sysctl `kernel.io_uring_disabled` (commit `76d3ccec`, Matteo Rizzo, série 6.6, levado pelo Ubuntu a kernels anteriores) aceita 0 (padrão, todos podem criar), 1 (só processos com `CAP_SYS_ADMIN` ou do grupo `kernel.io_uring_group`) e 2 (ninguém). Instâncias já criadas continuam funcionando. Neste host, o valor é 0 | patch v4 na LKML; commit `76d3ccec`; SRU do Ubuntu |
| **[Fato]** O perfil seccomp padrão do **Docker** bloqueia `io_uring_setup`, `io_uring_enter` e `io_uring_register` "due to security vulnerabilities that can be exploited to break out of containers" (moby#46762). A issue moby#47532 relata o bloqueio na 25.0. **[Não verificado]** em qual versão exata o PR entrou | docs do Docker sobre seccomp; moby#47532 |
| **[Fato]** O **containerd 2.0** removeu as três syscalls do perfil `RuntimeDefault`, listado como mudança que quebra compatibilidade (containerd#9320) | notas da 2.0.0-beta.0 e da rc.0 |
| **[Não verificado]** O perfil padrão do **Podman** também bloqueia: há indícios (um projeto que importou o perfil do Podman e teve de reabilitar io_uring), mas a issue citada pelo Antigravity não foi confirmada | — |
| **[Fato]** O Google relatou em 2023 que **60 %** das submissões ao kCTF VRP exploravam io_uring (cerca de US$ 1 milhão pagos) e que io_uring apareceu em todas as submissões que contornaram as mitigações deles. Em resposta: desligado no ChromeOS e nos servidores de produção, e inalcançável para apps no Android (filtro seccomp-bpf). "We currently consider it safe only for use by trusted components" | Google Security Blog, "Learnings from kCTF VRP's 42 Linux kernel exploits" (junho de 2023) |
| **[Fato]** Em abril de 2025, a ARMO publicou o rootkit de prova de conceito "Curing", que opera só por io_uring e passou despercebido por ferramentas que observam syscalls (Falco, Microsoft Defender for Endpoint para Linux, segundo a cobertura). Correção do rascunho delegado, que datava a pesquisa em 2024 | blog da ARMO; BleepingComputer; Security Boulevard |
| **[Fato]** O Node.js desligou o io_uring da libuv por padrão desde a 20.11.1 por causa da CVE-2024-22017 (`setuid()` não afetava operações io_uring iniciadas antes) | §9 |

**[Inferência]** Para o Vetor, isso significa que um caminho io_uring:

- não funcionaria em containers Docker e containerd com o perfil padrão, nem em hosts com
  `io_uring_disabled` ≥ 1, e precisaria de fallback para o pool de threads em todo lugar;
- iria contra a tendência do ecossistema (Node.js, Google, runtimes de container), que trata o
  io_uring como superfície de ataque a ser fechada por padrão;
- tornaria a observação por syscalls da #583 cega para o I/O feito por ele.

## 7. Opções avaliadas

| Opção | Avaliação |
| --- | --- |
| **A. Descartar io_uring e worker de I/O nativo** | **Recomendada.** Não há gargalo de I/O para atacar (§4.1) |
| B. Worker nativo com io_uring para o `repo-map` | O `repo-map` é limitado por CPU (parse), não por I/O, e já tem cache incremental por SHA de blob (76,9 ms com cache). O IPC custaria mais que a leitura (§4.3) |
| C. Paralelizar leituras no Deno onde houver laço sequencial | Ganho real mas pequeno (9,5 → 3,4 ms no repositório inteiro); só vale se um fluxo ler muitos arquivos em sequência no caminho crítico, o que o perfil não mostrou |
| D. Atacar o tempo de subprocessos e rede (`guardian-audit`, `now-probe`) | Fora do escopo de I/O nativo, mas é onde estão os segundos. Fica como observação, sem issue criada |

## 8. Recomendação

**[Opinião]** **Descartar** io_uring e qualquer worker de I/O nativo para o Vetor. Registro do motivo,
para não reabrir sem dado novo:

- espera de I/O ≤ 0,07 % do tempo de parede em todos os fluxos, inclusive na suíte (§4.1);
- o Deno lê o repositório inteiro em ~3 ms, abaixo de um `cat` externo (§4.2);
- trazer 1 MB de um processo nativo custa ~7 ms, mais que ler tudo no próprio Deno (§4.3);
- o io_uring tem restrições de disponibilidade e segurança que um plugin portátil não controla
  (§6).

**Reabrir só se** um fluxo do Vetor mostrar espera de I/O acima de 10 % do tempo de parede, medida
com o `io-profile.ts` num repositório real, de preferência com o cache frio. Mesmo nesse caso, o
primeiro passo é paralelizar a leitura no próprio Deno (opção C), não um worker nativo.

Para a #585: a pergunta de IPC dela tem resposta aqui (§4.3). JSON-RPC por stdio é o transporte mais
barato medido, com ~23 ms de início e dezenas de microssegundos por mensagem pequena.

A decisão continua humana: este spike não altera código de produto nem cria issues de follow-up.

## 9. Fontes

- `deno_fs`, uso de `spawn_blocking`:
  [std_fs.rs 0.20.0](https://docs.rs/crate/deno_fs/0.20.0/source/std_fs.rs),
  [std_fs.rs 0.87.0](https://docs.rs/crate/deno_fs/0.87.0/source/std_fs.rs),
  [commit sobre `deno_core::unsync::spawn_blocking`](https://code.fosterhangdaan.com/foster/denoland-deno/src/commit/1c74b41855b85c9ec2ee1d83ac0f6b04e1461788/ext/fs).
- `tokio-uring`, crate separado do tokio:
  [anúncio de 2021](https://tokio.rs/blog/2021-07-tokio-uring),
  [repositório](https://github.com/tokio-rs/tokio-uring),
  [lib.rs (0.5.0, 2024-05-27)](https://lib.rs/crates/tokio-uring),
  [discussão sobre o status](https://users.rust-lang.org/t/status-of-tokio-uring/114481).
- libuv/Node.js e CVE-2024-22017:
  [NVD](https://nvd.nist.gov/vuln/detail/CVE-2024-22017),
  [Ubuntu](https://ubuntu.com/security/CVE-2024-22017),
  [Red Hat Bugzilla 2265727](https://bugzilla.redhat.com/show_bug.cgi?id=2265727),
  [patch do Yocto: "Disable io_uring by default due to CVE-2024-22017"](https://patchwork.yoctoproject.org/project/oe/patch/20241207140642.181134-1-martin.jansa@gmail.com).
- Sysctl `io_uring_disabled`:
  [patch v4 na LKML](https://lkml.iu.edu/hypermail/linux/kernel/2308.2/00994.html),
  [commit 76d3ccec](https://code.amethyst.name/public-mirrors/linux/commit/76d3ccecfa186af3120e206d62f03db1a94a535f),
  [SRU do Ubuntu](https://lists.ubuntu.com/archives/kernel-team/2023-October/145924.html).
- Containers:
  [seccomp no Docker](https://docs.docker.com/engine/security/seccomp/),
  [moby#47532](https://github.com/moby/moby/issues/47532),
  [containerd 2.0.0-rc.0](https://github.com/containerd/containerd/releases/tag/v2.0.0-rc.0),
  [containerd 2.0](https://containerd.io/docs/2.2/containerd-2.0/).
- Google: [Learnings from kCTF VRP's 42 Linux kernel exploits](https://security.googleblog.com/2023/06/learnings-from-kctf-vrps-42-linux.html),
  [repost no oss-security](https://openwall.com/lists/oss-security/2023/06/17/2).
- Curing (ARMO, abril de 2025):
  [ARMO](https://www.armosec.io/blog/io_uring-rootkit-bypasses-linux-security),
  [BleepingComputer](https://www.bleepingcomputer.com/news/security/linux-io-uring-security-blindspot-allows-stealthy-rootkit-attacks/),
  [Security Boulevard](https://securityboulevard.com/2025/04/armo-io_uring-interface-creates-security-blind-spot-in-linux/).

A pesquisa da seção 6 foi delegada ao Antigravity (`agy -p`), e a do §4.2 foi feita inline, porque o
Codex falhou por limite de uso. Toda afirmação de fonte externa foi conferida antes de entrar aqui.
