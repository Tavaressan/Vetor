---
name: spec
description: Gera uma Spec estruturada (RF/RNF, Acceptance Criteria, Edge Cases, Non-Goals) a partir de um tema, ancorada no contexto descoberto no próprio projeto (README, docs, ADRs, Specs existentes, código, configuração do Vetor).
license: MIT
compatibility: Claude Code
metadata:
  author: vitortavares
  version: "1.0.0"
---

Você é a skill de geração de Specs do Vetor. Sua missão é descobrir o contexto já existente no
projeto e, a partir dele, redigir um rascunho de Spec estruturada — descrevendo comportamento, não
implementação — usando `templates/spec.md` como esqueleto.

Esta é a skill **scaffold**: implementa a entrada, a descoberta de contexto (via Knowledge Provider
quando disponível, com fallback para filesystem direto), a montagem do rascunho a partir do template
e a persistência mínima (frontmatter válido, identidade estável, sem sobrescrever sem perguntar).
Decomposição em componentes e entrevista focada chegam em issue futura; motor de geração aprofundado
de RF/RNF chega em outra; controle de overwrite avançado (versionamento, merge de rascunhos) chega em
outra; Obsidian como Knowledge Provider chega em outra (issue #225) — cada estágio abaixo sinaliza
explicitamente o que ainda não está implementado.

---

## Sintaxe

```
/vetor:spec
/vetor:spec <tema>
```

- `<tema>`: opcional — o assunto a especificar (ex.: "sistema de autenticação", "melhorar fluxo de
  checkout", "API de notificações").
- Se omitido, rode o passo 1 **sem filtro de palavra-chave** (visão geral do projeto — categorias 1
  a 5 e 7), proponha um tema a partir do que foi encontrado e confirme com o usuário antes de seguir
  para o passo 2. Se nada relevante for encontrado, pergunte objetivamente ao usuário qual tema
  especificar (uma pergunta direta, não uma entrevista). Só depois de o tema estar definido — por
  argumento ou por confirmação — aplique o filtro por palavra-chave da categoria 6.

---

## Referências

- `$CLAUDE_PLUGIN_ROOT/templates/spec.md` — esqueleto da Spec usado no passo 3.
- `$CLAUDE_PLUGIN_ROOT/skills/shared/references/planning-conventions.md` — §3.1 (questionamento
  direcionado KISS/YAGNI), aplicável quando o tema precisar de uma pergunta direta ao usuário.
- `$CLAUDE_PLUGIN_ROOT/skills/shared/references/delegate-to-gemini.md` — uso opcional do `agy` para
  resumir documentação extensa encontrada no passo 1 (mesmo critério de `backlog-ideator`: acima de
  ~80 linhas, delegue o resumo em vez de ler tudo nativamente).
- `$CLAUDE_PLUGIN_ROOT/skills/shared/references/knowledge-provider-contract.md` — contrato do
  Knowledge Provider consumido pelos passos 0, 1 (item 5) e 4 via `scripts/knowledge-doc.ts`.
- `$CLAUDE_PLUGIN_ROOT/scripts/knowledge-doc.ts` — CLI que expõe `status`/`search-specs`/
  `create-spec`/`find` sobre o Knowledge Provider (ver passo 0).

---

## Comportamento

### 0 — Knowledge Provider

A busca por Specs relacionadas (passo 1, item 5) e a persistência (passo 4) são feitas através de um
**Knowledge Provider** — uma fonte de conhecimento do projeto, abstrata por design:

```
Knowledge Provider
├── filesystem   (implementado — via scripts/knowledge-doc.ts)
├── obsidian     (issue #225, ainda não implementado neste código)
└── future providers
```

Antes do passo 1, rode:

```bash
deno run -A "$CLAUDE_PLUGIN_ROOT/scripts/knowledge-doc.ts" status
```

- `{"enabled": true, ...}` (default quando `.claude/vetor/config.json` não define `knowledge`, ou
  define `knowledge.enabled` diferente de `false`) → use o Knowledge Provider nos passos 1 (item 5) e
  4 conforme descrito abaixo.
- `{"enabled": false, ...}` (`knowledge.enabled: false` explícito) → **fallback**: ignore o provider
  em todo o fluxo — descoberta do item 5 vira busca direta por `grep`/`find` em `docs/specs/**/*.md`
  (como nas demais categorias do passo 1) e o passo 4 não persiste nada em disco (apenas apresenta o
  rascunho, como nesta skill antes desta integração).

A skill nunca assume nem referencia Obsidian diretamente em nenhum ponto do fluxo — o CLI sempre usa
`FilesystemKnowledgeProvider` hoje; quando `ObsidianKnowledgeProvider` existir (#225), a mudança fica
isolada em `scripts/knowledge-doc.ts`, sem alterar os passos abaixo.

### 1 — Context Discovery

Antes de gerar qualquer rascunho, procure contexto no projeto **nesta ordem de prioridade**. Em toda
busca por arquivo (`find`/`grep`), exclua sempre
`.claude/worktrees/*`, `node_modules/`, `target/`, `build/`, `dist/`, `.venv/`, `__pycache__/`.

Se `<tema>` já foi informado (ou já foi confirmado com o usuário — ver Sintaxe), use-o para filtrar
a categoria 6 e para julgar a relevância do conteúdo lido nas demais. **Se `<tema>` ainda não existe**
(invocação sem argumento, primeira passada), rode as categorias 1 a 5 e 7 **sem filtro** — como
levantamento geral do projeto — para propor um tema; a categoria 6 (código por palavra-chave) só se
aplica depois que o tema estiver definido.

1. **Documentação existente do Vetor:** `.claude/vetor/docs/**/*.md`
2. **README:** `README.md` na raiz do projeto
3. **Arquitetura:** `ARCHITECTURE.md`, `docs/architecture/**`, ou qualquer `docs/*.md` cujo conteúdo
   trate de arquitetura
4. **ADRs:** `docs/adr/**`, `docs/decisions/**`, ou arquivos que casem com `*ADR*.md`
5. **Specs existentes:** se o Knowledge Provider estiver habilitado (passo 0), rode
   `deno run -A "$CLAUDE_PLUGIN_ROOT/scripts/knowledge-doc.ts" search-specs "<tema>"` — a busca
   prévia por Specs relacionadas antes de gerar uma nova; senão, `grep`/`find` direto em
   `docs/specs/**/*.md`. Em ambos os casos, o objetivo é o mesmo: evitar duplicar uma Spec já criada
   para o mesmo tema
6. **Código relevante:** busque por palavras-chave do tema (já definido) nos módulos indicados por
   `.claude/vetor/module-test-map.md` (se existir)
7. **Configuração do Vetor:** `.claude/vetor/config.json`, `.claude/vetor/module-test-map.md`,
   `.claude/rules/vetor/*.md`
8. **Contexto fornecido diretamente pelo usuário:** qualquer detalhe já dado na mensagem atual ou em
   resposta a uma pergunta feita por esta skill

Para cada categoria, registre o que foi encontrado (arquivo + trecho relevante) ou, explicitamente,
que nada foi encontrado — uma categoria vazia deve aparecer no relatório do passo 2 como vazia, nunca
ser omitida silenciosamente. Se um arquivo encontrado passar de ~80 linhas, resuma-o (nativamente ou
via `agy`, ver Referências) em vez de reproduzi-lo inteiro.

### 2 — Reportar o contexto encontrado

**Antes de redigir qualquer rascunho de Spec**, apresente o resultado da descoberta. Quando o tema
ainda não estiver confirmado (levantamento geral do passo 1), use `"(tema a confirmar — ver
proposta abaixo)"` no lugar de `<tema>` e liste a proposta de tema logo após o relatório, para
confirmação do usuário antes do passo 3.

```
## Contexto encontrado para "<tema>"

1. Documentação do Vetor: <arquivo(s) + trecho | "nenhuma encontrada">
2. README: <trecho relevante | "nenhum README encontrado">
3. Arquitetura: <arquivo(s) + trecho | "nenhuma encontrada">
4. ADRs: <arquivo(s) + trecho | "nenhum ADR encontrado">
5. Specs existentes: <arquivo(s) + trecho | "nenhuma Spec existente para este tema">
6. Código relevante: <arquivo(s)/módulo(s) | "nenhum código relevante localizado">
7. Configuração do Vetor: <achado | "sem configuração relevante">
8. Contexto fornecido pelo usuário: <resumo | "nenhum">
```

Se a Spec existente do item 5 já cobrir o mesmo tema, pare aqui e pergunte ao usuário se deseja
atualizar a existente em vez de gerar uma nova (não decida por conta própria).

### 3 — Montar o rascunho a partir do template

Copie a estrutura de `templates/spec.md` e preencha, a partir **apenas** do que foi encontrado no
passo 1-2:

- **Título / Summary:** derive do tema e do contexto encontrado, em 1-2 frases.
- **Context:** síntese das fontes relevantes, citando os arquivos de origem.
- Demais seções (Goals, Non-Goals, Users/Personas, Functional Requirements, Non-Functional
  Requirements, Behavior/States, Data, Integrations/Dependencies, Edge Cases, Error Handling,
  Security/Privacy, Rollout, Decisions, References): preencha o que o contexto sustenta; onde a
  informação não existir, escreva explicitamente `⚠️ ABERTO: <o que falta definir>` em vez de deixar
  a seção vazia ou inventar conteúdo.
- **Open Questions:** liste toda pergunta ainda sem resposta identificada durante a descoberta.
- **Revision History:** uma linha inicial com a data e "rascunho inicial gerado por /vetor:spec".

Mantenha a estrutura extensível — não invente seções obrigatórias fora do template, e não force
seções irrelevantes para um tema pequeno (ver `templates/spec.md`).

### 4 — Apresentar o rascunho e persistir

Mostre o rascunho completo na conversa para revisão do usuário e pergunte se deseja salvá-lo. Explicite
o que esta versão da skill **não** cobre ainda, para não sugerir uma qualidade que ela ainda não
entrega:

- decomposição em componentes e entrevista focada por componente;
- motor de geração aprofundado de RF/RNF/Acceptance Criteria/Edge Cases;
- validação de qualidade (Quality Gate) e refinamento iterativo;
- controle de overwrite avançado (versionamento, merge de rascunhos) — hoje a única proteção é
  `create-spec` recusar sobrescrever uma identidade já existente;
- Knowledge Provider além de filesystem (ex.: Obsidian, issue #225).

**Persistência (quando o Knowledge Provider está habilitado — passo 0, e o usuário confirmar):**

```bash
# grave o rascunho completo em um arquivo temporário antes (evita problemas de quoting em
# heredoc com o conteúdo livre da Spec) e use-o como stdin:
deno run -A "$CLAUDE_PLUGIN_ROOT/scripts/knowledge-doc.ts" create-spec \
  --slug <slug-derivado-do-tema> --project <nome-do-repositório> --status draft \
  < <arquivo-temporário-com-o-rascunho>
```

- O `slug` deriva do tema (kebab-case, ex.: "autenticação de usuários" → `autenticacao-de-usuarios`).
- O documento recebe frontmatter válido (`id`, `type: spec`, `project`, `status: draft`, `created`,
  `updated`) e identidade estável `spec:<slug>`, localizável depois via
  `knowledge-doc.ts find spec:<slug>`.
- Se o passo 1 encontrou um documento com relação clara ao tema (ex.: o ADR que rege a decisão, ou a
  arquitetura específica do componente — não qualquer resultado incidental), passe
  `--link <path-do-documento-relacionado>` para criar o link. Não linke indiscriminadamente: só
  quando a relação for evidente a partir do que foi encontrado no passo 1.
- Se `create-spec` falhar (identidade já existe — corrida com outra sessão, por exemplo), informe o
  usuário e não tente sobrescrever por conta própria.
- Reporte ao usuário a identidade e o path onde a Spec foi salva.

Quando o Knowledge Provider está desabilitado (passo 0), mantenha o comportamento anterior: **não
grava a Spec em disco** — o rascunho fica apenas na conversa.

---

## Restrições

- Nunca afirme certeza sobre um requisito que o contexto descoberto não sustenta — marque como
  `⚠️ ABERTO`.
- Nunca decida sozinho sobrescrever uma Spec existente encontrada no passo 1 — pergunte ao usuário.
- Nunca acople a descoberta de contexto a um provider específico além de `FilesystemKnowledgeProvider`
  (hoje o único implementado em `scripts/knowledge-doc.ts`).
- Nunca persista a Spec sem antes ter rodado a busca prévia do passo 1, item 5.
- Nunca crie um link (`--link`) para um documento sem relação clara com o tema — vínculos
  indiscriminados são piores que a ausência de vínculo.
- Nunca persista em disco quando o Knowledge Provider estiver desabilitado (passo 0) — apenas
  apresente o rascunho na conversa.
- Nunca omita uma categoria de busca do relatório do passo 2, mesmo quando vazia.
