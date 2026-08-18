# `stop-recovery` — hook `Stop` aposentado

> ⚠️ **LEGADO — não use.** Aposentado pela [issue #141](https://github.com/Tavaressan/Vetor/issues/141).
> Não está registrado em `hooks/hooks.json` e **não é carregado pelo plugin** (vive fora de `scripts/`,
> portanto também fora de `deno task test`/`fmt`/`lint`). Mantido apenas como referência histórica,
> ao lado de `legacy/worktree-session/`.

## O que fazia

Rodava no evento `Stop` do Claude Code. Lia o `.jsonl` do transcript da sessão, extraía os
`Edit`/`Write` registrados e comparava com o conteúdo atual dos arquivos em disco. Ao encontrar
divergência, **bloqueava o encerramento da sessão** e reportava — nunca corrigia sozinho.

A motivação original (issue #46) era real: uma sessão interrompida no meio de um `Edit` — falha de
rede, kill, timeout — pode deixar o transcript relatando uma edição que nunca chegou ao disco.

## Por que foi aposentado

A aposentadoria **não é correção de um bug ativo**. O código aqui arquivado está na sua última
versão em uso, já com as correções das issues #136 e #137 (PR #140): `~/.claude/**` é excluído
incondicionalmente de `findDivergences`, e sem `repoRoot` detectável o hook fica em silêncio em vez
de verificar tudo. O falso positivo concreto relatado na #141 não ocorre mais neste código.

O que motivou aposentar é o argumento estrutural, que sobreviveu à correção:

1. **A comparação transcript-versus-disco é frágil por natureza.** Qualquer processo legítimo que
   toque o arquivo depois do `Write` — formatador, linter, hook de outro plugin, o subsistema de
   memória do Claude Code, que normaliza o frontmatter *depois* que o `Write` retorna — produz
   divergência, porque a comparação de `write` é por igualdade exata.

2. **A trilha de remendos.** #87 (ignorar arquivos fora do repo), #127 (detectar remoção legítima
   por comando Bash), #128 (remoção de worktree), #136 (guarda incondicional de `~/.claude/**`),
   #137 (acknowledgment por sessão, para o alerta não re-bloquear a cada turno). Cada um estreitou
   o alcance do hook sem tornar o sinal confiável.

3. **O modo de falha era o mais intrusivo possível** — bloquear o encerramento da sessão — para um
   alerta que não altera arquivo nenhum e cuja ação prescrita era "revise manualmente".

Somados, o hook passou a cobrir uma fatia cada vez menor de casos ao custo de manutenção recorrente
e de um modo de falha caro. Foi retirado de operação por essa relação custo/benefício.

## O que sobra no lugar

O sinal confiável para o cenário da issue #46 é o campo `EditRecord.incomplete` — chamada de
ferramenta sem `tool_result` no transcript, ou seja, sessão de fato interrompida no meio da edição.
Era a **comparação de conteúdo**, não a detecção de interrupção, que gerava ruído. Se algum dia
valer a pena reintroduzir a checagem, o caminho é reportar apenas com `incomplete`.

## Arquivos

| Arquivo | Papel |
|---|---|
| `stop-recovery.ts` | Entrypoint do hook `Stop` |
| `transcript.ts` | Parsing do `.jsonl` e `findDivergences` (não tinha outro consumidor) |
| `stop-recovery_test.ts`, `transcript.test.ts`, `transcript_test.ts` | Testes, movidos junto |
