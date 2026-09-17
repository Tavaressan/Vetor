---
name: worktree-ship
description: Pipeline headless de entrega — test → push → PR draft → CI → merge → sync root → cleanup. Deve ser executado de dentro de um worktree.
license: MIT
compatibility: Claude Code
metadata:
  author: vitortavares
  version: "1.2.0"
---

Você é o pipeline de entrega do Vetor. Sua missão é levar código testado e verde de um worktree até o merge na branch default, sem intervenção manual exceto quando review é necessário.

---

## Sintaxe

```
/worktree-ship [issue#]
```

- `[issue#]`: opcional — número da issue GitHub para incluir `Closes #N` no PR

---

## Referências

> Paths relativos abaixo resolvem a partir do diretório desta própria skill (informado ao carregar,
> ex. "Base directory for this skill: ..."), não do `cwd` de execução. Em comandos `bash`/`deno run`,
> prefixe o path absoluto desse diretório ao caminho relativo antes de executar — defina uma vez:
> ```bash
> SKILL_DIR="<path absoluto informado como 'Base directory for this skill' no carregamento>"
> ```
> e use `"$SKILL_DIR/../../scripts/..."` em todo comando abaixo, nunca o path relativo isolado.

- `../shared/references/project-conventions.md` — resolva `$DEFAULT_BRANCH`
  e o `module-test-map` conforme descrito lá. Use `$DEFAULT_BRANCH` em todos os comandos abaixo.
  **A resolução do `module-test-map.md`/`config.json` no passo 4 sempre usa o root do repositório
  (`vetor-checks.sh repo-root`), nunca o `cwd` do worktree** — arquivos ignorados pelo `.gitignore`
  do projeto-alvo (ex.: `.claude/`) não são materializados em worktrees (issue #160).
- `../shared/references/delegate-to-runtime.md` — delegação opcional a um
  runtime externo disponível (Gemini/OpenCode/Codex) para resumo de logs de CI §4.1 e corpo do PR
  §4.4. Se a chamada for **negada pelo classificador de permissão**, ou falhar por qualquer outro
  motivo, não retente: siga com o caminho nativo imediatamente (§3 da referência).
- `../shared/references/conflict-resolution.md` — procedimento de resolução
  de conflitos (passos 2 e 10).
- `../shared/references/mcp-availability.md` — se os módulos alterados
  envolverem UI/frontend e o MCP de browser estiver disponível, use-o no passo 4 como checagem e2e
  leve **adicional** aos testes automatizados, nunca substituta.

---

## Comportamento

### 1 — Guarda de contexto

```bash
bash "$SKILL_DIR/../../scripts/vetor-checks.sh" in-worktree
```

Se sair não-zero, **aborte**: `/worktree-ship` deve rodar de dentro de um worktree (use
`/worktree-create` primeiro). Se passar, guarde a branch atual (`git branch --show-current`).

Este comando **nunca muda de diretório por conta própria** — quem o invoca de outro contexto (ex.:
`issue-coordinator`, cujo cwd é o root) deve fazer `cd` para o worktree antes.

### 2 — Sincronizar com a branch default

```bash
git fetch origin "$DEFAULT_BRANCH"
git merge "origin/$DEFAULT_BRANCH"
```

Sincronizar antes dos testes evita descobrir divergências só no merge final. Se houver conflito
aqui, resolva-o já seguindo `conflict-resolution.md`. Não prossiga com testes contra base
desatualizada.

Se houve conflito resolvido com commit, valide que o commit de resolução é de fato um merge commit
de 2 pais antes de prosseguir — um commit de 1 pai indica que `MERGE_HEAD` foi perdido (ex.: `git
stash` rodado no meio do conflito) e o GitHub vai recalcular o merge do zero, reportando
`CONFLICTING` mesmo com a árvore correta:

```bash
[ "$(git log -1 --format='%P' HEAD | wc -w)" -eq 2 ] || {
  echo "ALERTA: commit de resolução de conflito não tem 2 pais — MERGE_HEAD foi perdido." >&2
  exit 1
}
```

Se falhar, siga a recuperação descrita em `conflict-resolution.md` §5 (refaça o merge com `git merge
-s ours` para registrar o segundo pai sem alterar a árvore já resolvida) antes de seguir.

### 2.b — Colisão de versão de migration (condicional)

Logo após o merge do passo 2, **antes dos testes locais**:

```bash
bash "$SKILL_DIR/../../scripts/vetor-checks.sh" migrations
```

Detecta colisões semânticas invisíveis ao git entre workers paralelos (dois arquivos com a mesma
versão, sem conflito textual). Se sair não-zero, **pare** e mostre a saída. Projetos sem migrations
versionadas: no-op. Mesma convenção Flyway do `guardian` §2.

### 3 — Detecção de módulos alterados

```bash
git diff "origin/$DEFAULT_BRANCH" --name-only
```

Mapeie os arquivos alterados aos módulos usando a tabela do module-test-map, resolvido a partir do
root do repositório (`vetor-checks.sh repo-root`), não do `cwd` do worktree.

### 4 — Testes locais

Para cada módulo alterado, execute o comando headless correspondente do `module-test-map.md`
resolvido no passo 3. Quando o comando for `sem suíte de testes`, registre `skipped (no test
suite)` no sumário; esse estado não bloqueia o ship.

**Regra sandbox:**
- Tente docker uma vez (se aplicável ao módulo)
- Se bloqueado: troque permanentemente para o comando headless e registre no sumário
- Módulo de integração sem a dependência viva (DB etc.): reporte "skipped (requires <dep>)" sem falhar

**Se algum teste falhar:**
```
FALHA: testes locais não passaram. Corrija antes de fazer ship.
Módulo: <módulo>
Saída: <últimas 30 linhas do log>
```
**Pare.** Não faça push de código vermelho.

### 4.b — Scan de debugging

```bash
bash "$SKILL_DIR/../../scripts/vetor-checks.sh" debug-scan "origin/$DEFAULT_BRANCH"
```

Se sair não-zero, remova os padrões apontados (debug temporário, `it.only` etc.) e commite antes
do push.

### 5 — Push

```bash
git push -u origin <branch>
```

Se falhar por rede, retente.

### 6 — Criar PR draft

Construa o título a partir dos commits:
```bash
git log "origin/$DEFAULT_BRANCH..HEAD" --oneline
```

O corpo pode ser rascunhado por um runtime de delegação disponível (ver `delegate-to-runtime.md`
§4.4); caso contrário, use o template inline:
```markdown
## Resumo
- <bullet points das mudanças principais, derivados dos commits>

## Módulos testados
- <lista de módulos testados e resultado>

## Issue relacionada
Closes #<issue#>

🤖 Desenvolvido com [Claude Code](https://claude.ai/code)
```

Anexe `Closes #<issue#>` (se fornecida) e a nota do rodapé ao final. Crie o PR draft:
```bash
gh pr create \
  --title "<type>(<slug>): <resumo dos commits>" \
  --body "<descrição gerada e validada>" \
  --draft \
  --base "$DEFAULT_BRANCH"
```

### 7 — Monitorar CI

Antes do loop de CI, cheque cedo se o GitHub considera o PR mergeável — evita descobrir um
`CONFLICTING` só no timeout do CI (ex.: causado por `MERGE_HEAD` perdido no passo 2):

```bash
gh pr view <PR-number> --json mergeable,mergeStateStatus
```

Se `mergeable` == `CONFLICTING` (ou `mergeStateStatus` == `DIRTY`), **não prossiga para o CI**: volte
ao passo 2 e refaça a sincronização/merge seguindo `conflict-resolution.md` (incluindo a checagem de
2 pais do §2 acima) antes de repetir este passo.

```bash
gh pr checks <PR-number> --watch
```

Timeout: 20 minutos. Se expirar, notifique e pare.

⚠️ **Nunca substitua `gh pr checks --watch` por um loop de monitoramento próprio que só checa
existência/início de um run** (ex.: sair assim que `status` deixar de estar vazio ou virar
`in_progress`) — isso perde silenciosamente o momento em que o CI chega a um estado terminal. O
comando `--watch` é bloqueante por design e é exatamente esse comportamento que se quer: ele só
retorna quando os checks atingem um estado terminal (`success`/`failure`/`cancelled`/`timed_out`).

Se for necessário rodar em background (ex.: para não bloquear outra atividade), use a tool `Monitor`
no padrão "per-occurrence com fim conhecido" — o loop só termina em estado terminal do CI, nunca na
mera existência do run:

```bash
until gh pr checks <PR-number> --json state -q '.[].state' \
  | grep -qvE '^(IN_PROGRESS|QUEUED|PENDING)$'; do
  sleep 15
done
gh pr checks <PR-number>
```

### 8 — Classificação de erros e loop de fix (máximo 3 iterações)

Para cada falha detectada:

**8.a — Circuit breaker de infraestrutura (antes de ler logs)**

```bash
deno run -A scripts/detect-infra-failure.ts <run-id>
```

Se retornar exit 0 (JSON com `isInfrastructureFailure: true`), nenhum fix de código resolve:
- **Pule** inteiramente as iterações de fix (§8.b).
- Escreva o status file:
  ```markdown
  Status: BLOCKED_INFRA
  Motivo: Falha de infraestrutura da plataforma — <reason do script>.
  Ação necessária: resolver billing/outage no GitHub antes de retomar.
  ```
- **Escale** via `AskUserQuestion`: `⚠️ Falha de infraestrutura detectada no CI (billing/outage). Não é possível resolver com fix de código. Deseja aguardar a resolução ou prosseguir sem CI (merge manual)?`
- **Pare.** Não consuma iterações de fix-loop.

**8.b — Erro de código (só se não for infraestrutura)**

```bash
gh run view <run-id> --log-failed
```
(opcionalmente condensado por um runtime de delegação disponível — ver `delegate-to-runtime.md`
§4.1). Avalie a natureza do erro:

- **Transiente (rede/timeout do runner):** **não altere o código**. Aguarde 30 segundos e rode
  `gh run rerun <run-id>`. Backoff exponencial, até 3 tentativas.
- **Erro de código (lint/compilação/teste):** identifique a causa raiz, aplique a correção no
  worktree, commite (`fix: corrige <problema> no CI`), `git push origin <branch>` e volte ao passo 7.

Após 3 iterações de fix sem CI verde:
```
FALHA: CI não passou após 3 tentativas de fix de código.
Último erro: <trecho do log>
Worktree preservado para inspeção manual.
```
**Pare.** Não tente mergear.

### 8.5 — Revisões consultivas (não bloqueantes)

Roda **só quando há mudança real de código-fonte**: se o passo 3 não mapeou nenhum módulo (PR só de
docs, lockfile ou config), **pule este passo inteiro**.

Havendo módulo alterado, execute as duas revisões:

1. **Code review** (bugs, correção, arquitetura):
   ```javascript
   Agent({
     description: "Code review: PR #<PR-number>",
     prompt: "PR #<PR-number>, branch <branch>, base $DEFAULT_BRANCH.",
     subagent_type: "vetor:code-review",
     model: "sonnet"
   })
   ```
   O harness **sempre** despacha subagentes em background — não existe modo síncrono, e o retorno
   imediato é apenas a confirmação de que o agente foi lançado, nunca o resultado da revisão.
   **Bloqueante-leve:** antes de prosseguir para o passo 9, aguarde a notificação de conclusão deste
   subagente (ele publica os achados como comentário na PR ao terminar). Os achados continuam
   **consultivos** — não bloqueiam o merge por si só —, mas aguardar garante que eles cheguem a
   tempo de virar decisão (ou commit corretivo) antes do merge, em vez de serem descobertos depois.

2. **Security review** (segurança da aplicação — OWASP: injeção, XSS, segredos expostos): verifique
   se a skill nativa `security-review` está disponível nesta sessão. **Se não estiver, pule
   silenciosamente.** Se estiver, invoque-a conforme §8.6 abaixo.

**Nunca pare o pipeline por causa dos achados** — mesmo com itens `blocker` ou vulnerabilidades,
prossiga para o passo 9 assim que ambas as revisões tiverem retornado. Quem decide agir é o humano,
lendo o comentário na PR. Se um dos despachos falhar (rate limit, erro de ferramenta), registre no
sumário e prossiga.

### 8.6 — Security review (skill nativa)

A skill nativa `security-review` **não publica comentário sozinha**: seu contrato de saída é
"a resposta final deve conter o relatório em markdown e nada mais". Quem invoca (você, executando
o `worktree-ship`) é responsável por publicar esse relatório na PR no turno seguinte à resposta.

Além disso, a skill monta o próprio contexto sozinha (git status, arquivos modificados, commits,
diff da branch atual) — **não** passe `gh pr diff <PR-number>` como argumento; ela ignora diffs
passados por fora e lê a branch diretamente.

```
Invoque a skill nativa `security-review` sem argumento de diff — ela lê a branch atual.
```

Ao receber a resposta final (o relatório em markdown), publique-o você mesmo:
```bash
gh pr comment <PR-number> --body "<relatório de security-review recebido>"
```

**Proporção do protocolo de sub-tasks:** o protocolo de sub-tasks paralelas da skill nativa (uma
por vulnerabilidade candidata, para filtrar falso-positivo) é desenhado para diffs grandes. Para
diffs pequenos — heurística sugerida: abaixo de ~200 linhas alteradas, já filtrados pelo
`vetor:code-review` do §8.5 — peça à skill para analisar inline, sem abrir o protocolo completo de
sub-tasks por vulnerabilidade. Acima desse limiar, deixe a skill decidir seu próprio protocolo.

### 9 — Verificar review

```bash
gh pr view <PR-number> --json reviewDecision
```

Se `reviewDecision` == `REVIEW_REQUIRED` ou `CHANGES_REQUESTED`:
```
PR requer review humano. Status: <reviewDecision>
URL: <PR-url>
Aguardando aprovação antes de prosseguir com merge.
```
**Pare.** Não entre em loop tentando merge.

### 10 — Merge

```bash
bash "$SKILL_DIR/../../scripts/vetor-merge.sh" <PR-number>
```

O script faz `gh pr ready` + `gh pr merge --squash --delete-branch` e verifica o estado real do PR
quando o `gh` sai não-zero (erro de cleanup local da branch não é falha de merge):
- **exit 0** — PR mergeado. Siga para o passo 11.
- **exit 3** — merge não aconteceu. Rode `git merge "$DEFAULT_BRANCH"` localmente no worktree e siga
  `../shared/references/conflict-resolution.md`. Resolvido e verde, volte ao
  passo 7.

**Se o comando for negado pela camada de permissões do Claude Code** (classificador de auto-mode,
motivo tipo "merge sem review") — barreira independente do `reviewDecision` do passo 9: **pare, peça
aprovação explícita via `AskUserQuestion`** e só repita após o "sim". **Nunca** contorne a negação.

### 11 — Sincronizar root

```bash
bash "$SKILL_DIR/../../scripts/vetor-checks.sh" sync-root
```

Volta ao root e sincroniza com a branch default. (Só numa sessão manual em que você entrou no
worktree com `EnterWorktree` é preciso sair com `ExitWorktree` antes.) Confirme pela mensagem de
sucesso.

### 12 — Cleanup

Descubra o path real do worktree via `git worktree list` (não assuma convenção de path — a
localização é do harness). Se invocado pelo `issue-coordinator` (modo headless), execute
automaticamente:
```bash
bash "$SKILL_DIR/../../scripts/vetor-checks.sh" safe-remove-worktree "<path-do-worktree>"
git branch -d <branch>
rm -f .claude/vetor/status/<branch>.md
rm -f .claude/vetor/status/<branch>-touched-files.json
```

Se a checagem falhar, **pare o cleanup** e não prossiga com `git branch -d`/remoção dos arquivos de
status/cache — há dois motivos distintos de falha:

- **Worktree filho ativo dentro do path alvo**: mostre os paths e preserve worktree pai, branch e
  arquivos de status/cache até os filhos serem realocados.
- **Diretório residual em disco após `git worktree remove`** (issue #157): o `git worktree remove`
  desregistrou o worktree do git (não aparece mais em `git worktree list`) mas falhou ao apagar o
  diretório — no Windows, tipicamente por `Filename too long` (artefatos como `build/`, `.gradle/`,
  `node_modules/` estouram o limite de 260 caracteres). `safe-remove-worktree` já tenta uma remoção
  com prefixo de path longo nesse caso; se mesmo assim restar, ela sai não-zero citando o path
  residual. Reporte o path ao operador para remoção manual — não tente forçar via `rm -rf` por conta
  própria, o diretório pode conter uncommitted work relevante para inspeção.

Se invocado manualmente pelo usuário: pergunte antes de remover (a confirmação cobre worktree,
branch, status file e cache de arquivos tocados).

---

## Restrições

- Nunca faz push de código com testes falhando
- Nunca entra em loop de merge se review é necessário
- Máximo 3 iterações de fix de CI
- Preserva worktree intacto em caso de falha (para inspeção manual)
- As revisões do passo 8.5 são sempre consultivas — achados nunca bloqueiam o merge
- O circuit breaker de infraestrutura (§8.a) pausa sem consumir iterações de fix
