---
name: worktree-ship
description: Pipeline headless de entrega — test → push → PR draft → CI → merge → sync root → cleanup. Deve ser executado de dentro de um worktree.
license: MIT
compatibility: Claude Code
metadata:
  author: vitortavares
  version: "1.0.0"
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

---

## Comportamento

### 1 — Guarda de contexto

Verifique se está dentro de um worktree:

```bash
git worktree list
```

Se o diretório atual for o root do repositório (e não um worktree em `.claude/worktrees/`):
```
ERRO: /worktree-ship deve ser executado de dentro de um worktree, não do root.
Use /worktree-create para criar um worktree primeiro.
```
**Aborte.**

Extraia a branch e o slug do worktree atual:
```bash
git branch --show-current
```

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

Colisão **semântica invisível ao git**: dois workers paralelos criam migrations com o mesmo número
de versão (`V13__a.sql` e `V13__b.sql`) — arquivos distintos, sem conflito textual, e testes locais
sem Docker não pegam. O ponto natural de detecção é **aqui**, logo após o merge do passo 2: o arquivo
já mergeado do outro worker passa a coexistir com o do worker atual.

Esta é uma variante focada e de *early-fail* da checagem de duplicatas do `guardian` (§2) — mesma
convenção Flyway (`V<N>__<descrição>.sql`, diretório `*/db/migration`), mas escopada ao momento do
sync e executada **antes dos testes locais**:

```bash
# colisão de versão de migration (convenção Flyway V<N>__*.sql; ver guardian §2)
git ls-files '*/db/migration/V*__*.sql' \
  | sed -E 's#.*/V([0-9]+)__.*#\1#' | sort | uniq -d
```

Se houver saída (um ou mais números duplicados), **pare antes dos testes locais**:
```
FALHA: colisão de versão de migration: V<N> usado por dois arquivos.
Renumere a migration deste worker para a próxima versão livre antes de prosseguir.
```
O padrão é descrito com Flyway como exemplo, mas aplica-se a qualquer convenção de versionamento
sequencial de arquivos. Se o projeto não usar migrations versionadas, a listagem sai vazia e o passo
é um no-op.

### 3 — Detecção de módulos alterados

```bash
git diff "$DEFAULT_BRANCH" --name-only
```

Mapeie os arquivos alterados aos módulos usando a tabela de detecção do module-test-map.

### 4 — Testes locais

Para cada módulo alterado, execute o comando headless correspondente do `module-test-map.md`.

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

### 4.b — Scan de Debugging (KISS Linting)

Antes de fazer o push, faça uma varredura estática rápida no diff em relação ao default branch buscando padrões temporários de depuração ou flags exclusivas de testes:
```bash
git diff "$DEFAULT_BRANCH" --name-only | xargs egrep -n "console\.log|var_dump|fit\(|fdescribe\(|it\.only" 2>/dev/null
```
Se encontrar qualquer padrão de debugging ou testes exclusivos (`it.only`, etc.), **remova-os automaticamente** ou corrija-os antes de realizar o push, mantendo o código limpo (KISS).

### 5 — Push

```bash
git push -u origin <branch>
```

Se falhar por rede, tente até 4 vezes com backoff exponencial (2s, 4s, 8s, 16s).

### 6 — Criar PR draft

Construa o título a partir dos commits:
```bash
git log "origin/$DEFAULT_BRANCH..HEAD" --oneline
```

#### Rascunho da Descrição do PR (Delegação ao Gemini):
Se o CLI `agy` estiver disponível (verifique via `command -v agy`):
1. Imprima o log: `echo "[Vetor:Gemini] Delegando tarefa: Rascunhando corpo do Pull Request"`
2. Execute o comando para gerar a descrição preliminar:
   ```bash
   git diff "origin/$DEFAULT_BRANCH"...HEAD | agy -p "Escreva uma descrição concisa e estruturada de Pull Request para este diff. Use markdown em PT-BR com seções: 'O que mudou' (tópicos curtos) e 'Como testar'."
   ```
3. O Claude valida a descrição gerada pelo Gemini, anexa `"Closes #<issue#>"` ao final (se `issue#` foi fornecida) junto com a nota `"🤖 Desenvolvido com [Claude Code](https://claude.ai/code)"` e usa o texto final no `--body`.

Se o agy não estiver disponível, monte o `--body` com o template inline padrão:
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
   Leia o log de erro do CI:
   ```bash
   gh run view <run-id> --log-failed
   ```
   **Opcional (economia de tokens):** use o agy CLI para condensar os logs, se disponível:
   ```bash
   echo "[Vetor:Gemini] Delegando tarefa: Condensando logs de CI do PR"
   gh run view <run-id> --log-failed | agy -p "Resuma a causa raiz das falhas neste log de CI em até 15 linhas, citando arquivo:linha quando houver."
   ```
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
gh pr ready <PR-number>
gh pr merge <PR-number> --squash --delete-branch
```

`gh pr merge` já é não-interativo quando invocado assim (sem prompt de confirmação) — a CLI atual
não possui uma flag `--yes`/`-y` de auto-confirmação (verificado com `gh pr merge --help`; passá-la
resulta em erro de flag desconhecida). Se uma versão futura da CLI introduzir prompts interativos
nesse comando, confirme as flags disponíveis com `gh pr merge --help` antes de ajustar.

#### Se `gh pr merge` sair com erro: confirme o estado real do PR primeiro

Um código de saída não-zero **não** significa necessariamente que o merge remoto falhou. Antes de
tratar o erro como conflito, verifique o estado real do PR:

```bash
gh pr view <PR-number> --json state,mergedAt,mergeCommit
```

- Se `state == MERGED` (com `mergedAt`/`mergeCommit` preenchidos): o merge remoto **teve sucesso**; o
  erro veio do cleanup **local** da branch — tipicamente `fatal: '<default>' is already used by
  worktree at ...`, que ocorre quando o root está na branch default enquanto worktrees paralelos
  existem. Trate como **sucesso** e siga direto para o passo 11.
- Só entre no fluxo de resolução de conflitos (subseção seguinte) se `state != MERGED`.

#### Se o merge falhar por conflito de branch com a branch default:
1. Execute `git merge "$DEFAULT_BRANCH"` localmente no worktree.
2. Identifique os arquivos conflitantes usando:
   ```bash
   git diff --name-only --diff-filter=U
   ```
3. **Resolução de Conflitos em Lockfiles (KISS/YAGNI - §3.2)**: 
   Se houver arquivos de lock na lista de conflitos (ex: `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `Cargo.lock`, `poetry.lock`):
   - Roda `git checkout --theirs <lockfile-path>` para aceitar a versão da branch padrão e limpar os marcadores de conflito textuais.
   - Execute o instalador correspondente do projeto (ex: `npm install`, `pnpm install`, `cargo build`, `poetry lock --no-update`) para que o próprio gerenciador de pacotes regenere o lockfile de forma correta e reconciliada.
   - Adicione a resolução com `git add <lockfile-path>`.
4. Para os demais arquivos de código conflitantes, localize as seções com marcadores de conflito (`<<<<<<<`, `=======`, `>>>>>>>`), mescle logicamente as regras de negócio e remova os marcadores.
5. Execute os testes do módulo correspondente via `module-test-map`.
6. **Se os testes passarem:** Commite a resolução (`merge branch '$DEFAULT_BRANCH' and resolve conflicts`), faça `git push origin <branch>` e volte ao passo 7 (monitoramento do CI).
7. **Se os testes falharem:** Chame o `fix-loop-agent` localmente para corrigir o código. Se as iterações estourarem sem obter testes verdes, aborte o merge, preserve o worktree e alerte o usuário.

### 11 — Sincronizar root

```bash
ExitWorktree
git checkout "$DEFAULT_BRANCH"
git pull origin "$DEFAULT_BRANCH"
```

Confirme:
```
Root sincronizado com <default-branch>. Branch <branch> mergeada e deletada remotamente.
```

### 12 — Cleanup

Se invocado pelo `issue-coordinator` (modo headless): execute cleanup automaticamente:
```bash
git worktree remove .claude/worktrees/<slug>
git branch -d <branch>
```

Se invocado manualmente pelo usuário: pergunte antes de remover.

---

## Restrições

- Nunca faz push de código com testes falhando
- Nunca entra em loop de merge se review é necessário
- Máximo 3 iterações de fix de CI
- Preserva worktree intacto em caso de falha (para inspeção manual)
