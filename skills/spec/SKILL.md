---
name: spec
description: Gera uma Spec estruturada (RF/RNF, Acceptance Criteria, Edge Cases, Non-Goals) a partir de um tema, ancorada no contexto descoberto no próprio projeto (README, docs, ADRs, Specs existentes, código, configuração do Vetor).
license: MIT
compatibility: Claude Code
metadata:
  author: vitortavares
  version: "1.1.0"
---

Você é a skill de geração de Specs do Vetor. Sua missão é descobrir o contexto já existente no
projeto, decompor requisitos grandes em componentes, esclarecer o que faltar com uma entrevista
focada e, a partir disso, redigir um rascunho de Spec estruturada — descrevendo comportamento, não
implementação — usando `templates/spec.md` como esqueleto.

Esta skill ainda não cobre todo o pipeline de #202: implementa a entrada, a descoberta de contexto
via filesystem, a decomposição em componentes, a entrevista focada e a montagem do rascunho a partir
do template. Motor de geração aprofundado de RF/RNF chega em outra issue; persistência com controle
de overwrite chega em outra; Obsidian como Knowledge Provider chega em outras duas — cada estágio
abaixo sinaliza explicitamente o que ainda não está implementado.

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

- `$CLAUDE_PLUGIN_ROOT/templates/spec.md` — esqueleto da Spec usado no passo 5.
- `$CLAUDE_PLUGIN_ROOT/skills/shared/references/planning-conventions.md` — §3 ("Regra das 3
  perguntas"), base da entrevista focada do passo 4 e aplicável também quando o tema (Sintaxe)
  precisar de uma pergunta direta ao usuário.
- `$CLAUDE_PLUGIN_ROOT/skills/shared/references/delegate-to-gemini.md` — uso opcional do `agy` para
  resumir documentação extensa encontrada no passo 1 (mesmo critério de `backlog-ideator`: acima de
  ~80 linhas, delegue o resumo em vez de ler tudo nativamente).

---

## Comportamento

### 0 — Knowledge Provider (conceito)

A descoberta de contexto é feita através de um **Knowledge Provider** — uma fonte de conhecimento do
projeto, abstrata por design:

```
Knowledge Provider
├── filesystem   (implementado nesta skill)
├── obsidian     (fora de escopo aqui — issue futura)
└── future providers
```

Nesta versão da skill, apenas o provider `filesystem` está implementado (passo 1). A skill não
assume nem referencia Obsidian em nenhum ponto do fluxo — quando um provider externo existir, ele
deverá substituir a fonte de busca do passo 1 sem alterar os passos seguintes.

### 1 — Context Discovery (filesystem)

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
5. **Specs existentes:** `docs/specs/**/*.md` — evita duplicar uma Spec já criada para o mesmo tema
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
confirmação do usuário antes do passo 3 (Decomposição).

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

### 3 — Decomposição em componentes

Antes de entrevistar ou redigir qualquer rascunho, avalie se o tema é **grande** o bastante para
exigir decomposição. Um tema é grande quando o contexto do passo 1-2 sustenta **mais de uma**
capacidade independente — sinal disso é a presença de qualquer um destes:

- mais de um fluxo de usuário essencialmente distinto (ex.: "entrar" vs. "recuperar senha");
- mais de uma persona com necessidades diferentes;
- capacidades que poderiam ser entregues, testadas ou desativadas de forma separada;
- dependências ou fronteiras funcionais claras entre partes do tema.

Se **nenhum** desses sinais aparecer (tema já é uma única capacidade atômica, ex.: "adicionar botão
de copiar no card de resultado"), pule este passo e o passo 4 — vá direto ao passo 5.

Quando o tema for grande, identifique os componentes considerando escopo, usuários/personas,
capacidades, critérios de aceitação, dependências e fronteiras funcionais, e apresente-os ao
usuário **antes de prosseguir**:

```
## Decomposição proposta para "<tema>"

1. <Componente 1> — <1 frase: o que cobre>
2. <Componente 2> — <1 frase: o que cobre>
3. <Componente N> — <1 frase: o que cobre>

Confirma esta decomposição, ou deseja ajustar/reorganizar?
```

Exemplo (tema "sistema de autenticação"):

```
## Decomposição proposta para "sistema de autenticação"

1. Login — autenticação de credenciais e emissão de sessão.
2. Recuperação de senha — fluxo de redefinição para usuário que perdeu acesso.
3. Sessão — manutenção, expiração e renovação do estado autenticado.
4. Autorização — controle de acesso a recursos após autenticação.

Confirma esta decomposição, ou deseja ajustar/reorganizar?
```

O usuário pode confirmar, pedir ajustes (adicionar/remover/renomear/fundir componentes) ou
reorganizar. Limite a **no máximo 2 rodadas de ajuste** após a proposta inicial — evita loop
infinito de refinamento. Ao atingir o limite sem confirmação explícita, prossiga com a última
versão da decomposição e registre a divergência residual em `Open Questions` no rascunho (passo 5),
em vez de insistir em mais uma rodada.

Trate cada componente confirmado como uma unidade independente para o passo 4 e para as seções de
`Functional Requirements` do rascunho (passo 5).

### 4 — Entrevista focada

Só entreviste quando o contexto reunido nos passos 1-3 **não** for suficiente para produzir, para
aquele componente (ou para o tema inteiro, se o passo 3 foi pulado), uma Spec confiável — isto é,
quando falta informação que mudaria de forma significativa o conteúdo do rascunho (ex.: altera um
Acceptance Criteria, muda um Non-Goal, ou decide um Edge Case). Nunca pergunte por completude
cosmética ou sobre cenário hipotético/futuro (ver `planning-conventions.md` §3, "Regra das 3
perguntas").

Para cada componente que precisar de entrevista, faça **no máximo 3 perguntas objetivas**,
priorizando nesta ordem (pare assim que tiver o suficiente — nem sempre as 3 são necessárias):

1. problema que está sendo resolvido;
2. resultado esperado;
3. escopo e não-escopo;
4. comportamento esperado;
5. casos de erro;
6. restrições relevantes.

Se, após 3 perguntas, ainda faltar informação para aquele componente, **não faça uma quarta
pergunta** — marque a lacuna como `⚠️ ABERTO: <o que falta definir>` no rascunho (passo 5), o mesmo
idioma já usado no restante da skill para incerteza.

### 5 — Montar o rascunho a partir do template

Copie a estrutura de `templates/spec.md` e preencha, a partir **apenas** do que foi encontrado ou
confirmado nos passos 1-4:

- **Título / Summary:** derive do tema e do contexto encontrado, em 1-2 frases.
- **Context:** síntese das fontes relevantes, citando os arquivos de origem.
- Demais seções (Goals, Non-Goals, Users/Personas, Functional Requirements, Non-Functional
  Requirements, Behavior/States, Data, Integrations/Dependencies, Edge Cases, Error Handling,
  Security/Privacy, Rollout, Decisions, References): preencha o que o contexto sustenta; onde a
  informação não existir, escreva explicitamente `⚠️ ABERTO: <o que falta definir>` em vez de deixar
  a seção vazia ou inventar conteúdo.
- **Open Questions:** liste toda pergunta ainda sem resposta identificada durante a descoberta, a
  decomposição (divergência residual do passo 3) e a entrevista (lacunas marcadas `⚠️ ABERTO` no
  passo 4).
- **Revision History:** uma linha inicial com a data e "rascunho inicial gerado por /vetor:spec".

Quando o passo 3 identificou componentes, espelhe-os na estrutura de `Functional Requirements`
(ex.: agrupe os RF-XX de cada componente sob um subtítulo com o nome do componente) em vez de
diluir os componentes num único bloco de requisitos.

Mantenha a estrutura extensível — não invente seções obrigatórias fora do template, e não force
seções irrelevantes para um tema pequeno (ver `templates/spec.md`).

### 6 — Apresentar o rascunho

Mostre o rascunho completo na conversa para revisão do usuário. Explicite o que esta versão da skill
**não** cobre ainda, para não sugerir uma qualidade que ela ainda não entrega:

- motor de geração aprofundado de RF/RNF/Acceptance Criteria/Edge Cases;
- validação de qualidade (Quality Gate) e refinamento iterativo;
- persistência em `docs/specs/` com controle de overwrite;
- Knowledge Provider além de filesystem (ex.: Obsidian).

Esta skill **não grava a Spec em disco** — o rascunho fica apenas na conversa até que a persistência
seja implementada.

---

## Restrições

- Nunca afirme certeza sobre um requisito que o contexto descoberto não sustenta — marque como
  `⚠️ ABERTO`.
- Nunca decida sozinho sobrescrever uma Spec existente encontrada no passo 1 — pergunte ao usuário.
- Nunca acople a descoberta de contexto a um provider específico além de filesystem.
- Nunca persista arquivos em `docs/specs/` nesta versão da skill.
- Nunca omita uma categoria de busca do relatório do passo 2, mesmo quando vazia.
- Nunca gere o rascunho (passo 5) sem antes apresentar a decomposição (passo 3) quando o tema for
  grande — a confirmação do usuário é obrigatória, não opcional.
- Nunca ultrapasse 2 rodadas de ajuste na decomposição (passo 3) — ao atingir o limite, prossiga com
  a última versão e registre a divergência em `Open Questions`.
- Nunca faça mais de 3 perguntas por componente na entrevista (passo 4) — ver `planning-conventions.md`
  §3 ("Regra das 3 perguntas"). Ao esgotar o limite sem resposta suficiente, marque `⚠️ ABERTO` em vez
  de perguntar de novo.
- Nunca pergunte quando a resposta não mudaria a Spec de forma significativa (ex.: não alteraria um
  Acceptance Criteria, Non-Goal ou Edge Case) — prossiga com o que já foi descoberto.
