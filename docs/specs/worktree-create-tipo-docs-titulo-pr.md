---
id: spec:worktree-create-tipo-docs-titulo-pr
type: spec
project: Vetor
status: draft
created: 2026-10-21
updated: 2026-10-21
---
# Tipos `docs`/`test`/`ci` e título de PR derivado do commit

## Summary

Ampliar os tipos aceitos pelo `worktree-create` para `docs`, `test` e `ci`, e fazer o `ship` usar o assunto do commit como título do PR quando a branch tem exatamente um commit próprio, com fallback determinístico para os demais casos.

## Context

**Fatos verificados:** `worktree-create` aceita somente `feat`, `fix`, `chore` e `refactor`, e deriva a branch como `<type>/<issue#>-<slug>` ou `<type>/<slug>` (`skills/worktree-create/SKILL.md:15-56`). O coordinator usa a convenção `<type>/<issue#>-<slug>` para a branch de uma issue (`skills/shared/references/issue-coordinator-dispatch.md:11-17,119-124`), sem validação de tipos nessa referência. `ship` lista commits da branch e cria o título no formato `<type>(<slug>): <resumo dos commits>` (`skills/ship/SKILL.md:149-154,171-178`).

**Fatos apurados em 2026-10-21:**

- O único validador da lista de tipos é `skills/worktree-create/SKILL.md` (§Sintaxe e §1); nenhum script de `scripts/`, `hooks/`, `opencode/` ou `cli/lib/` interpreta o prefixo de branch (busca por `feat|fix|chore|refactor`).
- Nos últimos 400 assuntos de commit: `feat` 76, `fix` 62, `docs` 30, `chore` 20, `refactor` 7, `test` 1. Nos últimos 200 PRs mergeados, as branches usaram `docs/` 17 vezes, `test/` 2 e `ci/` 1 — criadas fora do `worktree-create`, que as rejeitaria.
- O passo 2 do `ship` roda `git merge origin/$DEFAULT_BRANCH` na branch (`skills/ship/SKILL.md:66-70`), o que cria merge commit quando a default avançou; os PRs #441–#445 de 2026-10-21 tinham commits "Merge remote-tracking branch 'origin/master'". Contar `origin/$DEFAULT_BRANCH..HEAD` sem excluir merges quase nunca daria "um commit".

O relato da issue: uma alteração só de documentação virou `fix/wiki-divergencias`, e o assunto `docs(wiki): ...` representava melhor o histórico.

## Goals

- Permitir branches `docs`, `test` e `ci` sem classificar a mudança com um tipo semanticamente errado.
- Alinhar o título do PR ao assunto do commit quando houver exatamente um commit próprio da branch.
- Ter fallback previsível para zero ou vários commits e para assunto inutilizável.

## Non-Goals

- Redefinir Conventional Commits ou validar todos os assuntos de commit.
- Alterar o corpo do PR, o CI ou a estratégia de squash.
- Aceitar outros prefixos vistos no histórico (`enhancement/`, `bug/`, `spike/`).

## Users / Personas

- Desenvolvedor que cria worktree para mudança de documentação, testes ou CI.
- `ship`, que constrói e publica o título do PR (`skills/ship/SKILL.md:149-178`).
- Coordinator, que compõe branch no formato `<type>/<issue#>-<slug>` (`skills/shared/references/issue-coordinator-dispatch.md:11-17,119-124`).

## Functional Requirements

### RF-01 - Aceitar os tipos `docs`, `test` e `ci`

**Priority:** Must

**Description:** O validador de tipo do `worktree-create` aceita `feat`, `fix`, `chore`, `refactor`, `docs`, `test` e `ci`, com mensagens coerentes com essa lista.

**Acceptance Criteria:**

- [ ] `docs`, `test` e `ci` passam pela validação e derivam `<type>/<slug>` ou `<type>/<issue#>-<slug>` conforme o argumento de issue (`skills/worktree-create/SKILL.md:15-56`).
- [ ] Tipos fora da lista continuam rejeitados, e a mensagem de erro lista exatamente os sete tipos válidos.

**Happy Path:**

1. Usuário escolhe `docs` para alteração documental.
2. A validação aceita o tipo.
3. A branch segue o padrão de nome já documentado.

### RF-02 - Lista de tipos consistente entre produtores de branch

**Priority:** Should

**Description:** Os pontos que recebem ou derivam `<type>` usam a mesma lista.

**Acceptance Criteria:**

- [ ] `skills/worktree-create/SKILL.md` (§Sintaxe e mensagem de erro do §1) traz a lista de sete tipos.
- [ ] `skills/shared/references/issue-coordinator-dispatch.md` cita que `<type>` da branch segue a lista do `worktree-create`, incluindo `docs`, `test` e `ci`.
- [ ] Nenhum componente rejeita ou reescreve silenciosamente um tipo aceito pelo `worktree-create`.

### RF-03 - Usar o assunto do commit único como título do PR

**Priority:** Must

**Description:** Quando a branch tem exatamente um commit próprio em relação à default, `ship` usa o assunto desse commit, literal, como título do PR.

**Acceptance Criteria:**

- [ ] A contagem usa `git log --no-merges --format=%s "origin/$DEFAULT_BRANCH..HEAD"`, excluindo merge commits (inclusive os criados pelo passo 2 do `ship`).
- [ ] Para uma branch com um único commit de assunto `docs(wiki): corrige divergências em Referencia e MCPs`, o título do PR é exatamente esse assunto, mesmo que a branch tenha merge commits de sincronização.
- [ ] O título não ganha prefixo nem escopo derivado do slug quando o assunto do commit único é usado (`skills/ship/SKILL.md:171-178`).

**Happy Path:**

1. `ship` obtém os commits não-merge da branch em relação à default.
2. Há exatamente um, com assunto utilizável.
3. O assunto é usado como título.

### RF-04 - Fallback do título

**Priority:** Must

**Description:** Fora do caso de RF-03, `ship` mantém o template atual.

**Acceptance Criteria:**

- [ ] Zero ou mais de um commit não-merge: título pelo template atual `<type>(<slug>): <resumo dos commits>`.
- [ ] Assunto do commit único vazio ou com caractere de controle (U+0000–U+001F ou U+007F): título pelo template atual, com aviso no sumário.
- [ ] O PR nunca é criado com título vazio.
- [ ] O título não é truncado; se o `gh pr create` rejeitar o título, `ship` para com o erro explícito, sem tentar outro título silenciosamente.

## Non-Functional Requirements

### RNF-01 - Previsibilidade do título

**Priority:** Should

**Description:** A escolha do título depende só do número de commits não-merge e do assunto disponível, nunca de interpretação do slug.

**Acceptance Criteria:**

- [ ] O texto do `ship` §6 documenta os três casos: commit único utilizável, fallback por contagem e fallback por assunto inutilizável.

## Behavior / States

- Tipo de branch validado contra sete valores: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `ci`.
- Título de PR: assunto literal com exatamente um commit não-merge utilizável; template atual nos demais casos.
- O formato de branch (`<type>/<issue#>-<slug>`) é independente do título final.

## Data

- Tipo e slug informados à criação do worktree.
- Assuntos dos commits não-merge entre `origin/$DEFAULT_BRANCH` e `HEAD`.
- Título transmitido a `gh pr create` (`skills/ship/SKILL.md:171-178`).

## Integrations / Dependencies

- `worktree-create` valida tipo e compõe a branch (`skills/worktree-create/SKILL.md:15-56`) — único validador (fato apurado em 2026-10-21).
- Coordinator deriva nomes no padrão `<type>/<issue#>-<slug>` (`skills/shared/references/issue-coordinator-dispatch.md:11-17,119-124`).
- `ship` inspeciona commits, sincroniza com merge no passo 2 e cria o PR via `gh pr create` (`skills/ship/SKILL.md:66-70,149-178`).

## Edge Cases

- Vários commits não-merge: template atual.
- Nenhum commit não-merge no range: template atual; nunca título vazio.
- Branch só com o commit da mudança mais merge commits de sincronização: conta como um commit (RF-03).
- Assunto com espaços, acentos, pontuação ou escopo convencional: preservado; o título é passado entre aspas (`skills/ship/SKILL.md:171-178`).
- Assunto com caractere de controle: template atual, com aviso (RF-04).
- Tipo de branch inválido: rejeitado com a lista dos sete válidos.

## Error Handling

Erro de tipo indica o valor inválido e a lista aceita. Se `gh pr create` rejeitar o título, `ship` para com o diagnóstico; não publica título vazio nem trunca.

## Security / Privacy

O assunto do commit vira metadado público do PR. Caracteres de controle no assunto disparam o fallback do template (RF-04); pontuação e acentuação normais são preservadas.

## Rollout

Atualizar a lista de tipos em `skills/worktree-create/SKILL.md` (§Sintaxe e §1), citar a lista em `skills/shared/references/issue-coordinator-dispatch.md` e reescrever a regra de título no `skills/ship/SKILL.md` §6. Sem migração: branches existentes não mudam.

## Open Questions

Nenhuma pendente. Resolvidas em 2026-10-21:

- Tipos: `docs`, `test` e `ci` (decisão do mantenedor).
- Lista no coordinator: a referência de dispatch passa a citar a lista do `worktree-create`.
- Commit único: `git log --no-merges origin/$DEFAULT_BRANCH..HEAD`.
- Fallback: template atual para 0 ou vários commits e para assunto vazio ou com caractere de controle.
- Título longo: sem truncamento; rejeição do `gh` vira erro explícito.
- Outros consumidores de tipos: nenhum além do `worktree-create`.

## Decisions

- **Decidido (mantenedor, 2026-10-21):** aceitar `docs`, `test` e `ci`. Base: tipos padrão de Conventional Commits e uso real no histórico (branches `docs/` 17, `test/` 2, `ci/` 1).
- **Decidido (mantenedor, 2026-10-21):** com exatamente um commit não-merge, o título do PR é o assunto literal; nos demais casos, o template atual; caractere de controle no assunto aciona o template; sem truncamento.
- **Decidido:** a contagem exclui merge commits, porque o passo 2 do `ship` cria merge de sincronização.

## References

- `skills/worktree-create/SKILL.md:15-56` — sintaxe, conjunto atual de tipos e derivação de branch.
- `skills/ship/SKILL.md:66-70,149-178` — sincronização por merge, leitura dos commits, template atual e criação do PR.
- `skills/shared/references/issue-coordinator-dispatch.md:11-17,119-124` — forma de branch derivada no coordinator.
- Issue #429 — relato do tipo `docs` ausente, assunto de commit como título e avaliação de `test`/`ci`.
- PRs #441–#445 (2026-10-21) — exemplos de branch com merge commit de sincronização.

## Revision History

| Data | Autor | Mudança |
|------|-------|---------|
| 2026-10-21 | /vetor:spec (delegado via Alethe/Codex) | Rascunho inicial da Spec para issue #429. |
| 2026-10-21 | /vetor:spec (coordinator + mantenedor) | Pontos ABERTO resolvidos com decisões do mantenedor e fatos apurados (único validador de tipos, uso no histórico, merge commits do `ship` §2); frontmatter via `create-spec`. |
