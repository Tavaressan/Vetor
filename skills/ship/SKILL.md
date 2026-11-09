---
name: ship
description: Pipeline de entrega em duas etapas — --prepare (sincronização, testes, push, PR draft e revisões consultivas, até PR_STAGED) e --finalize (squash merge, sync do root e cleanup). Cada etapa é um comando determinístico de vetor-checks.sh; o procedimento manual só é lido quando um comando falha. Deve ser executado de dentro de um worktree.
license: MIT
compatibility: "Núcleo: ler, editar e rodar shell. Opcional: subagentes, hooks, perguntas, background (fallback em shared/references/harness-capabilities.md)."
metadata:
  author: vitortavares
  version: "2.0.0"
---

Você é o pipeline de entrega do Vetor. Sua missão é levar código testado e verde de um worktree até o
merge na branch default em duas etapas: `--prepare` (até o PR draft com o CI disparado) e
`--finalize` (merge, sincronização do root e cleanup).

---

## Sintaxe

```
/vetor:ship --prepare [issue#...]
/vetor:ship --finalize <PR-number>
```

- `--prepare [issue#...]`: sincroniza com a default, roda migrations, testes dos módulos tocados e
  debug-scan, faz push, abre o PR draft, grava `PR_STAGED` e dispara as revisões consultivas. Nunca
  faz merge.
- `--finalize <PR-number>`: confere o CI, faz o squash merge, sincroniza o root e limpa worktree,
  branch e status.

Sem flag, o comando falha (exit 2): o modo sequencial legado foi removido. Para o ciclo completo,
rode `--prepare` e, com o CI verde, `--finalize`.

---

## Referências

> Paths relativos abaixo resolvem a partir do diretório desta própria skill (informado ao carregar,
> ex. "Base directory for this skill: ..."), não do `cwd` de execução. Em comandos `bash`/`deno run`,
> prefixe o path absoluto desse diretório ao caminho relativo antes de executar — defina uma vez:
> ```bash
> SKILL_DIR="<path absoluto informado como 'Base directory for this skill' no carregamento>"
> ```
> e use `"$SKILL_DIR/../../scripts/..."` em todo comando abaixo, nunca o path relativo isolado.

- `../shared/references/project-conventions.md` — resolva `$DEFAULT_BRANCH` e o `module-test-map`
  conforme descrito lá. O `module-test-map.md` e o `config.json` vêm sempre do root do repositório
  (`vetor-checks.sh repo-root`), nunca do worktree.
- `references/recuperacao.md` — procedimento manual de cada passo; leia só quando um comando abaixo
  sair com erro, e só a seção que a tabela de saídas indicar.
- `../shared/references/delegate-to-runtime.md` — só se for delegar o resumo de logs de CI ou o
  corpo do PR a um runtime externo.

---

## Comportamento

### 0 — Argumentos e guarda de contexto

```bash
read -r SHIP_MODE SHIP_TARGET < <(bash "$SKILL_DIR/../../scripts/vetor-checks.sh" validate-ship-args "$@")
bash "$SKILL_DIR/../../scripts/vetor-checks.sh" in-worktree
```

Se o `validate-ship-args` falhar, mostre o erro e pare. Se o `in-worktree` sair não-zero, pare:
`/vetor:ship` roda de dentro de um worktree (use `/vetor:worktree-create` antes). Esta skill nunca
muda de diretório por conta própria; quem a invoca de outro contexto (ex.: o `coordinator`, cujo cwd
é o root) faz `cd` para o worktree antes.

**Exceção — `--finalize <PR>` sem worktree local.** Com o `in-worktree` falhando no modo
`finalize`, não pare: siga `references/recuperacao.md` §1, que recria o worktree a partir da branch
remota do PR.

Em `--headless`/`--goal`, os 4 gates da 6.d do coordinator são responsabilidade do chamador: o ship
não os reverifica.

### 1 — Comando determinístico

```bash
# --prepare: sync, migrations, debug-scan, testes, push, PR draft (--body-file), PR_STAGED + preship.json
bash "$SKILL_DIR/../../scripts/vetor-checks.sh" prepare "<path-do-worktree>" <issue#...>
# --finalize: vetor-merge.sh e, só com merge concluído, sync-root + cleanup completo (rode do root)
bash "$SKILL_DIR/../../scripts/vetor-checks.sh" finalize <PR-number> <branch>
```

| Comando | Exit | Significado | O que fazer |
|---|---|---|---|
| `prepare` | 0 | `PR_STAGED` gravado | §2 (revisões consultivas) |
| `prepare` | 1 | validação: branch, migrations, debug-scan ou config | `recuperacao.md` §2.b e §4.b; corrija e repita |
| `prepare` | 3 | testes vermelhos ou conflito de sync (merge já abortado) | `recuperacao.md` §2 e §4; resolva e repita |
| `prepare` | 5 | push ou criação do PR falhou | `recuperacao.md` §5 e §6; repita (idempotente: reaproveita PR aberto) |
| `finalize` | 0 | mergeado, root sincronizado, worktree/branch/status/`*-preship.json` removidos | fim |
| `finalize` | 3 | merge não aconteceu (CI pendente ou falho, review exigido, conflito) | `recuperacao.md` §7 a §10 |
| `finalize` | 4 | PR só enfileirado (merge queue/auto-merge) | reporte `Enfileirado` e pare; nada é limpo |
| `finalize` | 5 | mergeado, mas o cleanup ficou incompleto | `recuperacao.md` §12; nunca tente outro merge |
| ambos | 2 | uso incorreto ou `<branch>` diferente do `headRefName` do PR | revise os argumentos |

O `prepare` pula a suíte quando o `HEAD` é o SHA da linha `Tested: <sha> <comando> pass` do status
file (gravada pelo worker no `GREEN`) e o sync com a default não trouxe commits. O `finalize` remove
o worktree da branch: rode-o do root. O CI continua sendo o gate final.

### 2 — Revisões consultivas (`--prepare`, exit 0)

Rode **só quando há mudança real de código-fonte**. Pule este passo se todos os arquivos alterados
(`git diff "origin/$DEFAULT_BRANCH" --name-only`) forem `.md` em `docs/**` ou `wiki/**`, `.md` na
raiz do repositório ou lockfiles (`*.lock`, `package-lock.json`, `deno.lock`). `.md` fora desses
caminhos (ex.: `SKILL.md`, agentes) e configs que executam comandos (hooks, workflows de CI) não
entram na exceção.

1. **Code review.** Pule só se o PR já tem um comentário `## Code Review (Vetor)` com uma linha
   `Reviewed: <sha>` igual ao HEAD atual (o coordinator revisou o diff local antes do push). Caso contrário, despache o agent `code-review` com o número do PR, a branch e a base. Com
   subagentes, em background:
   ```javascript
   Agent({
     description: "Code review: PR #<PR-number>",
     prompt: "PR #<PR-number>, branch <branch>, base $DEFAULT_BRANCH.",
     subagent_type: "vetor:code-review",
     model: "sonnet"
   })
   ```
   Sem subagentes, siga o fallback de `../shared/references/harness-capabilities.md` §2.1.
2. **Security review.** Só se a skill nativa `security-review` estiver disponível nesta sessão;
   senão, pule em silêncio. Como invocá-la e publicar o relatório com o cabeçalho
   `## Security Review (Vetor)`: `references/recuperacao.md` §8.6.

Não aguarde o retorno das revisões e **nunca pare o pipeline por causa dos achados**: são
consultivos, e quem decide é o humano lendo o comentário no PR. Se um despacho falhar, registre no
sumário e siga.

### 3 — Merge negado pela camada de permissões

Se o harness negar o merge do `finalize` (no Claude Code, o classificador do auto mode, motivo tipo
"merge sem review"), **pare e peça aprovação explícita** com a ferramenta de perguntas (ou no chat
quando ela não existir) e só repita após o "sim". **Nunca** contorne a negação. Na entrega autônoma
do coordinator em `--headless` (Fase 6.d) não há a quem perguntar: registre a negação no retorno e
deixe o PR aberto.

---

## Restrições

- Nunca faz push de código com testes falhando.
- Nunca entra em loop de merge se review é necessário.
- Máximo 3 iterações de fix de CI (`recuperacao.md` §8).
- Preserva o worktree intacto em caso de falha, para inspeção manual.
- As revisões consultivas nunca bloqueiam o merge.
- `--prepare` nunca tenta merge; `--finalize` exige `<PR-number>` válido.
- `finalize` com exit 4 (enfileirado) não é merge concluído: nada é limpo; exit 5 nunca tenta outro
  merge.
