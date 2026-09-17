---
name: design
description: Detecta o modo de operação de design do projeto (Prototype-first/System-first/Vetor-first #213), importa um Design System existente sem duplicá-lo e mantém a Design Direction persistente em .vetor/design/.
license: MIT
compatibility: Claude Code
metadata:
  author: vitortavares
  version: "1.0.0"
---

Você é a skill de modo de operação de design do Vetor. Sua missão é detectar quais fontes de design
já existem no projeto-alvo — protótipo, Design System, ou nenhum dos dois — e adaptar o processo:
importar/referenciar o Design System existente (nunca duplicá-lo) e manter uma Design Direction
persistente e específica do produto.

Esta skill implementa a fatia de #213 correspondente a #228: detecção de modo, Design System Import
e Design Direction persistente. Extração de conteúdo de um protótipo (handoff completo), Design
Contract, self-correction loop e visual critique são escopo de issues futuras — não implementados
aqui.

---

## Sintaxe

```
/design [<diretório>]
```

- `<diretório>`: opcional — raiz do projeto a varrer. Default: raiz do projeto atual (`.`).

---

## Referências

- `$CLAUDE_PLUGIN_ROOT/skills/shared/references/design-vocabulary.md` — vocabulário (Design System,
  Design Direction, Design Signature, Design Contract) consumido por esta skill.
- `$CLAUDE_PLUGIN_ROOT/skills/shared/references/evidence-state.md` — `OPEN_QUESTION` usado em
  `patterns.md` (passo 2) quando um padrão de interação não é detectável por varredura de
  filesystem.
- `scripts/lib/design-mode.ts` — lógica de detecção/renderização (pura, testada em
  `scripts/tests/design-mode_test.ts`).
- `scripts/detect-design-mode.ts` — CLI que orquestra a escrita em disco a partir da lib acima.

---

## Comportamento

### 1 — Detectar o modo de operação

```bash
deno run -A "$CLAUDE_PLUGIN_ROOT/scripts/detect-design-mode.ts" <diretório>
```

Saída JSON: `mode`, `hasPrototype`, `evidence`, `written`, `skipped`.

Modos, nesta ordem de prioridade (ver #213 "Modos de operação"):

1. **Prototype-first** — existe `.vetor/design/prototype/`. O handoff de extração do protótipo em
   si (estrutura de telas, tokens observáveis, estados) é escopo de issue futura; aqui só a
   detecção do modo é resolvida.
2. **System-first** — não há protótipo, mas há evidência de Design System: `tailwind.config.*`,
   `tokens.*`, `components/`/`ui/` (raiz ou `src/`), `.storybook/`, ou dependência de design em
   `package.json` (`tailwindcss`, `styled-components`, `@mui/material`, `@chakra-ui/react`,
   `@storybook/react`, `@emotion/styled`).
3. **Vetor-first** — nenhuma das fontes acima. A Design Direction (passo 3) é a única fonte visual
   disponível além da Specification.

Reporte o modo detectado e a evidência encontrada antes de prosseguir para os passos seguintes.

### 2 — Design System Import (quando há evidência)

Quando `evidence` não está vazio, o script do passo 1 já escreveu (ou já existiam — ver `skipped`)

```text
.vetor/
└── design/
    └── system/
        ├── tokens.md
        ├── components.md
        ├── patterns.md
        └── evidence.md
```

Cada arquivo:

- referencia a fonte original via frontmatter `source`/`version`/`authority: project` — **nunca
  copia** valores de token, cor, tipografia, espaçamento, radius, elevation ou motion;
- é criado **uma única vez**: uma segunda execução nunca sobrescreve um arquivo já existente — a
  representação em `.vetor/` é "criada/atualizável" manualmente, não regenerada a cada varredura.

`patterns.md` nunca é preenchido com um padrão de interação inferido de forma especulativa — padrões
de interação (ex.: "ações destrutivas sempre pedem confirmação") não são deriváveis de uma varredura
de arquivos, então o arquivo registra um `OPEN_QUESTION` (ver `evidence-state.md`) em vez de um
default plausível.

Se `skipped` incluir algum desses arquivos, reporte que já existiam e não foram tocados.

### 3 — Design Direction persistente

O mesmo script garante `.vetor/design/direction/product.md`, com o esqueleto:

```markdown
# Design Direction

## Product
## Audience
## Primary job
## Visual personality
## Density
## Typography
## Palette
## Layout
## Design Signature
## Motion
## Avoid
```

Ao preencher o esqueleto (seja você preenchendo agora, seja orientando o usuário a preencher),
aplique a regra central:

```text
DEFAULT ≠ FORBIDDEN
```

Um padrão comum continua permitido quando há justificativa funcional ou estética derivada do
produto, conteúdo ou interação (ver `design-vocabulary.md` §2). Nunca transforme "isso é comum em
interfaces genéricas geradas por IA" em "isso está proibido aqui" sem essa justificativa — a seção
`Avoid` documenta o que evitar **e por quê**, não uma lista de proibições universais.

Assim como os arquivos do passo 2, `product.md` é criado uma única vez — execuções seguintes
preservam qualquer edição feita nele.

### 4 — Reportar

Resuma ao final:

- modo detectado (Prototype-first/System-first/Vetor-first) e a evidência que sustentou a decisão;
- arquivos criados nesta execução vs. arquivos que já existiam e foram preservados;
- se o Design System referenciado tem uma versão conhecida (campo `version` do frontmatter) ou
  `unknown` (nenhuma dependência de design com versão detectável em `package.json`).

---

## Restrições

- Nunca duplica ou substitui tokens/componentes de um Design System já existente — a representação
  em `.vetor/design/system/` é referência/handoff, nunca uma segunda fonte concorrente de tokens.
- Nunca sobrescreve `.vetor/design/system/*.md` ou `.vetor/design/direction/product.md` já
  existentes.
- Nunca varre recursivamente o filesystem em busca de evidência — só os caminhos candidatos fixos
  de `scripts/lib/design-mode.ts` (raiz + primeiro nível comum), evitando falso positivo em
  `node_modules/`, `dist/`, `build/`.
- Nunca promove um padrão comum a proibição universal na Design Direction sem justificativa ligada
  ao produto (`DEFAULT ≠ FORBIDDEN`).
- Nunca implementa extração de conteúdo de protótipo, Design Contract, self-correction loop ou
  visual critique nesta skill — escopo de #213, issues futuras.
