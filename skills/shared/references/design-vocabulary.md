# Vocabulário de Design (Vetor)

Define os termos que o workflow de design do Vetor usa para tratar design como **input de
engenharia, não decoração** (#213). Três conceitos — Design System, Design Direction e Design
Signature — alimentam um artefato intermediário, o **Design Contract**, que é o que de fato chega
à implementação.

```text
Specification
     +
Design System
     +
Design Direction
     +
Prototype
     ↓
Design Contract
     ↓
Frontend Implementation
```

Consumido por `frontend-design-enforcement.md` e pela skill `frontend-design` (verificação de
UI/design de frontend) e pelo `fix-loop-agent` quando a descrição do fix envolve UI.

As Decisões do Design Contract (§4.4) usam o modelo de estados epistêmicos definido em
`$CLAUDE_PLUGIN_ROOT/skills/shared/references/evidence-state.md` (#214) — este documento **consome**
esse modelo, não o redefine.

---

## 1. Design System

Elementos reutilizáveis e regras visuais **disponíveis** para o produto — o vocabulário visual
compartilhado por todas as telas.

Escopo típico:

* design tokens;
* cores;
* tipografia;
* espaçamento;
* radius;
* elevation;
* motion;
* componentes;
* padrões de interação.

O Design System define **como o produto pode ser construído visualmente**, mas não decide sozinho
a composição de nenhuma tela específica — isso é papel da Design Direction.

**Exemplo:**

```markdown
## Design System — Acme Dashboard

### Tokens
- `--color-primary`: #22409A
- `--color-danger`: #B3261E
- `--radius-sm`: 4px / `--radius-md`: 8px
- `--space-1`..`--space-8`: escala de 4px

### Tipografia
- Family: Inter
- Scale: 12/14/16/20/24/32 (px), line-height 1.4

### Componentes disponíveis
Button (primary/secondary/ghost/danger), Card, Modal, Toast, DataTable, Badge

### Padrões de interação
- Ações destrutivas sempre pedem confirmação via Modal.
- Formulários validam on-blur, nunca on-keystroke.
```

Quando o produto já tem um Design System (ex.: Storybook, `tailwind.config.*`, `tokens.*`), o Vetor
deve referenciá-lo em vez de duplicá-lo — a representação em `.vetor/design/system/` é
documentação/handoff, nunca uma segunda fonte concorrente de tokens.

---

## 2. Design Direction

Identidade visual **específica de uma experiência** — o que evita que a interface convirja para o
"padrão genérico de app gerado por IA" só porque o Design System tecnicamente permite.

Escopo típico:

* personalidade visual;
* densidade;
* hierarquia;
* composição;
* alinhamento;
* tratamento tipográfico;
* uso de cor;
* linguagem visual;
* elementos característicos;
* elementos a evitar.

Regra geral: **DEFAULT ≠ FORBIDDEN**. Um padrão comum continua permitido quando há justificativa
funcional ou estética derivada do produto — a Design Direction não deve virar uma lista de
proibições universais.

**Exemplo:**

```markdown
## Design Direction — Acme Dashboard

### Personalidade visual
Técnica, direta, sem elementos decorativos. Prioriza densidade de informação sobre "respiro" visual.

### Densidade
Alta — tabelas e listas compactas, sem cards grandes para dados tabulares.

### Hierarquia
Ação primária de cada tela é sempre um botão sólido no topo direito; ações secundárias são links
ou botões ghost.

### Tratamento tipográfico
Títulos de seção em caixa alta, tracking +2%, peso 600.

### Evitar
- Gradientes decorativos sem função.
- Ilustrações genéricas de estoque.
- Cards com sombra pesada para conteúdo tabular.
```

---

## 3. Design Signature

Elemento ou princípio visual **distintivo, derivado do domínio do produto** — quando apropriado.
**Nunca obrigatório.**

O objetivo não é forçar uma decoração chamativa em cada tela. É evitar que a identidade da
interface fique reduzida a:

```text
layout genérico + nova paleta + novo logo
```

**Exemplo:**

```text
Signature:
Visualização do fluxo de desenvolvimento (backlog → worktree → execução →
shipping) como elemento estrutural da interface, não como decoração isolada.

Reason:
O produto organiza trabalho através desse fluxo; torná-lo visível reforça o
modelo mental do usuário em vez de escondê-lo atrás de menus genéricos.
```

Se o domínio não sugerir nada distintivo, **não invente uma signature artificial** — um Design
System bem aplicado com uma Design Direction consistente já é suficiente (YAGNI).

---

## 4. Design Contract

Artefato intermediário entre design e implementação. Consolida:

```text
Specification + Design System + Design Direction + Prototype + Evidence + Constraints
```

e entrega ao agente as decisões necessárias para implementar a interface — **não o protótipo em
si**.

### 4.1 Design Contract ≠ cópia do protótipo

O Design Contract nunca deve ser uma transcrição visual do protótipo (posição de pixel, screenshot
anotada, cópia de camadas de uma ferramenta de design). Ele registra **as decisões que precisam
sobreviver à transferência do design para código**: intenção, hierarquia, tokens usados, estados
previstos, restrições técnicas reais. Copiar pixels otimiza para semelhança visual superficial;
o Design Contract otimiza para preservar `prototype intent + real application data + real
application states + real technical constraints` (#213).

Um Design Contract correto deve permitir implementar a tela corretamente mesmo que o protótipo
original se torne indisponível.

### 4.2 Campos do formato

Todo campo é usado **conforme aplicável** — nem toda tela precisa preencher todos os campos, mas
o campo deve existir na estrutura para ser considerado.

| Campo | Descreve |
|-------|----------|
| Objetivo da experiência | Que problema esta tela/fluxo resolve para o usuário |
| Telas | Quais telas/estados de navegação fazem parte do escopo |
| Hierarquia | O que é primário, secundário, terciário em cada tela |
| Layout | Estrutura de composição (grid, colunas, regiões) |
| Componentes | Quais componentes do Design System são usados, e onde |
| Tokens | Quais tokens (cor, espaçamento, tipografia, radius, elevation, motion) se aplicam |
| Conteúdo | Textos, labels, mensagens — reais, não lorem ipsum |
| Interações | O que acontece a cada ação do usuário (clique, hover, submit, etc.) |
| Estados | loading / empty / populated / error / partial failure / permission denied / offline / disabled / success — ver §4.3 |
| Responsividade | Comportamento em diferentes viewports/breakpoints |
| Acessibilidade | Foco, contraste, navegação por teclado, semântica |
| Restrições | Limitações técnicas reais que o protótipo pode não refletir |
| Referências | Links/paths para Specification, protótipo, Design System, Design Direction |
| Decisões | Decisões de design já tomadas, com origem (ver Evidence State) |
| Questões abertas | O que ainda não foi decidido e precisa de escalação humana |

### 4.3 Estados de interface

Além do "happy path" mostrado no protótipo, o contrato deve especificar os estados relevantes:

```text
loading, empty, populated, error, partial failure, permission denied, offline, disabled, success
```

**Exemplo:**

```markdown
## State: Empty

Trigger:
Nenhum worktree ativo.

Expected behavior:
Explicar que não há worktree ativo no momento.

Primary action:
Criar worktree.

Visual treatment:
Ilustração mínima + texto + botão primário, centralizado na área de conteúdo.

Evidence:
Prototype + Specification
```

### 4.4 Evidence State nas decisões

O campo "Decisões" usa os 4 estados de `evidence-state.md` (#214) — `CONFIRMED`, `INFERRED`,
`ASSUMED`, `OPEN_QUESTION`. Esta seção não redefine os estados nem o formato de Evidence Record
(§2 de `evidence-state.md`) — aplica o modelo já existente às decisões de design, preservando a
mesma assimetria de campos por estado: `CONFIRMED`/`INFERRED` citam `Source`; `ASSUMED` cita
`Reason` (sem `Source` — não há fonte a apontar para uma premissa); `OPEN_QUESTION` cita `Impact`
(sem `Source` nem confidence).

`evidence-state.md` §3 não lista "Prototype" nem "Design System" entre os tipos formais de
Evidence Source (`code`, `documentation`, `spec`, `adr`, `configuration`, `user`, `external`,
`tool`, `test`). No vocabulário de design, `Source: Prototype`/`Source: Design System` é o rótulo
legível usado nos exemplos abaixo; ao persistir como Evidence Record yaml, o `type` formal segue o
mapeamento: Prototype → `external`, Design System → `documentation`/`configuration`,
Specification → `spec`.

```text
CONFIRMED
Ação primária é "Criar worktree".
Source: Prototype

INFERRED
A sidebar representa navegação persistente do projeto.
Source: Prototype + Specification

ASSUMED
Navegação desktop permanece expandida acima de 1024px.
Reason: Nenhuma tela do protótipo cobre breakpoints intermediários; premissa necessária para
avançar a especificação.

OPEN_QUESTION
Filtros devem persistir entre sessões?
Impact: Afeta se o estado do filtro precisa ser persistido em storage do cliente ou servidor.
```

`OPEN_QUESTION` vai para o campo "Questões abertas" do contrato, não para "Decisões" (ver exemplo
completo em `skills/design/examples/design-contract-example.md`).

**Proibição de auto-promoção** (regra fundamental de `evidence-state.md` §5, aplicada aqui sem
redefinição): o Vetor nunca promove automaticamente

```text
INFERRED → CONFIRMED
ASSUMED  → CONFIRMED
```

sem nova evidência qualificada (§3). Ex.: a sidebar permanecer `INFERRED` como navegação
persistente não vira `CONFIRMED` só porque a implementação seguiu essa leitura — apenas evidência
adicional (Specification explícita, decisão do usuário, ADR) promove o estado.

### 4.5 Esqueleto do documento

```markdown
# Design Contract — <tela ou fluxo>

## Objetivo da experiência
...

## Telas
...

## Hierarquia
...

## Layout
...

## Componentes
...

## Tokens
...

## Conteúdo
...

## Interações
...

## Estados
### State: <nome>
Trigger / Expected behavior / Primary action / Visual treatment / Evidence

## Responsividade
...

## Acessibilidade
...

## Restrições
...

## Referências
...

## Decisões
<Evidence State por decisão — ver §4.4>

## Questões abertas
...
```

---

## 5. Relação entre os conceitos

```text
Design System     → o que está disponível (tokens, componentes, regras)
Design Direction   → como a identidade específica deste produto usa o que está disponível
Design Signature   → (opcional) o que torna esta experiência distintiva no domínio
Design Contract    → a síntese de tudo isso + Specification + Prototype + Constraints,
                      em decisões que sobrevivem à implementação
```
