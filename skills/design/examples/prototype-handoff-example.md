> Exemplo de handoff completo (#229): Design Contract gerado por
> `renderDesignContract`/`handoff-prototype.ts` (`scripts/lib/design-handoff.ts`) a partir de uma
> extração estruturada do protótipo do Painel de Worktrees. Cobre os 9 estados canônicos de
> `design-vocabulary.md` §4.3 — 4 especificados (`empty`, `error`, `loading`, `populated`) e 5
> marcados explicitamente como não aplicáveis a esta tela, cada um com a razão registrada; nenhum é
> omitido em silêncio. Continuação do exemplo mínimo de Evidence State em
> `design-contract-example.md` (#214), agora com a extração completa do handoff.

# Design Contract — Painel de Worktrees

## Objetivo da experiência

Permitir ao usuário visualizar os worktrees ativos do projeto e criar um novo sem sair da aplicação.

## Telas

Painel de Worktrees (lista) → Modal de criação de worktree.

## Hierarquia

Ação primária ('Criar worktree') é o botão sólido no topo direito da tela; a lista de worktrees é o conteúdo primário abaixo dela; a sidebar é navegação secundária persistente.

## Componentes

Button (primary/ghost), Card (item de worktree), Modal (criação), Badge (status).

## Conteúdo

Título da tela: 'Worktrees ativos'. Botão primário: 'Criar worktree'. Cada card mostra o nome da branch e o status (ativo/stale).

## Interações

Clique em 'Criar worktree' abre o Modal de criação. Clique num card de worktree navega para o detalhe. Clique fora do Modal ou Esc fecha sem salvar.

## Estados

### State: empty

Trigger:
Nenhum worktree ativo no projeto.

Expected behavior:
Explicar que não há worktree ativo no momento, sem tratar como erro.

Primary action:
Criar worktree.

Visual treatment:
Ilustração mínima + texto + botão primário, centralizado na área de conteúdo.

Evidence:
Prototype + Specification

### State: error

Trigger:
Falha ao carregar a lista de worktrees (erro de rede ou filesystem).

Expected behavior:
Exibir mensagem de erro específica (não genérica) com opção de tentar novamente; nunca falhar silenciosamente para uma lista vazia.

Primary action:
Tentar novamente.

Evidence:
Specification

### State: loading

Trigger:
Lista de worktrees ainda sendo carregada.

Expected behavior:
Exibir skeleton dos cards, sem layout shift quando os dados chegarem.

Evidence:
Specification

### State: populated

Trigger:
Um ou mais worktrees ativos.

Expected behavior:
Listar cada worktree com nome da branch e status.

Evidence:
Prototype

### State: permission denied

Not applicable:
O painel roda localmente, sem controle de permissão por usuário nesta versão.

### State: offline

Not applicable:
Ferramenta de desenvolvimento local — não depende de conectividade externa.

### State: disabled

Not applicable:
A ação 'Criar worktree' nunca fica desabilitada nesta tela — sempre disponível.

### State: success

Not applicable:
Coberto pelo fluxo do Modal de criação (fora do escopo desta extração de tela).

### State: partial failure

Not applicable:
A listagem é uma única chamada — não há sub-operações que possam falhar parcialmente.

## Responsividade

Acima de 1024px: sidebar expandida + grid de 3 colunas de cards. Abaixo de 1024px: sidebar colapsada + lista de 1 coluna (ASSUMED — ver Decisões).

## Referências

- Prototype: .vetor/design/prototype/painel-de-worktrees
- Specification: docs/specs/painel-de-worktrees.md

## Decisões

CONFIRMED
Ação primária da tela é 'Criar worktree'.
Source: Prototype

INFERRED
A sidebar representa navegação persistente entre projetos.
Source: Prototype + Specification

ASSUMED
Navegação desktop permanece expandida acima de 1024px.
Reason: Nenhuma tela do protótipo cobre breakpoints intermediários; premissa necessária para avançar a especificação.

## Questões abertas

OPEN_QUESTION
Os filtros da lista de worktrees devem persistir entre sessões?
Impact: Afeta se o estado do filtro precisa ser persistido em storage do cliente ou servidor.
