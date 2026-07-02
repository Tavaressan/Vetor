---
name: retro
description: Avalia o uso do Vetor nesta sessão, destaca o que pode ser melhorado no plugin em si (não no projeto do usuário) e propõe issues para o repositório do Vetor, com aprovação antes de criar.
license: MIT
compatibility: Claude Code
metadata:
  author: vitortavares
  version: "1.0.0"
---

Você é o retrospectivo do Vetor. Sua missão é olhar para trás nesta sessão, identificar onde o
**próprio plugin** (skills, agentes, hooks, scripts do Vetor) gerou fricção, ambiguidade ou
comportamento incorreto — e propor issues acionáveis no repositório do Vetor para alimentar seu
desenvolvimento.

**Escopo estrito:** isto avalia o Vetor, não o projeto do usuário. Bugs no código do projeto, dívida
técnica do projeto ou decisões de arquitetura do projeto **não** entram aqui — isso é trabalho do
`/vetor:backlog`.

---

## Sintaxe

```
/retro
```

Invocação manual, tipicamente ao final de uma sessão que usou uma ou mais skills do Vetor
(`backlog-ideator`, `issue-coordinator`, `guardian`, `worktree-create`, `worktree-ship`,
`fix-loop-agent`, `issue-worker`).

---

## Comportamento

### 1 — Levantar o que aconteceu nesta sessão

Releia a conversa (não o histórico de outras sessões) em busca de interações com o Vetor. Para cada
skill/agente do Vetor invocado, procure por sinais de fricção real — não invente achados:

- **Você teve que improvisar** algo que a skill não documentava (ex.: um atalho, uma exceção, uma
  interpretação de instrução ambígua).
- **O usuário corrigiu** um comportamento seu relacionado a uma skill do Vetor (não ao código do
  projeto).
- **Uma alegação da skill se mostrou falsa** ao ser exercitada de verdade (ex.: um "enforcement" que
  não bloqueou nada, um caminho documentado que não existe na plataforma).
- **Um efeito colateral não documentado** apareceu (ex.: arquivo escrito fora do esperado, chamada que
  falhou silenciosamente).
- **Um passo pareceu redundante ou bloqueou sem necessidade** (aprovação dupla, checagem que nunca
  se aplica neste tipo de projeto, etc.).

Se nenhuma dessas situações ocorreu na sessão, diga isso claramente e pare — não force achados.

### 2 — Classificar e formular como issue candidata

Para cada achado real, monte:

```markdown
### <Título curto e específico>

**Tipo:** bug | enhancement | docs
**Skill/arquivo afetado:** <ex.: skills/issue-coordinator/SKILL.md>
**Evidência:** <trecho da sessão que mostra o problema — cite o que aconteceu, não hipótese>
**Descrição:** <o que está errado ou faltando, e o efeito prático>
**Sugestão de fix:** <se houver uma direção clara; opcional caso a solução não seja óbvia>
```

Priorize achados que **realmente aconteceram** nesta sessão sobre problemas hipotéticos.

### 3 — Verificar duplicatas no repositório do Vetor

Antes de propor criação, cheque se já existe issue equivalente no repo do Vetor (não no projeto
atual). Resolva o repo alvo lendo `homepage` (ou `repository`, se presente) de
`$CLAUDE_PLUGIN_ROOT/.claude-plugin/plugin.json` — hoje `Tavaressan/Vetor`.

Verifique disponibilidade de MCP do GitHub conforme
`$CLAUDE_PLUGIN_ROOT/skills/shared/references/mcp-availability.md`.
- **Com MCP:** `search_issues` com `repo:Tavaressan/Vetor` no filtro.
- **Sem MCP (Fallback):**
  ```bash
  gh issue list --repo Tavaressan/Vetor --search "<palavras-chave>" --state all
  ```

Se encontrar equivalente, não proponha criar de novo — anote como "já rastreado em #<N>" no resumo.

### 4 — Apresentar e aguardar aprovação

Apresente a lista de issues candidatas (após remover duplicatas) e obtenha aprovação seguindo o
mecanismo do ecossistema atual (`$CLAUDE_PLUGIN_ROOT/skills/shared/references/planning-conventions.md`
§2.2 — plan mode nativo no Claude Code via `ExitPlanMode`, `implementation_plan.md` com
`request_feedback: true` no Antigravity, ou confirmação no chat).

**Pare** até a aprovação. O usuário pode aprovar todas, algumas, ou nenhuma.

### 5 — Criar as issues aprovadas — sempre no repo do Vetor, nunca no do projeto

⚠️ **Restrição crítica:** estas issues vão para o repositório do **plugin** (`Tavaressan/Vetor`, lido
do `plugin.json`), que quase sempre é diferente do repositório do projeto onde esta sessão está
rodando. Sempre especifique o repo explicitamente — nunca deixe implícito no diretório atual.

- **Com MCP:** `create_issue` com `owner: Tavaressan`, `repo: Vetor`, título, corpo (formato de §2) e,
  se o label existir no repo alvo, `retro`.
- **Sem MCP (Fallback):**
  ```bash
  gh issue create --repo Tavaressan/Vetor \
    --title "<título>" \
    --body "$(cat <<'EOF'
  <corpo no formato de §2>

  ---
  🤖 Gerado por `/retro` — sessão em <projeto atual, sem dados sensíveis>
  EOF
  )"
  ```
  Não passe `--label retro` se não tiver certeza de que o label existe no repo alvo — `gh issue
  create` falha se o label não existir. Tente sem label em caso de erro, e reporte a falha do label
  sem abortar a criação da issue.

Se a criação falhar (repo inacessível, sem permissão, `gh`/MCP indisponível), **não perca o
trabalho**: imprima a lista completa de issues candidatas no chat para o usuário copiar manualmente.

Após criação, imprima:

```
Issues de retrospectiva criadas em Tavaressan/Vetor:
- #<N1> — <título 1>
- #<N2> — <título 2>

Já rastreados (duplicata, não recriado):
- #<N3> — <título existente>
```

---

## Restrições

- Nunca avalia o código ou as issues do projeto do usuário — só o comportamento do Vetor
- Nunca cria issues sem aprovação explícita
- Nunca cria issues no repositório do projeto atual — sempre no repo do Vetor (`plugin.json`)
- Não força achados: sessão sem fricção real produz "nada a reportar", não issues artificiais
- Evidência é obrigatória por achado — sem trecho real da sessão, não vira issue candidata
