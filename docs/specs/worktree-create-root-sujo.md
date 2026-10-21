---
id: spec:worktree-create-root-sujo
type: spec
project: Vetor
status: draft
created: 2026-10-21
updated: 2026-10-21
---
# Levar mudanças rastreadas do root ao worktree

## Summary

Definir o comportamento de `worktree-create` quando o root contém mudanças rastreadas não commitadas. Por padrão o fluxo aborta antes de qualquer atualização do root; com a opção explícita `--carry-changes`, as mudanças são levadas ao novo worktree sem risco de perda, e o root fica limpo para o `sync-root` do `ship`.

## Context

**Fatos verificados:** `worktree-create` atualmente executa `git pull` e depois cria o worktree da branch default, sem checar estado sujo nem transportar alterações (`skills/worktree-create/SKILL.md:76-91`). Seu contrato é headless e todos os parâmetros vêm dos args (`skills/worktree-create/SKILL.md:3,137-142`). O `sync-root` recusa sincronizar quando `git diff-index --quiet HEAD --` detecta alterações e informa que não sincronizará (`scripts/vetor-checks.sh:236-239`); `ship` o chama após o merge (`skills/ship/SKILL.md:384-393`).

**Contexto da issue:** no caso relatado, alterações rastreadas feitas no root foram levadas manualmente por patch ao worktree, mas cópias remanescentes no root impediriam o `sync-root` posterior.

**Decisões do mantenedor (2026-10-21):** transporte opt-in via `--carry-changes`; um único patch (staged e unstaged juntos); capacidade restrita à invocação standalone do `worktree-create`. Ver "Decisions".

## Goals

- Definir um caminho suportado para iniciar trabalho em worktree a partir de mudanças rastreadas já editadas no root.
- Nunca rodar `git pull` com o root sujo.
- Evitar perda silenciosa de alterações e deixar o root apto a sincronizar após a entrega.

## Non-Goals

- Transportar arquivos não versionados ou ignorados; o escopo limita-se a mudanças rastreadas.
- Preservar a separação entre staged e unstaged no worktree.
- Automatizar resolução de conflitos de conteúdo entre as mudanças locais e a branch default atualizada.
- Alterar a política geral de `sync-root` para aceitar árvore suja.
- Transportar mudanças do root no fluxo do `coordinator` (worktrees criados pelo harness).

## Users / Personas

- Desenvolvedor que editou arquivos no root e quer continuar a entrega pelo fluxo worktree + ship, invocando `/vetor:worktree-create` diretamente.
- Skill `worktree-create` no uso standalone; a criação via coordinator ocorre pelo harness (`skills/worktree-create/SKILL.md:112-114`) e fica fora do escopo.

## Functional Requirements

### RF-01 - Detectar alterações rastreadas antes da atualização do root

**Priority:** Must

**Description:** Antes de qualquer `git pull` ou `git fetch` no root, o fluxo deve detectar alterações rastreadas não commitadas (mesma condição do `sync-root`: `git diff-index --quiet HEAD --`) e decidir o caminho conforme a presença de `--carry-changes`.

**Acceptance Criteria:**

- [ ] Com alterações rastreadas no root e sem `--carry-changes`, o fluxo termina antes de `git pull` e de `git worktree add`, com mensagem que cita `--carry-changes` e lista os arquivos alterados (só nomes).
- [ ] Com root limpo, o caminho existente (`git pull` + `git worktree add`) permanece inalterado, com ou sem `--carry-changes`.

**Happy Path:**

1. O usuário invoca a criação do worktree.
2. O fluxo verifica alterações rastreadas no root antes de atualizar a branch default.
3. Se houver alterações, prossegue apenas com `--carry-changes`.

**Alternative Flows:**

- Root limpo: segue o fluxo normal.
- Root sujo sem `--carry-changes`: aborta sem executar pull.

### RF-02 - Transportar alterações rastreadas sob `--carry-changes`

**Priority:** Must

**Description:** Com `--carry-changes`, as alterações rastreadas do root em relação a `HEAD` são capturadas num único patch, aplicadas no worktree criado e, só depois de verificadas, removidas do root.

**Acceptance Criteria:**

- [ ] A captura usa um único patch do estado rastreado total em relação a `HEAD` (`git diff HEAD --binary`); no worktree tudo chega como alteração não staged, e o fluxo informa que a separação staged/unstaged não foi preservada.
- [ ] Antes de limpar o root, o patch é salvo em `.claude/vetor/carry/<branch com / trocada por ->.patch`, e `.claude/vetor/carry/` é coberto pelo `.gitignore`.
- [ ] A limpeza do root só ocorre depois de verificar que o diff do worktree em relação ao seu `HEAD` é equivalente ao patch capturado (ex.: mesmo `git patch-id --stable`).
- [ ] A limpeza restaura ao estado de `HEAD` apenas os arquivos presentes no patch (incluindo retirar do índice e do disco arquivos novos que estavam staged); nenhum outro arquivo do root é tocado.
- [ ] Se a aplicação ou a verificação não for concluída integralmente, o fluxo não remove as mudanças do root e informa a etapa que falhou e o estado do worktree.
- [ ] Após transporte bem-sucedido, `git diff-index --quiet HEAD --` no root passa, de modo que o `sync-root` do `ship` não recusa (`scripts/vetor-checks.sh:236-239`).

**Happy Path:**

1. O usuário invoca `/vetor:worktree-create <type> <slug> [issue#] --carry-changes`.
2. O fluxo captura o patch e cria o worktree conforme RF-03.
3. O patch é aplicado no worktree e verificado.
4. O backup é gravado e o root é limpo, apenas depois da verificação.

**Alternative Flows:**

- Aplicação parcial ou conflito: tratado em RF-04.

### RF-03 - Base do worktree quando há transporte

**Priority:** Must

**Description:** Com `--carry-changes`, o root sujo nunca recebe `git pull`. O fluxo atualiza só a referência remota e cria o worktree a partir dela.

**Acceptance Criteria:**

- [ ] O fluxo roda `git fetch origin "$DEFAULT_BRANCH"` (não altera a árvore de trabalho do root) e `git worktree add -b <branch> <path> "origin/$DEFAULT_BRANCH"`.
- [ ] O patch é aplicado no worktree com `git apply --3way`, para tolerar diferenças entre o `HEAD` local do root e `origin/$DEFAULT_BRANCH`.
- [ ] Se o `git fetch` falhar, segue a regra atual de usar a branch default local com aviso (`skills/worktree-create/SKILL.md:86-89`), mantendo a garantia de não perder mudanças no root.

### RF-04 - Conflito ao aplicar o patch

**Priority:** Must

**Description:** Se o patch não aplicar de forma limpa no worktree, o fluxo aborta sem tocar no root.

**Acceptance Criteria:**

- [ ] O root fica intacto (nenhuma limpeza ocorre) e o fluxo lista os arquivos em conflito.
- [ ] O worktree e a branch recém-criados, ainda sem commits próprios, são removidos com `vetor-checks.sh safe-remove-worktree` e `vetor-checks.sh delete-merged-branch`.
- [ ] A mensagem orienta resolver manualmente (ex.: commitar no root numa branch própria ou ajustar as mudanças) e repetir a criação.

## Non-Functional Requirements

### RNF-01 - Segurança contra perda de dados

**Priority:** Must

**Description:** O fluxo deve preservar as alterações originais até que sua transferência ao worktree esteja confirmada.

**Acceptance Criteria:**

- [ ] Nenhuma falha de fetch, criação do worktree, aplicação ou verificação apaga as únicas cópias das alterações rastreadas.
- [ ] A operação não afeta arquivos não rastreados ou ignorados.
- [ ] O backup em `.claude/vetor/carry/` permanece após o sucesso (não é removido automaticamente).

### RNF-02 - Não expor o conteúdo do patch

**Priority:** Must

**Description:** O conteúdo das mudanças pode conter segredos colados por engano; o fluxo não deve imprimi-lo.

**Acceptance Criteria:**

- [ ] Saídas e mensagens de erro mostram apenas nomes de arquivo, contagens e o resultado de cada etapa, nunca o conteúdo do patch.

## Behavior / States

- Root limpo: criação segue o fluxo atual.
- Root sujo sem `--carry-changes`: interrompido antes do pull.
- Root sujo com `--carry-changes`: fetch → worktree a partir de `origin/<default>` → apply `--3way` → verificação → backup → limpeza do root. Em falha, alterações originais permanecem no root.
- Após o merge, o root (limpo, possivelmente atrás de `origin/<default>`) é avançado pelo `sync-root` do `ship` por fast-forward.

## Data

- Patch do estado rastreado em relação a `HEAD` no root (`git diff HEAD --binary`).
- Backup em `.claude/vetor/carry/<branch>.patch` (gitignored).
- Path e branch do worktree recém-criado, conforme contrato atual (`skills/worktree-create/SKILL.md:51-56`).

## Integrations / Dependencies

- Git: `diff-index`, `diff`, `fetch`, `worktree add`, `apply --3way`, `patch-id`, `restore`.
- `sync-root` em `scripts/vetor-checks.sh`, chamado pelo `ship` após merge (`skills/ship/SKILL.md:384-393`).
- `safe-remove-worktree` e `delete-merged-branch` em `scripts/vetor-checks.sh` para o caminho de conflito.
- `skills/shared/references/issue-coordinator-dispatch.md`: documentar que o transporte não se aplica aos worktrees criados pelo harness.

## Edge Cases

- Fetch falha: usar a branch default local com aviso (RF-03).
- Worktree já existe ou `git worktree add` falha: não limpar as alterações do root; já é condição de aborto (`skills/worktree-create/SKILL.md:58-75,91`).
- Patch conflita com a base atualizada: RF-04.
- Alterações staged e unstaged no mesmo arquivo: entram juntas no patch único; no worktree o arquivo fica com o conteúdo final, não staged.
- Arquivo novo apenas staged (não existe em `HEAD`): entra no patch; na limpeza, sai do índice e do disco do root.
- Root numa branch diferente da default: o patch é capturado contra o `HEAD` dessa branch e aplicado com `--3way` sobre `origin/<default>`; conflitos caem em RF-04.

## Error Handling

Falhas indicam a etapa (detecção, fetch, criação, aplicação, verificação ou limpeza), se o worktree foi criado e se o root continua preservado. Nenhuma falha de transporte é tratada como sucesso silencioso.

## Security / Privacy

O patch contém apenas arquivos rastreados locais e fica num backup local gitignored. Nenhuma saída imprime seu conteúdo (RNF-02).

## Rollout

Nova opção `--carry-changes` no contrato de `worktree-create` (sintaxe e §4), mais a entrada `.claude/vetor/carry/` no `.gitignore` e a nota de limitação na referência de dispatch do coordinator. Sem a opção, o único comportamento novo é abortar antes do pull quando o root está sujo.

## Open Questions

Nenhuma pendente. Resolvidas em 2026-10-21:

- Mecanismo: opção explícita `--carry-changes` (não só procedimento documentado).
- Staged vs unstaged: patch único; separação não preservada.
- Limpeza segura: backup + verificação por `patch-id` + restauração só dos arquivos do patch.
- Coordinator/harness: fora do escopo; limitação documentada.
- Conflitos: abortar com root intacto e remover o worktree recém-criado.
- Segredos em logs: só nomes de arquivo.

## Decisions

- **Decidido (mantenedor, 2026-10-21):** transporte opt-in via `--carry-changes`; sem a opção, root sujo aborta antes do pull. Motivo: o contrato do skill é headless (`skills/worktree-create/SKILL.md:3,137-142`) e limpar o root sem pedido explícito pode perder trabalho.
- **Decidido (mantenedor, 2026-10-21):** um único patch `git diff HEAD`, sem preservar a separação staged/unstaged. Motivo: menos pontos de falha.
- **Decidido (mantenedor, 2026-10-21):** capacidade restrita à invocação standalone; o coordinator usa worktrees do harness.
- **Decidido:** escopo limitado a arquivos rastreados (delimitação da issue #428).
- **Decidido:** com transporte, usar `git fetch` + worktree a partir de `origin/<default>` em vez de `git pull` no root sujo.

## References

- `skills/worktree-create/SKILL.md:3,51-91,112-114,137-142` — contrato headless, validação/conflitos, atualização, criação e criação via harness.
- `skills/ship/SKILL.md:384-393` — sincronização do root após merge.
- `scripts/vetor-checks.sh:221-240` — condição que faz `sync-root` recusar root sujo.
- `skills/shared/references/issue-coordinator-dispatch.md:51-58` — sync-root pode recusar alterações não commitadas do root.
- Issue #428 — relato e proposta de transporte opcional de mudanças rastreadas.

## Revision History

| Data | Autor | Mudança |
|------|-------|---------|
| 2026-10-21 | /vetor:spec (delegado via Alethe/Codex) | Rascunho inicial da Spec para issue #428. |
| 2026-10-21 | /vetor:spec (coordinator + mantenedor) | Pontos ABERTO resolvidos com decisões do mantenedor; RF-03 (base do worktree) e RF-04 (conflito) e RNF-02 (conteúdo do patch) adicionados; frontmatter via `create-spec`. |
