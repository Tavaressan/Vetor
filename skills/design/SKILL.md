---
name: design
description: Frontend Self-Correction Loop — Design Contract → Build → Run → Inspect → Screenshot → Accessibility Snapshot → Critique → Fix → Verify → Done. Visual Critique em 10 dimensões, critério explícito de autocorreção vs. escalação, MCPs de browser (Playwright/Chrome DevTools) e Context7 como capacidades opcionais com degradação graciosa. Consumida por issue-worker/fix-loop-agent ao implementar ou corrigir UI de frontend.
license: MIT
compatibility: Claude Code
metadata:
  author: vitortavares
  version: "1.0.0"
---

Você é o loop de autocorreção de frontend do Vetor. Sua missão é levar uma implementação de UI do
Design Contract até um estado verificado — corrigindo sozinho o que é objetivo e reversível,
escalando ao usuário o que é decisão de produto/design (#213, #230).

---

## Sintaxe

Esta skill não é tipicamente invocada por um comando de usuário — é consumida por `issue-worker` e
`fix-loop-agent` (via `frontend-design-enforcement.md`) depois que a implementação de uma tela/fluxo
de UI compila e roda. Também pode ser invocada manualmente com `Skill({skill: "design"})` para
verificar uma tela de frontend já implementada.

---

## Referências

- `$CLAUDE_PLUGIN_ROOT/skills/shared/references/design-vocabulary.md` — Design System, Design
  Direction, Design Signature e o formato do Design Contract (entrada do passo 1). Não replique as
  definições aqui — cite os campos.
- `$CLAUDE_PLUGIN_ROOT/skills/shared/references/frontend-design-enforcement.md` — direção
  estética/tipográfica via skill nativa `frontend-design`, aplicada **antes** de escrever o código.
  Este loop é complementar e roda **depois**: verifica o que foi construído, não decide como
  desenhar.
- `$CLAUDE_PLUGIN_ROOT/skills/shared/references/mcp-availability.md` — mecanismo de checagem de
  disponibilidade (procurar `mcp__<server>__` na lista de ferramentas). Servidores relevantes aqui:
  browser (`mcp__chrome-devtools__`, `mcp__playwright__`) para os passos 4-6 e 9, Context7 para
  qualquer comportamento de framework/lib consultado durante o Fix (passo 8).
- `scripts/lib/design-loop-mcp.ts` — `detectBrowserMcpServer`/`reportLoopStep`: formaliza o relato
  de cada passo dependente de MCP de browser quando ele não está disponível, para nunca pular uma
  etapa em silêncio nem fingir que a inspeção ocorreu (ver §3 "Sem MCP de browser").
- `$CLAUDE_PLUGIN_ROOT/skills/shared/references/tdd-conventions.md` — disciplina de teste aplicada
  ao Fix (passo 8): reproduza o problema objetivo antes de corrigi-lo, quando o módulo tiver suíte.

---

## Comportamento

### 0 — Quando aplicar

Mesmos sinais de `frontend-design-enforcement.md` §"Como detectar": label `ui`/`frontend`/`design`,
ou menção a UI, interface, layout, componente visual, tela, página, CSS, estilo, tipografia, design
system, mockup, wireframe. Não aplique a módulos puramente backend/CLI/infra.

### 1 — Design Contract

Entrada do loop: o Design Contract da tela/fluxo (`design-vocabulary.md` §4) — objetivo,
hierarquia, componentes, tokens, estados, responsividade, acessibilidade. Se não existir um Design
Contract explícito para a mudança, trate a Specification + código de referência do Design System
como a melhor aproximação disponível e **registre isso como premissa** no relatório final do loop —
nunca invente decisões de design que deveriam vir do contrato.

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

---

## Sem MCP de browser (degradação graciosa)

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
