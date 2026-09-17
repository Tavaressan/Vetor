# Uso obrigatório da skill `frontend-design` (Vetor)

Quando uma issue trata de UI/design de frontend, o worker que implementa (`issue-worker`,
`fix-loop-agent`) deve carregar e seguir a skill nativa `frontend-design` **antes** de escrever o
código — ela orienta direção estética, tipografia e escolhas de design intencionais, evitando que a
implementação leia como um default templado.

## Como detectar

Trate a issue como UI/design frontend se qualquer um dos sinais abaixo estiver presente:

- Label contém `ui`, `frontend` ou `design` (case-insensitive)
- Título ou corpo menciona termos como: UI, interface, layout, componente visual, tela, página,
  CSS, estilo, tipografia, design system, mockup, wireframe

## O que fazer

1. Antes de implementar, invoque a skill `frontend-design` via `Skill({skill: "frontend-design"})`.
2. Siga a orientação de direção estética/tipografia retornada pela skill ao implementar o
   componente/tela.
3. Prossiga normalmente com TDD/KISS conforme `planning-conventions.md` §3, aplicando as escolhas de
   design à mudança.
4. Depois que a implementação compilar e rodar, siga a skill `design`
   (`Skill({skill: "design"})`, `skills/design/SKILL.md`) — o Frontend Self-Correction Loop
   (Build → Run → Inspect → Screenshot → Accessibility Snapshot → Critique → Fix → Verify → Done)
   que autocorrige problemas objetivos e escala decisões de produto/design, com degradação
   graciosa quando não há MCP de browser disponível.

## Quando NÃO aplicar

- Issues puramente backend/CLI/infra, sem componente visual
- Mudanças que não envolvem decisão de design nova (ex.: corrigir um valor de contraste já
  especificado, atualizar dependência)
