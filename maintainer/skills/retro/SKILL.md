---
name: retro
description: Avalia o uso do Vetor nesta sessão, destaca o que pode ser melhorado no plugin em si (não no projeto do usuário) e propõe issues para o repositório do Vetor, com aprovação antes de criar.
license: MIT
compatibility: "Núcleo: ler, editar e rodar shell. Opcional: perguntas (sem elas, aprovação no chat)."
metadata:
  author: vitortavares
  version: "2.0.0"
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
/vetor-maintainer:retro      (Claude Code, plugin vetor-maintainer)
/retro                       (demais harnesses, com a skill copiada para a pasta de skills)
```

Faz parte do plugin `vetor-maintainer`, separado do plugin principal: só interessa a quem mantém o
Vetor. Invocação manual, tipicamente ao final de uma sessão que usou uma ou mais skills do Vetor
(`backlog`, `coordinator`, `guardian`, `worktree-create`, `ship`, `fix`, `issue-worker`).

---

## Referências

Esta skill é autossuficiente: não depende de arquivos do plugin principal.

- **Documentação do próprio Claude Code.** Ao avaliar um achado sobre hooks, slash commands,
  configuração de MCP, permissões ou SDK de agentes, consulte o MCP `claude-code-docs` (ferramentas
  `mcp__claude-code-docs__*` ou `mcp__plugin_<plugin>_claude-code-docs__*`) quando ele estiver
  disponível na sessão, antes de afirmar o comportamento esperado da plataforma. Sem ele, cite a
  página oficial (`code.claude.com/docs`) e a data da consulta. Nunca conecte um MCP só para sondar.
- **Aprovação antes de criar.** Use o mecanismo do harness: plan mode com `ExitPlanMode` se a sessão
  já estiver em plan mode (nunca fora dele), a ferramenta de perguntas (`AskUserQuestion` no Claude
  Code), `implementation_plan.md` com `request_feedback: true` no Antigravity ou, sem nenhum deles, a
  lista no chat terminando com "responda `sim` para criar todas, ou diga quais". Pare até a resposta.

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
- **Um efeito colateral não documentado** apareceu (ex.: arquivo escrito fora do esperado, chamada
  que falhou silenciosamente).
- **Um passo pareceu redundante ou bloqueou sem necessidade** (aprovação dupla, checagem que nunca
  se aplica neste tipo de projeto, etc.).

Se nenhuma dessas situações ocorreu na sessão, diga isso claramente e pare — não force achados.

### 2 — Classificar e formular como issue candidata

Para cada achado real, monte:

```markdown
### <Título curto e específico>

**Tipo:** bug | enhancement | docs

**Skill/arquivo afetado:** <ex.: skills/coordinator/SKILL.md>

**Evidência:** <trecho da sessão que mostra o problema — cite o que aconteceu, não hipótese>

**Descrição:** <o que está errado ou faltando, e o efeito prático>

**Sugestão de fix:** <se houver uma direção clara; opcional caso a solução não seja óbvia>

## Critério de aceite

- [ ] <critério 1 verificável>
- [ ] <critério 2 verificável>
```

Priorize achados que **realmente aconteceram** nesta sessão sobre problemas hipotéticos. O checklist
de **Critério de aceite** é obrigatório para que o gate do `coordinator` avalie o escopo com
precisão.

### 3 — Verificar duplicatas no repositório do Vetor

Antes de propor criação, cheque se já existe issue equivalente no repo do Vetor (não no projeto
atual). O repo alvo é sempre `Tavaressan/Vetor`.

Use a CLI `gh`:

```bash
gh issue list --repo Tavaressan/Vetor --search "<palavras-chave>" --state all
```

Se encontrar equivalente, não proponha criar de novo — anote como "já rastreado em #<N>" no resumo.

### 4 — Apresentar e aguardar aprovação

Apresente a lista de issues candidatas (após remover duplicatas) e obtenha aprovação pelo
mecanismo descrito em Referências ("Aprovação antes de criar").

**Pare** até a aprovação. O usuário pode aprovar todas, algumas, ou nenhuma.

### 5 — Criar as issues aprovadas — sempre no repo do Vetor, nunca no do projeto

⚠️ **Restrição crítica:** estas issues vão para o repositório do **plugin** (`Tavaressan/Vetor`), que quase sempre é diferente do repositório do projeto onde esta sessão está
rodando. Sempre especifique o repo explicitamente — nunca deixe implícito no diretório atual.

#### 5.a — Política de labels

- **Nunca cria labels** no repositório.
- **Não aplica `ai-generated`** (nem `retro` ou `backlog`). A procedência e origem da issue são
  registradas exclusivamente pelo rodapé obrigatório `🤖 Gerado por /vetor:retro`.
- **Aplica só a label de tipo existente no repo**: consulte os labels existentes no repo alvo antes
  de criar as issues.

```bash
gh label list --repo Tavaressan/Vetor --limit 100 --json name
```

Se a label correspondente ao `Tipo` da issue (`bug`, `enhancement`, `docs`) existir no
repositório-alvo, use o primeiro mapeamento existente no repo: `bug` → `bug`, `enhancement` →
`enhancement`, `docs` → `documentation` ou `docs`. Se nenhum label correspondente existir, omita o
argumento `--label`.

#### 5.b — Criação da issue

O rodapé `🤖 Gerado por /vetor:retro` permanece **obrigatório** no final do corpo da issue.

Escreva o corpo com a ferramenta **Write** em um arquivo temporário (nunca `echo`, `printf` nem
heredoc: o shell corrompe crases e pode inserir BOM) e use a CLI `gh` com `--body-file`.
Conteúdo do arquivo:

```text
<corpo no formato de §2>

---
🤖 Gerado por `/vetor:retro` — sessão em <projeto atual, sem dados sensíveis>
```

```bash
# Se a label de tipo existir no repo alvo:
gh issue create --repo Tavaressan/Vetor \
  --title "<título>" \
  --body-file "<path-do-arquivo-de-corpo>" \
  --label "<tipo>"

# Se a label de tipo NÃO existir no repo alvo, omita --label:
gh issue create --repo Tavaressan/Vetor \
  --title "<título>" \
  --body-file "<path-do-arquivo-de-corpo>"
```

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
- Nunca cria issues no repositório do projeto atual — sempre no repo do Vetor (`Tavaressan/Vetor`)
- Nunca cria labels no repositório — aplica só a label de tipo existente no repo
- Não aplica ai-generated — a procedência é mantida pelo rodapé obrigatório
- O rodapé `🤖 Gerado por /vetor:retro` permanece obrigatório em toda issue criada
- Critério de aceite com checklist é obrigatório no template de toda issue candidata
- Não força achados: sessão sem fricção real produz "nada a reportar", não issues artificiais
- Evidência é obrigatória por achado — sem trecho real da sessão, não vira issue candidata
