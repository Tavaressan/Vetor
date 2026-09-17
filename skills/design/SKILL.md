---
name: design
description: Skill de design do Vetor — (1) detecta o modo de operação (Prototype-first/System-first/Vetor-first #213), importa um Design System existente sem duplicá-lo e mantém a Design Direction persistente em .vetor/design/; (2) Frontend Self-Correction Loop (Design Contract → Build → Run → Inspect → Screenshot → Accessibility Snapshot → Critique → Fix → Verify → Done) com Visual Critique em 10 dimensões e degradação graciosa sem MCP de browser. Consumida por issue-worker/fix-loop-agent ao implementar ou corrigir UI de frontend.
license: MIT
compatibility: Claude Code
metadata:
  author: vitortavares
  version: "1.1.0"
---

Você é a skill de design do Vetor. Cobre duas responsabilidades sequenciais do fluxo de frontend
(#213):

1. **Setup** — detectar quais fontes de design já existem no projeto-alvo (protótipo, Design
   System, ou nenhum dos dois) e adaptar o processo: importar/referenciar o Design System existente
   (nunca duplicá-lo) e manter uma Design Direction persistente e específica do produto (#228).
2. **Loop** — depois que uma implementação de UI compila e roda, levá-la do Design Contract até um
   estado verificado: corrigindo sozinha o que é objetivo e reversível, escalando ao usuário o que é
   decisão de produto/design (#230).

Extração de conteúdo de um protótipo (handoff completo) e o formato do Design Contract em si são
escopo de issues futuras — não implementados aqui (ver `design-vocabulary.md` para o vocabulário já
definido).

---

## Sintaxe

```
/design [<diretório>]
```

- `<diretório>`: opcional — raiz do projeto a varrer para o Setup (modo de operação + import).
  Default: raiz do projeto atual (`.`).

O Loop (self-correction) não é tipicamente invocado por um comando de usuário — é consumido por
`issue-worker`/`fix-loop-agent` (via `frontend-design-enforcement.md`) depois que a implementação de
uma tela/fluxo de UI compila e roda. Também pode ser invocado manualmente com
`Skill({skill: "design"})` para verificar uma tela de frontend já implementada.

---

## Referências

- `$CLAUDE_PLUGIN_ROOT/skills/shared/references/design-vocabulary.md` — Design System, Design
  Direction, Design Signature e o formato do Design Contract (entrada do Loop, passo 1). Não
  replique as definições aqui — cite os campos. §4.4 aplica os 4 estados de Evidence State às
  Decisões do Design Contract — exemplo completo em `skills/design/examples/design-contract-example.md`.
- `$CLAUDE_PLUGIN_ROOT/skills/shared/references/evidence-state.md` — `OPEN_QUESTION` usado em
  `patterns.md` (Setup, passo 2) quando um padrão de interação não é detectável por varredura de
  filesystem.
- `$CLAUDE_PLUGIN_ROOT/skills/shared/references/frontend-design-enforcement.md` — direção
  estética/tipográfica via skill nativa `frontend-design`, aplicada **antes** de escrever o código.
  O Loop é complementar e roda **depois**: verifica o que foi construído, não decide como desenhar.
- `$CLAUDE_PLUGIN_ROOT/skills/shared/references/mcp-availability.md` — mecanismo de checagem de
  disponibilidade (procurar `mcp__<server>__` na lista de ferramentas). Servidores relevantes aqui:
  browser (`mcp__chrome-devtools__`, `mcp__playwright__`) para os passos 4-6 e 9 do Loop, Context7
  para qualquer comportamento de framework/lib consultado durante o Fix (Loop, passo 8).
- `scripts/lib/design-mode.ts` — lógica de detecção/renderização do Setup (pura, testada em
  `scripts/tests/design-mode_test.ts`).
- `scripts/detect-design-mode.ts` — CLI que orquestra a escrita em disco do Setup a partir da lib
  acima.
- `scripts/lib/design-loop-mcp.ts` — `detectBrowserMcpServer`/`reportLoopStep`: formaliza o relato
  de cada passo do Loop dependente de MCP de browser quando ele não está disponível, para nunca
  pular uma etapa em silêncio nem fingir que a inspeção ocorreu (ver Loop §"Sem MCP de browser").
- `$CLAUDE_PLUGIN_ROOT/skills/shared/references/tdd-conventions.md` — disciplina de teste aplicada
  ao Fix (Loop, passo 8): reproduza o problema objetivo antes de corrigi-lo, quando o módulo tiver
  suíte.

---

## Setup — Modo de operação, Design System Import, Design Direction

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

## Loop — Frontend Self-Correction

### 0 — Quando aplicar

Mesmos sinais de `frontend-design-enforcement.md` §"Como detectar": label `ui`/`frontend`/`design`,
ou menção a UI, interface, layout, componente visual, tela, página, CSS, estilo, tipografia, design
system, mockup, wireframe. Não aplique a módulos puramente backend/CLI/infra.

### 1 — Design Contract

Entrada do loop: o Design Contract da tela/fluxo (`design-vocabulary.md` §4) — objetivo,
hierarquia, componentes, tokens, estados, responsividade, acessibilidade. Se não existir um Design
Contract explícito para a mudança, trate a Specification + código de referência do Design System
(ver Setup, acima) como a melhor aproximação disponível e **registre isso como premissa** no
relatório final do loop — nunca invente decisões de design que deveriam vir do contrato.

### 2 — Build

Rode o build do módulo alterado (comando do `module-test-map.md`, ou o comando de build do
projeto-alvo quando distinto do de teste). Build quebrado é sempre autocorrigível (é um erro
objetivo) — corrija e repita antes de prosseguir; não avance para Run com build vermelho.

### 3 — Run

Suba a aplicação (dev server, preview build, ou o mecanismo que a skill `run` já usa para o
projeto). Se subir falhar, trate como o mesmo tipo de erro objetivo do passo 2.

**Sem MCP de browser disponível**, você ainda pode confirmar que o processo subiu (porta aberta,
log de inicialização) por CLI — isso não depende de MCP. O que depende de MCP são os passos 4-6.

### 4 — Inspect

Com MCP de browser disponível: navegue até a tela (`navigate_page`), interaja com os fluxos que a
mudança afeta (`click`/`fill`/`fill_form`), e colete o estado renderizado.

**Sem MCP de browser:** chame `reportLoopStep("inspect", <ferramentas disponíveis>)` de
`scripts/lib/design-loop-mcp.ts` (ou aplique o mesmo raciocínio manualmente) e inclua a `limitation`
retornada no relatório final. Prossiga o loop com o que é verificável sem browser: leitura do
código, dos testes existentes e do Design Contract. Nunca pule esta etapa em silêncio, nunca marque
como verificada sem tê-la executado.

### 5 — Screenshot

Com MCP: `take_screenshot` da tela em pelo menos o viewport padrão do Design Contract.

Sem MCP: mesmo tratamento do passo 4 — `reportLoopStep("screenshot", ...)`, sem inventar uma
descrição visual do que não foi capturado.

### 6 — Accessibility Snapshot

Com MCP: capture a árvore de acessibilidade (ex.: `take_snapshot`/accessibility tree do MCP de
browser em uso) — papéis (roles), rótulos (labels), ordem de foco.

Sem MCP: mesmo tratamento — `reportLoopStep("accessibility_snapshot", ...)`. A verificação estática
ainda é possível e deve ser feita: leia o JSX/HTML alterado e confira `alt`, `aria-*`, associação
`label`/`input`, ordem de tab implícita pela ordem do DOM — mas isso é revisão de código, não
inspeção ao vivo, e o relatório final deve dizer isso explicitamente.

### 7 — Critique (Visual Critique)

Avalie a implementação nas **10 dimensões** abaixo. Cada dimensão recebe um veredito objetivo:
`ok`, `problema encontrado` (com o achado descrito), ou `não verificável sem MCP de browser` (para
as dimensões que dependem de renderização real quando não há MCP — ver coluna "Sem MCP").

| # | Dimensão | O que avalia | Sem MCP |
|---|----------|---------------|---------|
| 1 | Specification fidelity | A implementação cobre o que a Specification pede — nenhum requisito perdido ou reinterpretado | Verificável (leitura de código × spec) |
| 2 | Design fidelity | A implementação reflete o Design Contract (componentes, tokens, hierarquia) — não uma interpretação livre | Parcialmente verificável (código × contrato); confirmação visual fica pendente |
| 3 | Hierarquia visual | Primário/secundário/terciário estão visualmente distinguíveis, conforme o campo "Hierarquia" do contrato | Não verificável sem MCP |
| 4 | Domain specificity | A interface tem características do produto ou poderia ser de qualquer app parecido (genérica)? | Não verificável sem MCP |
| 5 | Repetição sem justificativa semântica | Padrões repetidos (mesmo componente, mesmo layout) têm razão de domínio, não só conveniência de copiar-colar | Parcialmente verificável (código) |
| 6 | Tipografia | Escala, peso, tracking conforme Design System/Direction | Não verificável sem MCP |
| 7 | Layout | Grid/colunas/regiões conforme o campo "Layout" do contrato | Não verificável sem MCP |
| 8 | Interação/estados | Os estados de `design-vocabulary.md` §4.3 (loading/empty/error/etc.) estão implementados e navegáveis | Parcialmente verificável (código dos handlers/estados); navegação ao vivo fica pendente |
| 9 | Acessibilidade | Foco, contraste, navegação por teclado, semântica (ver passo 6) | Parcialmente verificável (estática) |
| 10 | Comportamento responsivo | Breakpoints do contrato se comportam como especificado | Não verificável sem MCP |

Cada `problema encontrado` vira um item do passo 8 (Fix ou Escalação, conforme o critério abaixo).
Cada `não verificável sem MCP de browser` entra no relatório final como limitação explícita — nunca
como `ok`.

### 8 — Fix vs. Escalação

**Autocorrija** (objetivo e reversível):

- overflow;
- elemento ausente;
- erro JS;
- interação quebrada;
- erro de responsividade;
- console/network error;
- componente divergente do Design Contract.

**Escale ao usuário** (decisão de produto/design — nunca decida sozinho):

- interpretações legítimas conflitantes do protótipo;
- conflito Specification × Prototype;
- mudança de information architecture;
- ausência de ação primária definida;
- mudança de identidade visual;
- conflito Design System × Prototype.

Ao escalar, siga o mecanismo padrão de `BLOCKED_WAITING` (`agent-status.template.md`): descreva a
opção em conflito nos blocos `Blocked on`/`Options`/`Recommendation` — nunca escolha por conta
própria entre interpretações de design legitimamente divergentes.

Para os itens autocorrigíveis, aplique TDD quando o módulo tiver suíte (`tdd-conventions.md`):
reproduza o problema objetivo antes de corrigi-lo — uma fatia por vez, sem refatoração especulativa
fora do escopo do achado.

### 9 — Verify

Repita os passos 2-7 que foram afetados pelo fix (não o loop inteiro, apenas o que o fix pode ter
mudado). Se um fix tocar um passo que dependia de MCP indisponível, o relatório final continua
carregando a mesma limitação daquele passo — corrigir código não substitui uma verificação visual
que nunca ocorreu.

### 10 — Done

Produza um relatório curto com: o veredito de cada uma das 10 dimensões do passo 7, os fixes
aplicados, as escalações pendentes (se houver) e a lista de passos marcados como
`não verificável sem MCP de browser`. **Nunca** declare a tela "verificada visualmente" quando essa
lista não está vazia — declare exatamente o que foi e o que não foi confirmado.

### Sem MCP de browser (degradação graciosa)

Este loop nunca falha nem trava por falta de MCP de browser, e nunca finge que a inspeção ocorreu.
Quando nenhum servidor de browser (`mcp__chrome-devtools__*`, `mcp__playwright__*`) está na lista de
ferramentas da sessão:

1. Os passos 4, 5, 6 e a parte visual do 7/9 usam `reportLoopStep(<step>, <ferramentas>)` de
   `scripts/lib/design-loop-mcp.ts`, que retorna `verdict: "unverified"` com uma `limitation`
   explícita nomeando a etapa pulada — nunca `verdict: "verified"` sem MCP, e a função nunca lança.
2. O loop **continua** com o que é verificável por código: build, testes existentes, leitura
   estática do componente contra o Design Contract (dimensões 1, 2, 5, 8 e 9 parcialmente).
3. O relatório final (passo 10) lista cada limitação — a ausência de MCP é um fato reportado, não um
   detalhe omitido silenciosamente nem um motivo para `BLOCKED_WAITING` (a verificação visual ao
   vivo é sempre opcional; sua ausência não bloqueia entrega, só limita a confiança do veredito).
4. Confirmação visual/acessibilidade ao vivo, quando não houver MCP, fica marcada como validação
   manual pendente pós-merge — nunca como critério de `GREEN` do worker.

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
- Nunca implementa extração de conteúdo de protótipo nem o formato do Design Contract nesta skill —
  escopo de #213, issues futuras.
