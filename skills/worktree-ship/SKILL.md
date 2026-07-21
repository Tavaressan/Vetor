---
name: worktree-ship
description: Pipeline headless de entrega — test → push → PR draft → CI → merge → sync root → cleanup. Deve ser executado de dentro de um worktree.
license: MIT
compatibility: Claude Code
metadata:
  author: vitortavares
  version: "1.1.0"
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

**Delegação opcional ao Gemini.** Leia `$CLAUDE_PLUGIN_ROOT/skills/shared/references/delegate-to-gemini.md` — se o CLI `agy` estiver disponível, use-o para resumir logs de CI antes de diagnosticar (§7).

**Branch default e comandos de teste.** Leia `$CLAUDE_PLUGIN_ROOT/skills/shared/references/project-conventions.md` — resolva `$DEFAULT_BRANCH` e o `module-test-map` conforme descrito lá. Use `$DEFAULT_BRANCH` em todos os comandos abaixo.

**Checagem e2e leve (opcional).** Se os módulos alterados (passo 3) envolverem UI/frontend, leia
`$CLAUDE_PLUGIN_ROOT/skills/shared/references/mcp-availability.md` (seção "Browser
(chrome-devtools)") e, se o MCP estiver disponível, use-o no passo 4 como checagem e2e leve
adicional aos testes automatizados — nunca como substituto deles.

---

## Comportamento

### 1 — Guarda de contexto

```bash
bash "$CLAUDE_PLUGIN_ROOT/scripts/vetor-checks.sh" in-worktree
```

Se sair não-zero, **aborte**: `/worktree-ship` deve rodar de dentro de um worktree (use
`/worktree-create` primeiro). Se passar, guarde a branch atual (`git branch --show-current`)
para os passos seguintes.

**Nota (cwd é responsabilidade de quem invoca).** Este comando nunca muda de diretório por conta
própria — quem o invoca a partir de um contexto diferente (ex.: o `issue-coordinator`, cujo
contexto é o root do repo) deve fazer `cd` para o path real do worktree do grupo **antes** de
chamar `/vetor:worktree-ship` (ver `issue-coordinator` Fase 6).

### 2 — Sincronizar com a branch default

Antes de rodar testes locais e fazer push, sincronize o worktree com o estado atual da branch
default — evita descobrir conflitos ou divergências só no merge final (passo 10), mais tarde e mais
caro de corrigir, especialmente com múltiplos worktrees sendo enviados em sequência na mesma sessão
(cenário típico do `issue-coordinator`):

```bash
git fetch origin "$DEFAULT_BRANCH"
git merge "origin/$DEFAULT_BRANCH"
```

Se houver conflito de merge aqui, resolva-o já (mesmo procedimento de resolução de conflitos do
passo 10, incluindo a regra de lockfiles) antes de prosseguir para os testes locais. Não prossiga
com testes contra uma base desatualizada.

### 2.b — Colisão de versão de migration (condicional)

Logo após o merge do passo 2 — **antes dos testes locais** — detecte colisões semânticas invisíveis
ao git entre workers paralelos (dois arquivos com a mesma versão de migration, sem conflito textual):

```bash
bash "$CLAUDE_PLUGIN_ROOT/scripts/vetor-checks.sh" migrations
```

Se sair não-zero, **pare** e mostre a saída (ela lista os arquivos e instrui a renumeração).
Projetos sem migrations versionadas: no-op. Mesma convenção Flyway do `guardian` §2.

### 3 — Detecção de módulos alterados

```bash
git diff "origin/$DEFAULT_BRANCH" --name-only
```

Mapeie os arquivos alterados aos módulos usando a tabela de detecção do module-test-map.

### 4 — Testes locais

Para cada módulo alterado, execute o comando headless correspondente do `module-test-map.md`.
Quando o comando do módulo for `sem suíte de testes`, não execute nada e registre
`skipped (no test suite)` no sumário; esse estado não bloqueia o ship.

**Regra sandbox:**
- Tente docker uma vez (se aplicável ao módulo, ex.: testes de integração)
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
bash "$CLAUDE_PLUGIN_ROOT/scripts/vetor-checks.sh" debug-scan "origin/$DEFAULT_BRANCH"
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

**Opcional (delegação ao Gemini):** para rascunhar o corpo do PR a partir do diff, ver
`delegate-to-gemini.md` §4. Se a chamada ao `agy` for **negada pelo classificador de permissão** do
ambiente (motivo típico: exfiltração de dados), **não retente** — use imediatamente o template inline
padrão (ver abaixo). Essa negação não é transiente; é uma política. Anexe `Closes #<issue#>` (se fornecida) 
e a nota do rodapé ao final.
Caso contrário (ou se negada), monte o `--body` com o template inline padrão:
```markdown
## Resumo
- <bullet points das mudanças principais, derivados dos commits>

## Módulos testados
- <lista de módulos testados e resultado>

## Issue relacionada
Closes #<issue#>

🤖 Desenvolvido com [Claude Code](https://claude.ai/code)
```

Crie o PR draft:
```bash
gh pr create \
  --title "<type>(<slug>): <resumo dos commits>" \
  --body "<descrição gerada e validada>" \
  --draft \
  --base "$DEFAULT_BRANCH"
```

### 7 — Monitorar CI

```bash
gh pr checks <PR-number> --watch
```

Timeout: 20 minutos. Se expirar, notifique e pare.

### 8 — Monitoramento de CI, Classificação de Erros e Loop de Fix (máximo 3 iterações)

Para cada falha detectada no monitoramento do CI:

1. **Classificação de Erro:**

   **8.a — Circuit Breaker de Infraestrutura (executa ANTES da análise de logs):**

   Antes de ler logs detalhados, verifique se a falha é de infraestrutura da plataforma
   (billing, outage, job not started) — cenário que nenhum fix de código resolve:

   ```bash
   deno run -A scripts/detect-infra-failure.ts <run-id>
   ```

   Se o script retornar exit 0 (saída JSON com `isInfrastructureFailure: true`):
   - **Pule inteiramente** as iterações de fix de código (§8.1 abaixo).
   - **Pare** e escreva o status file com `Status: BLOCKED_INFRA` e o motivo:
     ```markdown
     Status: BLOCKED_INFRA
     Motivo: Falha de infraestrutura da plataforma — <reason do script>.
     Ação necessária: resolver billing/outage no GitHub antes de retomar.
     ```
   - **Escale ao usuário** via AskUserQuestion:
     `⚠️ Falha de infraestrutura detectada no CI (billing/outage). Não é possível resolver com fix de código. Deseja aguardar a resolução ou prosseguir sem CI (merge manual)?`
   - **Pare.** Não consuma iterações de fix-loop.

   **8.b — Classificação de Erro (apenas se NÃO for infraestrutura):**
   Leia o log de erro do CI:
   ```bash
   gh run view <run-id> --log-failed
   ```
   **Opcional (economia de tokens):** use o agy CLI para condensar os logs, se disponível:
   ```bash
   echo "[Vetor:Gemini] Delegando tarefa: Condensando logs de CI do PR"
   gh run view <run-id> --log-failed | agy -p "Resuma a causa raiz das falhas neste log de CI em até 15 linhas, citando arquivo:linha quando houver."
   ```
   Se a chamada ao `agy` for **negada pelo classificador de permissão** do ambiente, **não retente** — leia 
   o log bruto diretamente e proceda à análise manual. Essa negação não é transiente; é uma política. 
   Avalie a natureza do erro:
   - **Erro Transiente (Rede/Timeout de Infraestrutura):** Se o erro for de conexão, falha de API externa temporária ou timeout do próprio runner do CI, **não altere o código**. Aguarde 30 segundos e dispare uma nova verificação ou re-run de testes via CLI (`gh run rerun <run-id>`). Use backoff exponencial de até 3 tentativas.
   - **Erro de Código (Lint/Compilação/Teste Falho):** Siga para o passo de correção abaixo.

2. **Loop de Fix:**
   - Identifique a causa raiz e aplique a alteração corretiva no worktree.
   - Faça o commit local: `fix: corrige <problema> no CI`
   - Execute o push: `git push origin <branch>`
   - Volte ao passo 7 (Monitorar CI).

Após 3 iterações completas de fix de código sem CI atingir verde:
```
FALHA: CI não passou após 3 tentativas de fix de código.
Último erro: <trecho do log>
Worktree preservado para inspeção manual.
```
**Pare.** Não tente mergear.

### 8.5 — Revisão de código nativa (consultiva, não bloqueante)

Substitui o antigo GitHub Action `code-review@claude-code-plugins` (desativado por custar por
execução independente do risco/tamanho da mudança). Roda **só quando há mudança real de
código-fonte** — o mesmo filtro do passo 3 já resolve isso: se `git diff "origin/$DEFAULT_BRANCH"
--name-only` (passo 3) não mapeou nenhum módulo (ex.: PR só de docs, lockfile ou config), **pule
este passo**.

Caso haja módulo alterado, despache o subagente nativo:

```javascript
Agent({
  description: "Code review: PR #<PR-number>",
  prompt: "PR #<PR-number>, branch <branch>, base $DEFAULT_BRANCH.",
  subagent_type: "vetor:code-review",
  model: "sonnet",
  run_in_background: false
})
```

O subagente é somente leitura sobre o código (nunca `push`/`commit`/`merge`) e publica os achados
como comentário na PR (`gh pr comment`). **Nunca pare o pipeline por causa dos achados** — mesmo
com itens `blocker`, prossiga para o passo 9. A revisão é consultiva: quem decide agir sobre um
achado é o humano, ao ler o comentário na PR (antes ou depois do merge).

Se o dispatch do subagente falhar por qualquer motivo (rate limit, erro de ferramenta), registre a
falha no sumário e prossiga mesmo assim — este passo nunca bloqueia o ship.

### 8.6 — Gate de segurança de aplicação (consultivo, não bloqueante, opcional)

Cobre segurança da *aplicação* (OWASP: injeção, XSS, segredos expostos etc.) — diferente do
`agents/code-review.md`, focado em bugs/correção/arquitetura, e do `safety-check.ts`/`guardian`,
focados em segurança *estrutural* do próprio Vetor. Roda no mesmo ponto do passo 8.5, só quando
houve módulo alterado (mesmo filtro).

Verifique se a skill nativa `security-review` está disponível nesta sessão (procure pelo nome entre
as skills carregáveis). **Se não estiver disponível, pule este passo silenciosamente** — é aditivo,
nunca bloqueia o fluxo.

Se disponível, invoque-a sobre o diff da PR (`gh pr diff <PR-number>`) e publique os achados como
comentário na PR, no mesmo formato consultivo do passo 8.5:

```bash
gh pr comment <PR-number> --body "<achados de security-review em markdown>"
```

**Nunca pare o pipeline por causa dos achados** — mesmo com vulnerabilidades reportadas, prossiga
para o passo 9. A decisão de agir é sempre humana, lendo o comentário na PR.

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

### 10 — Merge e Auto-Resolução de Conflitos

```bash
bash "$CLAUDE_PLUGIN_ROOT/scripts/vetor-merge.sh" <PR-number>
```

O script faz `gh pr ready` + `gh pr merge --squash --delete-branch` e verifica o estado real do PR
quando o `gh` sai não-zero (um erro de cleanup local da branch não é falha de merge):
- **exit 0** — PR mergeado. Siga direto para o passo 11.
- **exit 3** — merge não aconteceu. Entre no fluxo de resolução de conflitos abaixo.

**Se o comando for negado pela camada de permissões do Claude Code** (classificador de auto-mode,
motivo tipo "merge sem review") — barreira independente do `reviewDecision` já verificado no passo
9: **pare, peça aprovação explícita ao usuário via `AskUserQuestion`** e só repita após o "sim".
**Nunca** tente contornar a negação.

#### Se o merge falhar por conflito de branch com a branch default (exit 3):
1. Execute `git merge "$DEFAULT_BRANCH"` localmente no worktree.
2. Identifique os arquivos conflitantes usando:
   ```bash
   git diff --name-only --diff-filter=U
   ```
3. **Resolução de Conflitos em Lockfiles (KISS/YAGNI - §3.2)**: 
   Se houver arquivos de lock na lista de conflitos (ex: `deno.lock`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `Cargo.lock`, `poetry.lock`):
   - Roda `git checkout --theirs <lockfile-path>` para aceitar a versão da branch padrão e limpar os marcadores de conflito textuais.
   - Execute o instalador correspondente do projeto (ex: `deno install`, `npm install`, `pnpm install`, `cargo build`, `poetry lock --no-update`) para que o próprio gerenciador de pacotes regenere o lockfile de forma correta e reconciliada. O `runtime` gravado em `.claude/vetor/config.json` diz qual usar.
   - Adicione a resolução com `git add <lockfile-path>`.
3.b. **Resolução de Conflitos Aditivos em Listas (Múltiplos Workers Paralelos)**:
   Se houver conflitos **na mesma linha** de campos que concatenam ou agrupam itens de forma aditiva (ex.: 
   `"test"` e outros campos `"scripts"` em `package.json`, arrays JSON, ou strings que concatenam com 
   `&&`), e ambas as versões **só adicionam itens sem remover nada do outro lado**:
   - **Identifique o padrão:** Examine os dois lados do conflito (`<<<<<<<` ... `=======` ... `>>>>>>>`). 
     Se ambos expandem a lista sem truncar, aplique **união aditiva** em vez de escolher um lado.
   - **Exemplo concreto** (package.json):
     ```json
     <<<<<<< HEAD
     "scripts": {
       "test": "jest unit && npm run lint"
     }
     =======
     "scripts": {
       "test": "jest unit && npm run e2e"
     }
     >>>>>>> origin/master
     ```
     Resolução (unir ambas):
     ```json
     "scripts": {
       "test": "jest unit && npm run lint && npm run e2e"
     }
     ```
   - **Remova duplicatas:** Se o resultado contiver o mesmo comando duas vezes, mantenha apenas uma cópia.
   - **Adicione a resolução:** `git add <arquivo>`.
4. Para os demais arquivos de código conflitantes (que não sejam lockfiles nem listas aditivas puras), localize as seções com marcadores de conflito (`<<<<<<<`, `=======`, `>>>>>>>`), mescle logicamente as regras de negócio e remova os marcadores.
5. Execute os testes do módulo correspondente via `module-test-map`.
6. **Se os testes passarem:** Commite a resolução (`merge branch '$DEFAULT_BRANCH' and resolve conflicts`), faça `git push origin <branch>` e volte ao passo 7 (monitoramento do CI).
7. **Se os testes falharem:** Chame o `fix-loop-agent` localmente para corrigir o código. Se as iterações estourarem sem obter testes verdes, aborte o merge, preserve o worktree e alerte o usuário.

### 11 — Sincronizar root

Volte para o root do repositório e sincronize com a branch default. Descubra o path do root
(não assuma) e vá até ele:

```bash
ROOT=$(git rev-parse --path-format=absolute --git-common-dir | xargs dirname)
cd "$ROOT"
git checkout "$DEFAULT_BRANCH"
git pull origin "$DEFAULT_BRANCH"
```

(Só numa sessão manual em que você entrou no worktree com `EnterWorktree` é preciso sair com
`ExitWorktree` antes do `cd`; no fluxo orquestrado do `issue-coordinator`, sub-agentes nunca usam
`EnterWorktree`/`ExitWorktree`.)

Confirme:
```
Root sincronizado com <default-branch>. Branch <branch> mergeada e deletada remotamente.
```

### 12 — Cleanup

Descubra o path real do worktree via `git worktree list` (não assuma a convenção de path — a
localização é do harness). Se invocado pelo `issue-coordinator` (modo headless), execute o
cleanup automaticamente:
```bash
bash "$CLAUDE_PLUGIN_ROOT/scripts/vetor-checks.sh" safe-remove-worktree "<path-do-worktree>"
git branch -d <branch>
rm -f .claude/vetor/status/<branch>.md
rm -f .claude/vetor/status/<branch>-touched-files.json
```

Se a checagem falhar, **pare o cleanup**: ela encontrou um worktree ativo dentro do path alvo e
removê-lo apagaria também o filho. Mostre os paths listados e preserve o worktree pai, branch e
arquivos de status/cache até os filhos serem realocados ou removidos com segurança.

A última linha remove o cache de arquivos tocados gravado pelo `fix-loop-agent` (issue #81) — ele é
efêmero por branch/worktree e nunca deve persistir entre PRs.

Se invocado manualmente pelo usuário: pergunte antes de remover (a confirmação cobre worktree,
branch, arquivo de status e cache de arquivos tocados).

---

## Restrições

- Nunca faz push de código com testes falhando
- Nunca entra em loop de merge se review é necessário
- Máximo 3 iterações de fix de CI
- Preserva worktree intacto em caso de falha (para inspeção manual)
- A revisão de código nativa (passo 8.5) é sempre consultiva — achados nunca bloqueiam o merge
- **Circuit Breaker de Infraestrutura (§8.a):** distinto do circuit breaker de falhas
  recorrentes do `issue-coordinator` (§5.c). Este detecta falhas da *plataforma* CI
  (billing, outage, job not started) via anotações de job e pausa imediatamente sem
  consumir iterações de fix — o problema não é resolvível por alteração de código. O
  circuit breaker do `issue-coordinator` agrega múltiplos workers com falhas idênticas
  de código (padrão textual repetido) e pergunta se deve pausar ou prosseguir.
