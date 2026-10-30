---
name: ship
description: Pipeline desacoplado de entrega — suporta --prepare (validação, push, PR draft, CI e revisões em background), --finalize (verificação, squash merge, sync root e cleanup) e modo monolítico sequencial legado. Deve ser executado de dentro de um worktree.
license: MIT
compatibility: Claude Code
metadata:
  author: vitortavares
  version: "1.3.0"
---

Você é o pipeline de entrega do Vetor. Sua missão é levar código testado e verde de um worktree até o merge na branch default, de forma modular e desacoplada em duas etapas (--prepare e --finalize) ou no fluxo sequencial legado de ponta a ponta.

---

## Sintaxe

```
/vetor:ship [--prepare [issue#] | --finalize <PR-number> | [issue#]]
```

- `--prepare [issue#]`: submodo de preparação concorrente (Pre-Ship) — executa validações locais (§1 a §4.b), push da branch (§5), criação de PR draft (§6), disparo em background de CI (§7) e revisões consultivas (§8.5), grava status `PR_STAGED` com o número/URL da PR (§8.7) e encerra sem tentar merge.
- `--finalize <PR-number>`: submodo de finalização (Fast Merge Gate) — verifica CI (§7 e §8) e reviews (§8.5–§9), executa squash merge via `vetor-merge.sh` (§10), sincroniza root determinístico (§11) e executa cleanup do worktree (§12).
- `[issue#]`: execução sequencial monolítica completa legada (passos 1 a 12), mantendo 100% de retrocompatibilidade.

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

### 0 — Validação de argumentos e seleção de modo

```bash
read -r SHIP_MODE SHIP_TARGET < <(bash "$SKILL_DIR/../../scripts/vetor-checks.sh" validate-ship-args "$@")
```

De acordo com `SHIP_MODE`:
- `prepare`: executa os passos 1 a 6, o disparo de CI (§7) e revisões consultivas (§8.5) em background, grava status `PR_STAGED` (§8.7) e encerra com exit 0 sem tentar merge.
- `finalize`: `SHIP_TARGET` contém o `<PR-number>`. Pula os passos 2 a 6 e executa estritamente a verificação de CI (§7 e §8), verificação de reviews (§8.5–§9), squash merge via `vetor-merge.sh` (§10), sincronização do root (§11) e cleanup (§12).
- `full` (modo padrão legado, sem flags): executa o ciclo sequencial completo dos passos 1 a 12 de ponta a ponta. Se `SHIP_TARGET` estiver preenchido, ele representa a issue GitHub a ser referenciada em `Closes #N`.

### 1 — Guarda de contexto

```bash
bash "$SKILL_DIR/../../scripts/vetor-checks.sh" in-worktree
```

Se sair não-zero, **aborte**: `/vetor:ship` deve rodar de dentro de um worktree (use
`/vetor:worktree-create` primeiro). Se passar, guarde a branch atual (`git branch --show-current`).

**Exceção — `--finalize <PR>` sem worktree local (issue #527).** Se a guarda falhar e o modo for
`finalize`, não aborte: resolva a branch do PR (`gh pr view <PR> --json headRefName -q .headRefName`),
confirme que nenhum worktree local a usa e recrie-o a partir da branch remota com o primitivo
`/vetor:worktree-create --from-branch <headRefName>`. Entre nele e siga para o passo 7. Se a criação
falhar, aborte com o motivo. O PR sobreposto a outro já integrado é re-sincronizado e re-testado
conforme o Fast Merge Gate antes do merge.

Este comando **nunca muda de diretório por conta própria** — quem o invoca de outro contexto (ex.:
`coordinator`, cujo cwd é o root) deve fazer `cd` para o worktree antes.

*(Se `SHIP_MODE` for `finalize`, pule diretamente para o passo 7).*

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

Conte e leia os assuntos dos commits próprios, excluindo merge commits (inclusive merges de sincronização do passo 2):
```bash
git log --no-merges --format=%s "origin/$DEFAULT_BRANCH..HEAD"
```

Se houver exatamente um assunto, ele não estiver vazio e não contiver caracteres de controle (U+0000–U+001F ou U+007F), use o assunto literalmente como título, sem prefixo ou escopo derivado do slug. Em qualquer outro caso (zero ou vários assuntos, ou assunto vazio/com controle), use o template atual `<type>(<slug>): <resumo dos commits>`. Se o assunto único for inválido, inclua um aviso no sumário indicando o fallback. Não trunque o título e não tente outro título silenciosamente: se `gh pr create` rejeitar o título, pare e reporte o erro explícito. O corpo do PR ainda pode usar a listagem dos commits:

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

Anexe `Closes #<issue#>` (ou uma linha `Closes #N` por issue do grupo; use `Refs #N` se a issue não deve ser fechada automaticamente, issue #338). Grave o corpo num arquivo temporário e passe via `--body-file`, evitando corrupção de backticks e caracteres especiais pelo shell (issue #334):
```bash
gh pr create \
  --title "<type>(<slug>): <resumo dos commits>" \
  --body-file "<path-do-arquivo-de-corpo>" \
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

**Em `--prepare`:** não bloqueie aguardando conclusão do CI. Realize apenas o trigger ou verificação inicial:
```bash
gh pr checks <PR-number> >/dev/null 2>&1 || true
```
e siga diretamente para o passo 8.5.

**Em `full` e `--finalize`:** execute o monitoramento bloqueante:
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

*(Executado em `full` e `--finalize` caso algum check remoto falhe).*

Para cada falha detectada:

Verifique se a falha possui `run-id` do GitHub Actions (`gh pr checks <PR-number> --json name,link,state`).

**8.a — Falha em check externo sem run-id (Vercel, Netlify etc. — issue #340)**

Para provedores de deploy e checks externos sem execução do GitHub Actions:
1. Identifique o check externo: extraia link e descrição de erro no `gh pr checks`.
2. Se a CLI do provedor (ex.: `npx vercel inspect <id> --logs`) estiver instalada e autenticada, consulte os logs; caso contrário, solicite o trecho de erro ao operador via `AskUserQuestion`.
3. Dica: se o build passa localmente mas falha no provedor externo, teste remover temporariamente o `.env.local` para reproduzir ausência de variáveis de ambiente.
4. Para retentar o check externo após ajuste, faça um commit vazio e envie:
   `git commit --allow-empty -m "ci: retry external check" && git push origin <branch>`, e volte ao passo 7.

**8.b — Circuit breaker de infraestrutura (GitHub Actions com run-id)**

```bash
deno run -A scripts/detect-infra-failure.ts <run-id>
```

Se retornar exit 0 (JSON com `isInfrastructureFailure: true`), nenhum fix de código resolve:
- **Pule** inteiramente as iterações de fix (§8.c).
- Escreva o status file:
  ```markdown
  Status: BLOCKED_INFRA
  Motivo: Falha de infraestrutura da plataforma — <reason do script>.
  Ação necessária: resolver billing/outage no GitHub antes de retomar.
  ```
- **Escale** via `AskUserQuestion`: `⚠️ Falha de infraestrutura detectada no CI (billing/outage). Não é possível resolver com fix de código. Deseja aguardar a resolução ou prosseguir sem CI (merge manual)?`
- **Pare.** Não consuma iterações de fix-loop.

**8.c — Erro de código (só se não for infraestrutura)**

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

Roda **só quando há mudança real de código-fonte**. **Pule este passo inteiro** em qualquer um
destes casos:

- o passo 3 não mapeou nenhum módulo;
- todos os arquivos alterados são `.md` em `docs/**` ou `wiki/**`, `*.md` na raiz do repositório
  (ex.: `README.md`, `CHANGELOG.md`) ou lockfiles (`*.lock`, `package-lock.json`, `deno.lock`) —
  checagem própria, independente do passo 3, porque um módulo catch-all `./` casa qualquer arquivo.

Arquivos que não são `.md` dentro de `docs/`/`wiki/` (ex.: JS de site, `conf.py`), `.md` fora
desses caminhos (ex.: `SKILL.md`, agentes) e configs que executam comandos (hooks, workflows de CI)
não entram na exceção.

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

2. **Security review** (segurança da aplicação — OWASP: injeção, XSS, segredos expostos): verifique
   se a skill nativa `security-review` está disponível nesta sessão. **Se não estiver, pule
   silenciosamente.** Se estiver, invoque-a conforme §8.6 abaixo.

**Comportamento por modo:**
- **Em `--prepare`:** os subagentes consultivos são despachados em background. Não aguarde o retorno da análise: prossiga imediatamente para o passo 8.7 para registrar `PR_STAGED` e encerrar.
- **Em `full`:** aguarde a notificação de conclusão deste subagente (bloqueante-leve) antes de prosseguir para o passo 9.
- **Em `--finalize`:** verifique se os relatórios consultivos foram postados como comentários na PR antes do merge.

**Nunca pare o pipeline por causa dos achados** — mesmo com itens `blocker` ou vulnerabilidades,
os achados são consultivos; quem decide agir é o humano, lendo o comentário na PR. Se um dos despachos
falhar (rate limit, erro de ferramenta), registre no sumário e prossiga.

### 8.6 — Security review (skill nativa)

A skill nativa `security-review` **não publica comentário sozinha**: seu contrato de saída é
"a resposta final deve conter o relatório em markdown e nada mais". Quem invoca (você, executando
o `ship`) é responsável por publicar esse relatório na PR no turno seguinte à resposta.

Além disso, a skill monta o próprio contexto sozinha (git status, arquivos modificados, commits,
diff da branch atual) a partir de `origin/HEAD` — **não** passe `gh pr diff <PR-number>` como
argumento; ela ignora diffs passados por fora e lê a branch diretamente.

**Pré-condição de `origin/HEAD` (issue #410):** a montagem do contexto da skill falha (`fatal: ambiguous argument 'origin/HEAD...'`)
se a referência remota simbólica `refs/remotes/origin/HEAD` não estiver configurada no clone (comum em clones antigos
ou criados por ferramentas sem detecção automática do HEAD remoto). Antes de invocá-la:

```bash
if ! git rev-parse --verify -q origin/HEAD >/dev/null; then
  git remote set-head origin -a 2>/dev/null || true
fi
```

Se `git rev-parse --verify -q origin/HEAD` continuar falhando após a tentativa (ex.: repositório sem conexão ou sem remote configurado),
**não invoque a skill**: registre no sumário de ship que a revisão de segurança foi pulada por falta de `origin/HEAD` e prossiga.

Caso o ponteiro esteja válido:
```
Invoque a skill nativa `security-review` sem argumento de diff — ela lê a branch atual.
```

Ao receber a resposta final (o relatório em markdown), publique-o, com a primeira linha
`## Security Review (Vetor)` (é o cabeçalho que o gate `reviews` da entrega autônoma em `--headless`
procura, issue #497):
```bash
gh pr comment <PR-number> --body "## Security Review (Vetor)

<relatório de security-review recebido>"
```

### 8.7 — Registro de PR_STAGED e encerramento do Pre-Ship

*(Executado estritamente em `--prepare`).*

Logo após disparar o CI (§7) e as revisões consultivas (§8.5) em background, obtenha os dados da PR:
```bash
PR_NUMBER=$(gh pr view --json number -q .number)
PR_URL=$(gh pr view --json url -q .url)
HEAD_SHA=$(git rev-parse HEAD)
BRANCH=$(git branch --show-current)
REPO_ROOT=$(bash "$SKILL_DIR/../../scripts/vetor-checks.sh" repo-root)
```

1. Atualize o status file `<REPO_ROOT>/.claude/vetor/status/<branch com / trocada por ->.md`:
```markdown
# Agent Status — <branch>
Updated: <ISO 8601>
Status: PR_STAGED
PR: #<PR_NUMBER> (<PR_URL>)
Last action: Pre-ship concluído (PR draft #<PR_NUMBER> criado, CI e revisões consultivas disparados em background)
Next: Aguardando checks de CI e revisões consultivas para finalização via /vetor:ship --finalize <PR_NUMBER>
```

2. Grave os metadados do Pre-Ship em `<REPO_ROOT>/.claude/vetor/status/<branch com / trocada por ->-preship.json`:
```bash
cat <<EOF > "$REPO_ROOT/.claude/vetor/status/${BRANCH//\//-}-preship.json"
{
  "branch": "$BRANCH",
  "prNumber": $PR_NUMBER,
  "prUrl": "$PR_URL",
  "headSha": "$HEAD_SHA",
  "stagedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "ciStatus": "PENDING",
  "reviewsStatus": "PENDING"
}
EOF
```

3. Exiba o resumo de conclusão:
```
Pre-ship concluído com sucesso.
PR Draft: #<PR_NUMBER> (<PR_URL>)
Status registrado: PR_STAGED
Pronto para Fast Merge Gate (/vetor:ship --finalize <PR_NUMBER>).
```
**Encerre o pipeline aqui com exit 0 sem tentar merge.**

### 9 — Verificar review

*(Executado em `full` e `--finalize`).*

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

*(Executado em `full` e `--finalize`).*

```bash
bash "$SKILL_DIR/../../scripts/vetor-merge.sh" <PR-number>
```

O script faz `gh pr ready` + `gh pr merge --squash --delete-branch`, passando `--subject` e
`--body` do PR (garantindo que o corpo do PR seja a única fonte autoritativa de fechamento de issues
no squash, issue #338). Se a branch base do PR tem **merge queue** ativa (detectada pela API do
GitHub, issue #495), usa `--auto` em vez de `--delete-branch` (o `gh` recusa essa combinação);
`vetor-merge.sh --auto <PR>` força o auto-merge. Em todos os casos confirma o **estado real do PR**
depois do `gh` (o exit do `gh` sozinho não prova merge: `--auto` e a merge queue saem com 0 ao
*enfileirar*) e, em caso de merge no remoto com falha apenas no cleanup local, apaga a branch remota
explicitamente (issue #325):
- **exit 0** — PR **mergeado** e branch remota verificada/removida. Siga para o passo 11.
- **exit 4** — PR **enfileirado** (auto-merge/merge queue): o PR continua OPEN e o GitHub conclui o
  squash merge quando os requisitos liberarem. **Não é merge concluído**: não rode o passo 11 nem o
  12 (a branch ainda não foi integrada; `delete-merged-branch` e `safe-remove-worktree` apagariam
  trabalho que o GitHub ainda vai integrar). Grave `Last action: PR #<N> enfileirado` no status file,
  preserve worktree, branch e status, reporte o PR como `Enfileirado` e encerre sem polling. O cleanup
  ocorre numa próxima sessão, quando `vetor-status.sh` mostrar `GREEN (já mergeado via #<N>)`.
- **exit 3** — merge não aconteceu. Rode `git merge "$DEFAULT_BRANCH"` localmente no worktree e siga
  `../shared/references/conflict-resolution.md`. Resolvido e verde, volte ao
  passo 7.

**Se o comando for negado pela camada de permissões do Claude Code** (classificador de auto-mode,
motivo tipo "merge sem review") — barreira independente do `reviewDecision` do passo 9: **pare, peça
aprovação explícita via `AskUserQuestion`** e só repita após o "sim". **Nunca** contorne a negação.
Quando invocado pela entrega autônoma do coordinator em `--headless` (Fase 6.d) não há a quem
perguntar: **não use `AskUserQuestion`**, registre a negação no retorno e deixe o PR aberto.

### 11 — Sincronizar root

*(Executado em `full` e `--finalize`, exceto quando o §10 saiu com exit 4 — PR apenas enfileirado).*

```bash
bash "$SKILL_DIR/../../scripts/vetor-checks.sh" sync-root
```

Volta ao root e sincroniza com a branch default. Se o root já estiver na branch default, faz
`git fetch` e `git merge --ff-only` com `origin/<default>` para evitar defasagem entre ondas de dispatch
(issue #322). (Só numa sessão manual em que você entrou no worktree com `EnterWorktree` é preciso sair
com `ExitWorktree` antes.) Confirme pela mensagem de sucesso.

**Divergência da branch default (issue #409):** se o `sync-root` reportar `AVISO: root em <default> divergiu de origin/<default>.`, a causa típica é a configuração inicial do Vetor (`config.json`, `module-test-map.md`) ter sido commitada na branch default local sem push prévio antes do dispatch. Quando o GitHub squash-mergeou a PR, gerou um commit remoto com outro hash, fazendo a default local divergir. Para reconciliar de forma segura quando as mudanças já foram integradas no remoto:
```bash
git fetch origin "$DEFAULT_BRANCH"
git reset --hard "origin/$DEFAULT_BRANCH"
```

### 12 — Cleanup

*(Executado em `full` e `--finalize`, exceto quando o §10 saiu com exit 4 — PR apenas enfileirado).*

Descubra o path real do worktree via `git worktree list` (não assuma convenção de path — a
localização é do harness). No Windows, manter o cwd da sessão dentro do worktree bloqueia a exclusão
do diretório com `Permission denied` (issue #411). Mude para o repositório principal antes de
disparar a remoção. Se invocado pelo `coordinator` (modo headless), execute automaticamente:
```bash
cd "$(bash "$SKILL_DIR/../../scripts/vetor-checks.sh" repo-root)"
bash "$SKILL_DIR/../../scripts/vetor-checks.sh" safe-remove-worktree "<path-do-worktree>"
bash "$SKILL_DIR/../../scripts/vetor-checks.sh" delete-merged-branch "<branch>"
bash "$SKILL_DIR/../../scripts/vetor-checks.sh" clean-status "<branch>"
```

Se a checagem falhar, **pare o cleanup** e não prossiga com `git branch -d`/remoção dos arquivos de
status/cache — há dois motivos distintos de falha:

- **Worktree filho ativo dentro do path alvo**: mostre os paths e preserve worktree pai, branch e
  arquivos de status/cache até os filhos serem realocados.
- **Diretório residual em disco após `git worktree remove`** (issues #157, #324, #411): o `git worktree remove`
  desregistrou o worktree do git (não aparece mais em `git worktree list`) mas falhou ao apagar o
  diretório — no Windows, por `Filename too long`, por `Permission denied` transitório ou porque o processo
  ainda está com o cwd dentro dele (issue #411). `safe-remove-worktree` reconsulta o git: como o worktree
  já foi desregistrado, tenta a remoção segura do resíduo (inclusive com prefixo de path longo `\\?\`);
  se mesmo assim restar, ela diagnostica a causa (incluindo se o cwd da sessão impediu a exclusão) e sai
  não-zero citando o path residual para remoção manual, sem alegar falsamente uncommitted work (issue #324).

- **Remoção segura de branch e status**:
  - `delete-merged-branch <branch>` apaga a branch local apenas se confirmada como `MERGED` no GitHub
    ou se sua árvore for idêntica à branch default, contornando a recusa de `git branch -d` para squash
    e sem acionar o bloqueio incondicional de `-D` (issue #341).
  - `clean-status <branch>` normaliza o nome da branch (`/` substituída por `-`) e apaga o status `.md`,
    a sentinela `.md.stopguard` e o cache `-touched-files.json` (issue #344).

Se invocado manualmente pelo usuário: pergunte antes de remover (a confirmação cobre worktree,
branch, status file e cache de arquivos tocados). Lembre-se de mudar para o root (`cd "$(bash "$SKILL_DIR/../../scripts/vetor-checks.sh" repo-root)"`) antes de executar `safe-remove-worktree`.

---

## Restrições

- Nunca faz push de código com testes falhando
- Nunca entra em loop de merge se review é necessário
- Máximo 3 iterações de fix de CI
- Preserva worktree intacto em caso de falha (para inspeção manual)
- As revisões do passo 8.5 são sempre consultivas — achados nunca bloqueiam o merge
- O circuit breaker de infraestrutura (§8.a) pausa sem consumir iterações de fix
- O submodo `--prepare` encerra no passo 8.7 com status `PR_STAGED` e nunca tenta merge
- O submodo `--finalize` exige `<PR-number>` válido e executa os passos 7 a 12
- `vetor-merge.sh` com exit 4 (PR enfileirado) não é merge concluído: pula os passos 11 e 12
