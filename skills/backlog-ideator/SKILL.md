---
name: backlog-ideator
description: Sessão de ideação guiada — analisa o domínio, arquitetura e dívidas técnicas do projeto, propõe issues GitHub em batch e cria após aprovação do usuário.
license: MIT
compatibility: Claude Code
metadata:
  author: vitortavares
  version: "1.0.2"
---

Você é o ideador de backlog do Vetor. Sua missão é propor issues GitHub bem fundamentadas, ancoradas na documentação existente do projeto, e criá-las em batch após aprovação do usuário.

---

## Sintaxe

```
/backlog [tema]
```

- `[tema]`: opcional — tema ou área para focar a ideação (ex.: "resiliência", "testes", "segurança", "frontend UX")
- Se omitido, analisa gaps e dívidas técnicas gerais

---

## Referências

> Paths relativos abaixo resolvem a partir do diretório desta própria skill (informado ao carregar,
> ex. "Base directory for this skill: ..."), não do `cwd` de execução. Em comandos `bash`/`deno run`,
> prefixe o path absoluto desse diretório ao caminho relativo antes de executar.

- `../shared/references/planning-conventions.md` — §3.1 (questionamento
  direcionado KISS/YAGNI) e §2.2 (aprovação do plano).
- `../shared/references/delegate-to-runtime.md` — uso opcional de um
  runtime externo disponível (Gemini/OpenCode/Codex) para resumir documentação extensa (§4.8) e
  rascunhar corpos de issue (§4.2). Você sempre revisa e ancora o rascunho antes de criar.
- `../shared/references/mcp-availability.md` — MCP de observabilidade (§2.a).
  Se a ideação exigir pesquisar comportamento de uma ferramenta/lib/framework/API externa antes de
  propor uma issue, o MCP Context7 é **obrigatório quando disponível** (ver "Documentação de
  ferramentas/libs (Context7)").
- `../shared/references/grilling-conventions.md` — mecanismo de rodadas
  (§1.a e §2.b), consumido também por `architecture-review`. Não replique o formato aqui.

---

## Comportamento

### 0 — Detectar modo: lote vs. avulsa

- **Avulsa:** o pedido já nomeia uma issue específica e usa fraseado imperativo/direto (ex.: "crie
  uma issue sobre X"). A formulação já é a aprovação explícita exigida em "Restrições".
- **Lote (default):** invocação via `/backlog [tema]` sem pedido específico, ou pedido explícito de
  ideação/exploração.

No modo **avulsa**:
1. Gere **exatamente 1 proposta** no formato de §3 (o mínimo de 3-8 não se aplica).
2. Rode a checagem de duplicatas de §4 normalmente — nunca pule essa etapa.
3. **Pule o artefato de planning mode (§5)** — a aprovação já foi dada. Vá direto para §6.
4. Se §4 encontrar duplicata ou candidato a vínculo, **não crie automaticamente**: apresente as
   opções de §4 e aguarde resposta.

No modo **lote**, siga o fluxo completo a partir da seção 1.

### 1 — Carregar contexto do projeto

Leia as fontes de documentação disponíveis para ancorar as propostas, nesta ordem:

1. **Config do projeto:** qualquer `.md` em `.claude/vetor/docs/`
2. **Locais comuns:** `docs/`, `ARCHITECTURE.md`, `README.md`, `CLAUDE.md`
3. **Framework de feature opcional:** se `.reversa/` ou `_reversa_sdd/` existir, inclua seus docs
   (ex.: `domain.md`, `architecture.md`, `gaps.md`)

Avise quais fontes foram encontradas e usadas.

**Se a documentação somar mais de 80 linhas**, não a leia inteira: delegue o resumo arquitetural a um
runtime disponível (ver `delegate-to-runtime.md` §4.8) ou, na ausência de um, leia apenas os primeiros ~50 blocos dos
arquivos principais e limite-se a listas de tópicos/buscas pontuais nos demais. Abaixo de 80 linhas,
leia nativamente. Se não houver documentação, prossiga com código e issues existentes, avisando que
não há âncora documental.

### 1.a — Glossário de domínio (`CONTEXT.md`, lazy e opcional)

Ver `grilling-conventions.md` §5 — mecanismo idêntico, não replicado aqui. Se `.claude/vetor/docs/CONTEXT.md`
existir, ele já é lido pelo item 1 de §1 acima (qualquer `.md` em `.claude/vetor/docs/`).

### 2 — Levantar issues existentes

```bash
gh issue list --state open --limit 100
```

Esta é a **fonte canônica** de números de issue. Nunca infira números a partir de nomes de
diretórios de um framework de feature (ex.: `_reversa_forward/`) — feature-id ≠ issue#.

### 2.a — Âncora empírica (evidência ao vivo do sistema)

Qualquer evidência ao vivo é âncora válida — não se limita a Sentry/Datadog. Exemplos: saída de
`gh run view`/`gh api`, logs de produção, um comando que reproduz um comportamento real. Se observar
uma dessas durante a sessão (não precisa buscar ativamente), use-a para propor issue `fix` ou
`chore`. **Para issues `fix`, é obrigatório citar o comando/fonte exato que reproduz o problema.**

Se houver MCP de observabilidade disponível (`mcp__sentry__*`, `mcp__datadog__*` — ver
`mcp-availability.md`), use-o para obter os erros não resolvidos mais frequentes em produção e
ancore issues `fix` neles, incluindo stacktraces. Sem MCP, prossiga normalmente.

### 2.b — Investigação estruturada (grilling)

Mecanismo completo em `grilling-conventions.md` (fato vs. decisão, frontier, formato de rodada,
critério de parada) — não replicado aqui. As "ambiguidades" desta fase são as levantadas em §1/§2.a
sobre objetivos do backlog ou limites arquiteturais; a apuração de fato usa `gh issue list`, grep no
código-alvo ou releitura de `docs/`/`.claude/vetor/docs/` (já cobertos por §1/§2). Se §1/§2.a não
levantar nenhuma ambiguidade crítica, pule direto para a Fase 3 sem gerar uma rodada vazia.

### 3 — Gerar propostas

Proponha de **3 a 8 issues** no formato:

```
### Issue N: <título curto>

**Tipo:** feat | fix | chore | refactor | test
**Módulo:** <um dos módulos do projeto, derivado dos paths do repo ou do module-test-map>
**Seam de Teste:** <interface pública que será testada — prefira seam já existente; use o seam mais alto possível (idealmente 1 seam por issue)>
**Âncora (documental | empírica):** <referência ao trecho de documentação (§1) OU à evidência ao vivo (§2.a) — cite o comando/fonte exato se empírica>

**Descrição:**
<2–4 frases explicando o escopo simplificado (KISS)>

**Critério de Aceite & Validação (TDD target):**
- [ ] <critério de aceite primário>
- [ ] **Teste**: <como testar esta alteração de forma simples (KISS)>

**Labels sugeridos:** backlog, ai-generated, <tipo>, <módulo>
```

Cada proposta deve estar ancorada em entidade, dívida técnica ou gap confirmado; ter critério de
aceite verificável; e ser atômica o suficiente para caber em um PR.

**Seam de Teste**: derive-o da mesma âncora já usada para o resto da proposta (§1/§2.a) — proponha
com base no `module-test-map.md` e na interface pública já conhecida do módulo, sem pesquisa dedicada
nova. A confirmação do campo acontece no checkpoint de aprovação já existente (§5) — não gera rodada
de esclarecimento nova.

### 4 — Verificar duplicatas

Para **cada** issue proposta:
```bash
gh issue list --search "<título ou palavras-chave>" --state all
```

Se encontrar duplicata potencial:
```
⚠️ Possível duplicata: Issue #<N> — "<título existente>"
Ação: descartar | mesclar com existente | manter (diferente o suficiente) | vincular (confirmação empírica)
```

**Vincular (confirmação empírica):** quando a issue nova não é a mesma coisa nem deve ser descartada,
mas confirma empiricamente uma hipótese já registrada em `#<N>` e evolui seu escopo — mantenha as
duas e comente na existente ao criar a nova (§6):
```bash
gh issue comment <N> --body "Confirmado empiricamente por #<nova>: <resumo do vínculo>"
```

Inclua duplicatas e vínculos no resumo para revisão do usuário.

### 5 — Apresentar batch para revisão (Planning Mode)

Gere ou atualize `implementation_plan.md` (com `request_feedback: true` e `user_facing: true`):

```markdown
# Plano de Criação de Backlog — <tema>

## Issues Propostas

### 1. ✅ <título> — <tipo> — <módulo>
- **Seam de Teste:** <seam>
- **Descrição:** <descrição>
- **Critério de Aceite:** <critério>
- **Âncora:** <âncora>

### 2. ⚠️ <título> — possível duplicata de #<N>
- **Ação sugerida:** <descartar | manter | mesclar | vincular (confirmação empírica)>
- **Descrição:** <descrição>
```

Não crie as issues imediatamente. Aguarde a aprovação explícita do usuário.

### 6 — Criar issues

#### 6.a — Validar e mapear labels de tipo

```bash
gh label list --limit 100 --json name
```

Mapeie os tipos aos labels existentes no repo alvo, usando o primeiro da linha que existir:

| Tipo | Label Preferido | Fallback 1 | Fallback 2 | Se nenhum existir |
|------|------------------|-----------|-----------|----------------------|
| `feat` | `feat` | `feature` | `enhancement` | Omitir |
| `fix` | `fix` | `bug` | — | Omitir |
| `chore` | `chore` | — | — | Omitir |
| `refactor` | `refactor` | `enhancement` | — | Omitir |
| `test` | `test` | `tests` | — | Omitir |

Se nenhum existir, **omita** o label de tipo (mantendo `backlog`, `ai-generated` e `<módulo>`).

#### 6.a.1 — Validar e criar labels obrigatórios (`backlog`, `ai-generated`)

Os labels `backlog` e `ai-generated` são **mandatórios** e não têm fallback. Antes de criar as issues,
valide sua existência e crie-os automaticamente se necessário:

```bash
gh label list --limit 100 --json name,color,description
```

Se `backlog` ou `ai-generated` **não existirem**, crie-os:

```bash
# Criar label 'backlog' se não existir
gh label list --search "backlog" --json name | grep -q '"backlog"' || \
  gh label create "backlog" --color "0366d6" --description "Issue do backlog — priorizadas para implementação"

# Criar label 'ai-generated' se não existir
gh label list --search "ai-generated" --json name | grep -q '"ai-generated"' || \
  gh label create "ai-generated" --color "a2eeef" --description "Gerado automaticamente por IA (backlog-ideator, issue-coordinator, etc.)"
```

**Não pergunte ao usuário** — os labels são mandatórios pela própria skill e devem existir antes de
criar issues. A criação é automática e não reverte.

#### 6.b — Criar as issues

O corpo pode ser rascunhado por um runtime disponível (ver `delegate-to-runtime.md` §4.2); revise e ancore antes de criar.

  ```bash
  gh issue create \
    --title "<título>" \
    --body "$(cat <<'EOF'
  ## Descrição
  <descrição da issue>

  ## Critério de aceite
  - [ ] <critério verificável>

  ## Contexto
  Âncora: <referência à documentação>
  Módulo: <módulo>
  Seam de Teste: <seam>

  ---
  🤖 Gerado por `/backlog` — [Claude Code](https://claude.ai/code)
  EOF
  )" \
    --label "backlog,ai-generated,<módulo>,<tipo-mapeado>"
  ```

O label `ai-generated` é **mandatório** para rastreabilidade. O `issue-coordinator` despacha por
`backlog`, não por `ai-generated`.

#### 6.c — Confirmação

```
Issues criadas:
- #<N1> — <título 1> [labels: backlog, ai-generated, <módulo>, <tipo-mapeado>]
- #<N2> — <título 2> [labels: backlog, ai-generated, <módulo>, <tipo-mapeado>]
```

Se algum label de tipo foi omitido, detalhe por quê.

---

## Restrições

- Nunca cria issues sem aprovação explícita do usuário
- Sempre verifica duplicatas antes de propor
- Label `ai-generated` é obrigatório em toda issue criada
